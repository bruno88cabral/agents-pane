// Claude Code adapter for agents-pane.
//
// This file turns Claude Code events into calls to the core reducers and
// paints the lines ./layout.ts lays out with Claude Code's UI elements. The
// reducers and labels live in ./core.ts and the layout in ./layout.ts; neither
// knows anything about Claude Code.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  addAgent,
  adoptAgents,
  countToolCall,
  endAgent,
  isLive,
  labels,
  parseGit,
  projectName,
  repoName,
  summarize,
  tasksFromTodos,
  updateTask,
  upsertTask,
} from './core'
import type { AgentRow, GitState, LiveStatus, TaskRow, TaskStatus } from './core'
import { layout, mark, rates } from './layout'
import type { Line, Marks, Tone } from './layout'

const PANE = 'agents-pane'

const agents = atom({ plugin: 'agents-pane', key: 'agents' } as const, [])
const tasks = atom({ plugin: 'agents-pane', key: 'tasks' } as const, [])

// Layout tones to Claude Code theme keys; `dim` is the terminal's dim text.
const COLOR: Record<Exclude<Tone, 'dim'>, 'claude' | 'success' | 'warning' | 'error'> = {
  accent: 'claude',
  ok: 'success',
  warn: 'warning',
  error: 'error',
}

// The branch line, read from git. Undefined outside a repository or where
// processes cannot run (git missing, a surface without a host).
const readGit = async ($: EngineInterface): Promise<GitState | undefined> => {
  const [status, rev] = await Promise.all([
    $.process.run(['git', 'status', '--porcelain', '--branch'], { timeoutMs: 5000 }),
    $.process.run(['git', 'rev-parse', '--git-dir', '--git-common-dir', '--short', 'HEAD'], { timeoutMs: 5000 }),
  ])
  return status.exitCode === 0 ? parseGit(status.stdout, rev.stdout) : undefined
}

const adopt = async ($: EngineInterface): Promise<void> => {
  const [known, now] = await Promise.all([$.agent.list(), $.clock.now()])
  await update($, agents, list => adoptAgents(list, known, now))
}

export const register: Register = (on, options) => {
  const t = labels(options.language)
  let ticking = false
  // AGENTS_PANE_ASCII=1 draws with plain ASCII, for fonts without block
  // glyphs. Read on the first drawing, then kept.
  let ascii: boolean | undefined
  // Tool-call counts at each minute mark, per running agent, for the
  // sparkline. Kept in memory only: a reload starts them over.
  const marks = new Map<string, Marks>()
  // Git is read every 5 seconds, not on each drawing.
  let git: GitState | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'agents-pane', description: t.commandDescription })
    // Opened unasked, a pane only shows on a wide terminal (144+ columns).
    // On a narrow one it waits until the person runs /agents-pane.
    void $.ui.open({ id: PANE, title: t.title })

    if (!ticking) {
      ticking = true
      $.clock.every(1000, () => {
        void adopt($)
        $.ui.invalidate('ui.render')
      })
      $.clock.every(5000, async () => {
        git = await readGit($).catch(() => undefined)
      })
    }
    void adopt($)
    void readGit($).then(
      g => (git = g),
      () => undefined,
    )

    return next(e)
  })

  on('command.run', { command: 'agents-pane' }, async $ => {
    await $.ui.open({ id: PANE, title: t.title })
    const list = await read($, agents)
    const running = list.filter(a => a.status === 'running').length

    return { text: t.opened(running, list.length) }
  })

  // ---- agents ----

  on('agent.spawn', async ($, e, next) => {
    const startedAt = await $.clock.now()
    const spawned = await next(e)

    if (spawned.agentId) {
      const row: AgentRow = {
        id: spawned.agentId,
        type: e.subagentType ?? 'teammate',
        description: e.description ?? '',
        model: spawned.model,
        background: e.background,
        status: 'running',
        startedAt,
        toolCalls: 0,
      }
      await update($, agents, list => addAgent(list, row))
    }

    return spawned
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.agentId) {
      const id = e.agentId
      await update($, agents, list => countToolCall(list, id))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const ran = await next(e)
    const id = (ran.result as { agentId?: string } | undefined)?.agentId

    if (id && (ran.deny !== undefined || ran.isError)) {
      const now = await $.clock.now()
      await update($, agents, list => endAgent(list, id, 'failed', now))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, agents, list => endAgent(list, e.agent_id, 'completed', now))
    return next(e)
  }).catch(($, e, next) => next(e))

  // ---- orchestration task list (TaskCreate / TaskUpdate / TaskList / TodoWrite) ----

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const task = (ran.result as { task?: { id: string; subject: string } } | undefined)?.task
    if (task && !ran.isError) {
      await update($, tasks, list =>
        upsertTask(list, { id: task.id, subject: task.subject, status: 'pending' }),
      )
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    const result = ran.result as
      | { success?: boolean; taskId?: string; statusChange?: { to: string } }
      | undefined
    const to = (result?.statusChange?.to ?? e.status) as TaskStatus | 'deleted' | undefined
    if (result?.success && result.taskId && to) {
      const id = result.taskId
      await update($, tasks, list => updateTask(list, id, to, e.subject))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskList' }, async ($, e, next) => {
    const ran = await next(e)
    const list = (ran.result as { tasks?: TaskRow[] } | undefined)?.tasks
    if (list && !ran.isError) {
      await update($, tasks, () =>
        list.map(task => ({ id: task.id, subject: task.subject, status: task.status })),
      )
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    // Only the main loop's list is the orchestration plan; a subagent's own
    // TodoWrite must not replace it.
    if (!e.agentId && !ran.isError && ran.deny === undefined) {
      await update($, tasks, () => tasksFromTodos(e.todos))
    }
    return ran
  }).catch(($, e, next) => next(e))

  // ---- the pane ----

  // The context line follows the fill as soon as it moves, not on the next tick.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) $.ui.invalidate('ui.render')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const [history, taskList, live, now, root, repo, usage] = await Promise.all([
      read($, agents),
      read($, tasks),
      $.agent.list(),
      $.clock.now(),
      $.session.root().catch(() => undefined),
      $.session.repo().catch(() => undefined),
      $.session.usage().catch(() => undefined),
    ])

    // The stored status says running until we see the end; the engine's
    // live list knows finer states (waiting, idle) while it runs.
    const liveById = new Map(live.map(a => [a.id, a.status]))
    const rows = history.map(a => {
      const current = liveById.get(a.id)
      const status: LiveStatus = a.status === 'running' && current ? current : a.status
      return { ...a, status }
    })

    ascii ??= (await $.env.get('AGENTS_PANE_ASCII').catch(() => undefined)) === '1'

    const s = summarize(rows, taskList)
    const width = Math.max(20, e.props.bodyColumns ?? e.viewport?.columns ?? 80)
    const height = e.props.scroll?.bodyRows ?? 24
    const offset = Math.max(0, e.props.scroll?.offset ?? 0)

    for (const a of rows) {
      if (isLive(a.status)) marks.set(a.id, mark(marks.get(a.id), now, a.toolCalls))
      else marks.delete(a.id)
    }

    // The repo's name stays the same in every worktree; the folder's does not.
    const name =
      (repo?.remote && repoName(repo.remote)) ||
      (repo && projectName(repo.root)) ||
      (root && projectName(root)) ||
      undefined

    const { header, body } = layout({
      width,
      height,
      terminal: e.surface === 'terminal',
      ascii,
      now,
      name,
      // tokens and percent stay unknown until the first response of the live
      // window (a fresh session, or one just compacted).
      context: usage?.context,
      git,
      limits: usage?.rateLimits.map(l => ({
        kind: l.kind,
        percent: l.percentUsed,
        resetsAt: l.resetsAt ? Date.parse(l.resetsAt) : undefined,
      })),
      session: usage && { startedAt: usage.startedAt, usd: usage.cost?.usd },
      agents: rows.map(a => {
        const m = marks.get(a.id)
        return m ? { ...a, rates: rates(m, a.toolCalls) } : a
      }),
      tasks: s.tasks,
      labels: t,
    })

    const paint = (line: Line, key: string) => (
      <Text key={key} wrap="truncate-end">
        {line.map((seg, i) =>
          seg.title ? (
            <Text key={String(i)} bold size="title" color={COLOR.accent}>
              {seg.text}
            </Text>
          ) : (
            <Text
              key={String(i)}
              bold={seg.bold}
              dimColor={seg.tone === 'dim'}
              color={seg.tone && seg.tone !== 'dim' ? COLOR[seg.tone] : undefined}
            >
              {seg.text || ' '}
            </Text>
          ),
        )}
      </Text>
    )

    // The header is drawn at the scroll offset, so it stays on the first
    // visible row while the list scrolls under it.
    return (
      <Box flexDirection="column">
        {offset > 0 && <Box height={offset} />}
        {/* A small gap between the rows where the surface has one; none on the terminal. */}
        <Box flexDirection="column" rowGap="sm">
          {header.map((line, i) => paint(line, `h${i}`))}
        </Box>
        {body.slice(offset).map((line, i) => paint(line, `b${i + offset}`))}
      </Box>
    )
  })
}
