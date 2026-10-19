// Claude Code adapter for agents-pane.
//
// This file turns Claude Code events into calls to the core reducers and
// draws the pane with Claude Code's UI elements. All counting, layout math
// and labels live in ./core.ts, which knows nothing about Claude Code.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  addAgent,
  adoptAgents,
  barCells,
  columns,
  countToolCall,
  elapsed,
  endAgent,
  fit,
  glyph,
  isLive,
  labels,
  summarize,
  tone,
  updateTask,
  upsertTask,
} from './core'
import type { AgentRow, LiveStatus, TaskRow, TaskStatus, Tone } from './core'

const PANE = 'agents-pane'

const agents = atom({ plugin: 'agents-pane', key: 'agents' } as const, [])
const tasks = atom({ plugin: 'agents-pane', key: 'tasks' } as const, [])

// Core tones to Claude Code theme keys.
const COLOR: Record<Tone, 'claude' | 'success' | 'error' | 'warning' | 'inactive'> = {
  active: 'claude',
  success: 'success',
  error: 'error',
  warning: 'warning',
  muted: 'inactive',
}

const adopt = async ($: EngineInterface): Promise<void> => {
  const [known, now] = await Promise.all([$.agent.list(), $.clock.now()])
  await update($, agents, list => adoptAgents(list, known, now))
}

export const register: Register = (on, options) => {
  const t = labels(options.language)
  let ticking = false

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
    }
    void adopt($)

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

  // ---- orchestration task list (TaskCreate / TaskUpdate / TaskList) ----

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

  // ---- the pane ----

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const [history, taskList, live, now] = await Promise.all([
      read($, agents),
      read($, tasks),
      $.agent.list(),
      $.clock.now(),
    ])

    // The stored status says running until we see the end; the engine's
    // live list knows finer states (waiting, idle) while it runs.
    const liveById = new Map(live.map(a => [a.id, a.status]))
    const rows = history.map(a => {
      const current = liveById.get(a.id)
      const status: LiveStatus = a.status === 'running' && current ? current : a.status
      return { ...a, status }
    })

    const s = summarize(rows, taskList)
    const width = Math.max(30, e.props.bodyColumns ?? e.viewport?.columns ?? 80)
    const offset = Math.max(0, e.props.scroll?.offset ?? 0)
    const barWidth = Math.max(10, width - 2)
    const col = columns(width)

    const [aRun = 0, aDone = 0, aFail = 0] = barCells(
      [s.agents.running, s.agents.done, s.agents.failed],
      barWidth,
    )
    const [tPend = 0, tAct = 0, tDone = 0] = barCells(
      [s.tasks.pending, s.tasks.active, s.tasks.done],
      barWidth,
    )

    // The header is drawn at the scroll offset, so it stays on the first
    // visible row while the list scrolls under it.
    const header = (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">
          {t.agents}  <Text color={COLOR.active}>● {s.agents.running} {t.running}</Text>
          {'  '}
          <Text color={COLOR.success}>✓ {s.agents.done} {t.done}</Text>
          {s.agents.failed > 0 && (
            <Text color={COLOR.error}>  ✗ {s.agents.failed} {t.failed}</Text>
          )}
          <Text dimColor>  · {s.agents.total} {t.total}</Text>
        </Text>
        <Text wrap="truncate-end">
          {' '}
          <Text color={COLOR.active}>{'█'.repeat(aRun)}</Text>
          <Text color={COLOR.success}>{'█'.repeat(aDone)}</Text>
          <Text color={COLOR.error}>{'█'.repeat(aFail)}</Text>
          {s.agents.total === 0 && <Text dimColor>{'░'.repeat(barWidth)}</Text>}
        </Text>
        {s.tasks.total > 0 && (
          <Text bold wrap="truncate-end">
            {t.tasks}  <Text dimColor>○ {s.tasks.pending} {t.tasksPending}</Text>
            {'  '}
            <Text color={COLOR.warning}>◐ {s.tasks.active} {t.tasksActive}</Text>
            {'  '}
            <Text color={COLOR.success}>✓ {s.tasks.done} {t.tasksDone}</Text>
            <Text dimColor>  · {s.tasks.total} {t.total}</Text>
          </Text>
        )}
        {s.tasks.total > 0 && (
          <Text wrap="truncate-end">
            {' '}
            <Text dimColor>{'░'.repeat(tPend)}</Text>
            <Text color={COLOR.warning}>{'█'.repeat(tAct)}</Text>
            <Text color={COLOR.success}>{'█'.repeat(tDone)}</Text>
          </Text>
        )}
        <Text dimColor wrap="truncate-end">{'─'.repeat(width)}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        {offset > 0 && <Box height={offset} />}
        {header}
        {rows.length === 0 && <Text dimColor>{t.empty}</Text>}
        {rows.slice(offset).map(a => {
          const running = isLive(a.status)
          const time = elapsed(a.startedAt, running ? now : (a.endedAt ?? now))
          return (
            <Box key={a.id} flexDirection="row">
              <Text wrap="truncate-end">
                <Text color={COLOR[tone(a.status)]}>{glyph(a.status)} </Text>
                <Text bold>{fit(a.type, col.type)}</Text>
                <Text dimColor={!running}> {fit(a.description, col.description)}</Text>
                <Text dimColor> {`${a.toolCalls}t`.padStart(col.tools)}</Text>
                <Text dimColor>{time.padStart(col.time)}</Text>
                <Text dimColor>{a.background ? ' bg' : '   '}</Text>
              </Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
