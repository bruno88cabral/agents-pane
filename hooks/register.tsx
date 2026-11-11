// Claude Code adapter for agents-pane.
//
// This file turns Claude Code events into calls to the core reducers and
// paints the lines ./layout.ts and ./matrix-layout.ts lay out with Claude
// Code's UI elements. The reducers and labels live in ./core.ts, the layouts
// in those two files; none of them knows anything about Claude Code.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  addAgent,
  adoptAgents,
  countToolCall,
  endAgent,
  isLive,
  isLost,
  lastSeen,
  labels,
  parseGit,
  projectName,
  repoName,
  settleAgents,
  summarize,
  tasksFromTodos,
  updateTask,
  upsertTask,
} from './core'
import type { AgentRow, GitState, LiveStatus, TaskRow, TaskStatus } from './core'
import { layout, listWindow, mark, rates, scrollList } from './layout'
import type { LayoutInput, Line, ListWindow, Marks, Segment, Tone } from './layout'
import { matrixLayout } from './matrix-layout'
import type { MatrixLayout } from './matrix-layout'

const PANE = 'agents-pane'
const FRAME_MS = 200

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

const adopt = async ($: EngineInterface, waitingSince: Map<string, number>): Promise<void> => {
  const [known, now] = await Promise.all([$.agent.list(), $.clock.now()])
  // When each agent was first listed as waiting, for "waiting for 4m". Taken
  // here, on the tick, so a pane opened late still knows.
  for (const a of known) {
    if (a.status !== 'waiting') waitingSince.delete(a.id)
    else if (!waitingSince.has(a.id)) waitingSince.set(a.id, now)
  }
  await update($, agents, list => settleAgents(adoptAgents(list, known, now), known, now))
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
  // Where the terminal's list stands. Undefined until the terminal draws: the
  // other surfaces leave scrolling to the engine.
  let list: ListWindow | undefined
  // Counts up only while the terminal has a running agent to animate.
  let frame = 0
  let animating = false
  // In memory only, like the marks: when each agent began to wait and the last
  // tool each called, which is all the engine lets us say of why it waits.
  const waitingSince = new Map<string, number>()
  const lastTool = new Map<string, string>()
  // The view the person picked with `v`. None until they do: the matrix shows
  // whenever it can be drawn.
  let picked: 'matrix' | 'list' | undefined
  // The matrix as drawn last: what each of its keys opens. Undefined while the
  // list is drawn.
  let matrix: MatrixLayout | undefined
  // Whether the matrix could be drawn at the last drawing, drawn or not.
  let matrixFits = false
  // The element the focus ring is on, for `r` to know which cell.
  let focused: string | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'agents-pane', description: t.commandDescription })
    // Opened unasked, a pane only shows on a wide terminal (144+ columns).
    // On a narrow one it waits until the person runs /agents-pane.
    void $.ui.open({ id: PANE, title: t.title })

    if (!ticking) {
      ticking = true
      $.clock.every(1000, () => {
        void adopt($, waitingSince)
        $.ui.invalidate('ui.render')
      })
      $.clock.every(FRAME_MS, () => {
        if (!animating) return
        frame += 1
        $.ui.invalidate('ui.render')
      })
      $.clock.every(5000, async () => {
        git = await readGit($).catch(() => undefined)
      })
    }
    void adopt($, waitingSince)
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
      lastTool.set(id, e.tool)
      const now = await $.clock.now()
      await update($, agents, list => countToolCall(list, id, now))
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

  // A stopped agent gets no SubagentStop, and the engine may drop it from its
  // list before the next tick sees it as killed.
  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const ran = await next(e)
    const id = (ran.result as { task_id?: string } | undefined)?.task_id ?? e.task_id ?? e.shell_id
    if (id && !ran.isError && ran.deny === undefined) {
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

  // The ring is on one of the cells: `r` asks to retry that one.
  on('ui.focus', { component: 'Pane', requestId: PANE }, ($, e, next) => {
    focused = e.plugin === 'agents-pane' ? e.element : undefined
    return next(e)
  }).catch(($, e, next) => next(e))

  // The terminal's list moves here and the engine's window stays where it is,
  // so the header never leaves the top, not even between two drawings.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, ($, e, next) => {
    if (!list) return next(e)
    const offset = scrollList(list, {
      by: e.by,
      bodyRows: e.bodyRows,
      contentRows: e.contentRows,
      wheel: e.pointer !== undefined,
    })
    list = { ...list, offset }
    $.ui.invalidate('ui.render')
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
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
    // live list knows finer states (waiting, idle) while it runs. One it no
    // longer lists has ended unseen or runs where the list does not reach (a
    // workflow's): still live here, but with nothing to say it is working,
    // so it stays still. It is not idle: idle is only what the engine says.
    // One that is not listed and has called no tool for a while is lost: it
    // ended unseen, and shows as failed, its clock stopped at its last call.
    const liveById = new Map(live.map(a => [a.id, a.status]))
    const rows = history.map(a => {
      if (isLost(a, liveById.has(a.id), now)) {
        return { ...a, status: 'failed' as LiveStatus, endedAt: lastSeen(a) }
      }
      // A live status from the engine wins over a stored end: the agent went
      // back to work (background work it owns, a message that resumed it).
      const listed = liveById.get(a.id)
      const status: LiveStatus =
        listed && isLive(listed) ? listed : a.status === 'running' ? (listed ?? 'waiting') : a.status
      // Shown as waiting but not listed: nothing says it waits for anyone.
      const unlisted = status === 'waiting' && listed === undefined
      return {
        ...a,
        status,
        ...(unlisted && { unlisted }),
        ...(status === 'waiting' && waitingSince.has(a.id) && { waitingSince: waitingSince.get(a.id) }),
        ...(lastTool.has(a.id) && { lastTool: lastTool.get(a.id) }),
      }
    })
    // Forget the agents that left the history.
    const kept = new Set(rows.map(a => a.id))
    for (const id of [...lastTool.keys()]) if (!kept.has(id)) lastTool.delete(id)

    ascii ??= (await $.env.get('AGENTS_PANE_ASCII').catch(() => undefined)) === '1'

    const onTerminal = e.surface === 'terminal'
    animating = onTerminal && rows.some(a => a.status === 'running')

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

    const input: LayoutInput = {
      width,
      height,
      terminal: onTerminal,
      ascii,
      now,
      ...(onTerminal && { frame }),
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
    }

    // The matrix shows whenever tickets can be laid out in the room there is,
    // unless the person asked for the list.
    const fitted = matrixLayout(input)
    matrixFits = fitted !== undefined
    matrix = picked === 'list' ? undefined : fitted
    const { header, body } = matrix ?? layout({ ...input, canMatrix: matrixFits })

    // What a press of a key does. They run on the person's own input, which
    // is what lets `$.ui.view` open an agent.
    const open = async (agentId: string): Promise<void> => {
      const { deny } = await $.ui.view({ agentId })
      if (deny) $.ui.toast(t.matrix.cannotOpen(deny))
    }
    const press = async (key: string): Promise<void> => {
      if (key === 'view') {
        picked = matrix ? 'list' : 'matrix'
        $.ui.invalidate('ui.render')
        return
      }
      if (key === 'retry') {
        // A plugin's agent answers to the plugin, not to the orchestrator that
        // asked for the work, so a relaunched one would be lost to it: the
        // request is copied, and the orchestrator runs it again.
        const cell = focused ? matrix?.targets[focused] : undefined
        const target = cell?.state === 'failed' ? cell : matrix?.retry
        if (!target) return
        const { isCopied } = await $.ui.copy({
          text: t.matrix.retryRequest(target.description),
          surface: e.surface,
        })
        $.ui.toast(isCopied ? t.matrix.copied : t.matrix.notCopied)
        return
      }
      const target = key === 'urgent' ? matrix?.urgent : matrix?.targets[key]
      if (target) await open(target.agentId)
    }

    const paintSeg = (seg: Segment, i: number) =>
      seg.title ? (
        <Text key={String(i)} bold size="title" color={COLOR.accent}>
          {seg.text}
        </Text>
      ) : (
        <Text
          key={String(i)}
          bold={seg.bold}
          dimColor={seg.tone === 'dim'}
          color={seg.color ?? (seg.tone && seg.tone !== 'dim' ? COLOR[seg.tone] : undefined)}
        >
          {seg.text || ' '}
        </Text>
      )

    const paint = (line: Line, key: string) => {
      if (!line.some(seg => seg.press)) {
        return (
          <Text key={key} wrap="truncate-end">
            {line.map(paintSeg)}
          </Text>
        )
      }
      // Segments that share a key are one button; the text between them stays text.
      const runs: Segment[][] = []
      for (const seg of line) {
        const last = runs[runs.length - 1]
        if (last && last[0]!.press === seg.press) last.push(seg)
        else runs.push([seg])
      }
      return (
        <Box key={key} flexDirection="row">
          {runs.map((run, i) => {
            const id = run[0]!.press
            const hotkey = run[0]!.hotkey
            return id ? (
              <Button
                key={id}
                plain
                onPress={() => press(id)}
                {...(hotkey && { hotkey })}
                {...(id === 'urgent' && { autoFocus: true as const })}
              >
                {run.map(paintSeg)}
              </Button>
            ) : (
              <Text key={`t${i}`} wrap="truncate-end">
                {run.map(paintSeg)}
              </Text>
            )
          })}
        </Box>
      )
    }

    const headerRows = (
      <Box flexDirection="column" rowGap="sm">
        {header.map((line, i) => paint(line, `h${i}`))}
      </Box>
    )

    if (onTerminal) {
      list = listWindow(body.length, Math.max(0, height - header.length), list?.offset ?? 0)
      const { offset: first, room, max } = list
      return (
        <Box flexDirection="column">
          {headerRows}
          {body.slice(first, first + room).map((line, i) => paint(line, `b${i + first}`))}
          {/* A row past the window: the engine only sends the arrows while it has rows to scroll. */}
          {max > 0 && <Box height={1} />}
        </Box>
      )
    }

    // Elsewhere the engine scrolls the whole tree, so the header is drawn at
    // the offset and stays on the first visible row.
    return (
      <Box flexDirection="column">
        {offset > 0 && <Box height={offset} />}
        {/* A small gap between the rows where the surface has one. */}
        {headerRows}
        {body.slice(offset).map((line, i) => paint(line, `b${i + offset}`))}
      </Box>
    )
  })
}
