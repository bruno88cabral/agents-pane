// Adapter tests: the pane and the command, drawn through the real engine.

import { expect, mock, test } from 'claude-code/testing'

import { bigText } from './core'

const PANE = {
  plugin: 'agents-pane',
  component: 'Pane',
  requestId: 'agents-pane',
  props: {
    title: 'Agents',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 24 },
    view: {},
  },
} as const

const SEEDED: Record<string, unknown> = {
  agents: [
    { id: 'a1', type: 'general-purpose', description: 'Implement E1', background: true, status: 'running', startedAt: 40_000, toolCalls: 12 },
    { id: 'a2', type: 'general-purpose', description: 'Review E1', background: false, status: 'completed', startedAt: 10_000, endedAt: 70_000, toolCalls: 3 },
  ],
  tasks: [
    { id: 't1', subject: 'E1', status: 'completed' },
    { id: 't2', subject: 'E2', status: 'in_progress' },
    { id: 't3', subject: 'E3', status: 'pending' },
  ],
}

test('the empty pane says so, on every surface', async ($, on) => {
  mock.clock(on)
  on('agent.list', () => ({ value: [] }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /No agents in this session yet/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /0 running/ })).toBeDefined()
    await ui.unmount()
  }
})

test('/agents-pane opens the pane and answers with the count', async ($, on) => {
  let opened = 0
  on('ui.open', () => {
    opened += 1
    return { value: { isPlaced: true } }
  })

  const ran = await $.command.run({
    command: 'agents-pane',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  expect(ran.text).toMatch(/Agents pane open: 0 running/)
  expect(opened).toBe(1)
})

const many = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `a${i}`, type: 'general-purpose', description: `Worker ${i}.`, background: true,
    status: 'completed', startedAt: 0, endedAt: 1000, toolCalls: i,
  }))

test('on the terminal the header stays and only the rows under it are drawn', async ($, on) => {
  mock.clock(on, { now: 100_000 })
  on('agent.list', () => ({ value: [] }))
  on('state.get', (_, e) => ({ value: { value: e.key === 'agents' ? many(60) : [], version: 1 } }))

  // bodyRows 20: agents row and its 6 counts, a blank line and the separator leave 11 rows.
  const ui = await $.ui.mount({
    ...PANE,
    surface: 'terminal',
    props: { ...PANE.props, scroll: { offset: 0, bodyRows: 20 } },
  })
  expect(await ui.find({ type: 'Text', text: /agents\s+60 \/ 60 done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Worker 0\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Worker 10\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Worker 11\./ })).toBeUndefined()
  await ui.unmount()
})

test('scrolling moves the rows under the header and leaves the window alone', async ($, on) => {
  mock.clock(on, { now: 100_000 })
  on('agent.list', () => ({ value: [] }))
  on('state.get', (_, e) => ({ value: { value: e.key === 'agents' ? many(60) : [], version: 1 } }))

  const ui = await $.ui.mount({
    ...PANE,
    surface: 'terminal',
    props: { ...PANE.props, scroll: { offset: 0, bodyRows: 20 } },
  })
  // As the engine raises it for the End key: the whole tree, 20 rows + 1.
  const raise = $.ui.scroll as unknown as (e: object) => Promise<unknown>
  await raise({
    component: 'Pane', requestId: 'agents-pane', offset: 1, by: 21, bodyRows: 20, contentRows: 21,
    origin: { kind: 'person' },
  })
  expect(await ui.find({ type: 'Text', text: /agents\s+60 \/ 60 done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Worker 59\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Worker 0\./ })).toBeUndefined()
  await ui.unmount()
})

test('the header shows the stats table and stays at the scroll offset', async ($, on) => {
  mock.clock(on, { now: 100_000 })
  on('agent.list', () => ({
    value: [
      { id: 'a1', description: 'Implement E1', type: 'general-purpose', status: 'running' },
      { id: 'a2', description: 'Review E1', type: 'general-purpose', status: 'completed' },
    ],
  }))
  on('state.get', (_, e) => ({ value: { value: SEEDED[e.key], version: 1 } }))

  const ui = await $.ui.mount({
    ...PANE,
    surface: 'desktop',
    props: { ...PANE.props, scroll: { offset: 1, bodyRows: 24 } },
  })
  expect(await ui.find({ type: 'Text', text: /agents\s+1 \/ 2 done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /● 1 running/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /tasks\s+1 \/ 3 done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /◐ 1 active/ })).toBeDefined()
  // offset 1: the first agent row is scrolled away, the second shows
  expect(await ui.find({ type: 'Text', text: /Review E1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Implement E1/ })).toBeUndefined()
  await ui.unmount()

  // Under 18 rows the pane turns compact: one line of stats, no tasks row.
  const short = await $.ui.mount({
    ...PANE,
    surface: 'terminal',
    props: { ...PANE.props, scroll: { offset: 0, bodyRows: 10 } },
  })
  expect(await short.find({ type: 'Text', text: /agents 1\/2 · ● 1 running/ })).toBeDefined()
  expect(await short.find({ type: 'Text', text: /tasks/ })).toBeUndefined()
  await short.unmount()
})

const LIVE_A1 = { id: 'a1', description: 'Implement E1', type: 'general-purpose', status: 'running' }

test('an agent the engine no longer lists stops spinning', async ($, on) => {
  mock.clock(on, { now: 100_000 })
  on('agent.list', () => ({ value: [] }))
  on('state.get', (_, e) => ({ value: { value: SEEDED[e.key], version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^ ◐  Implement E1/ })).toBeDefined()
  await ui.unmount()
})

test('an agent stopped with TaskStop ends as failed', async ($, on) => {
  mock.clock(on, { now: 100_000 })
  on('agent.list', () => ({ value: [] }))
  on('tool.call', { tool: 'TaskStop' }, () => ({
    result: { message: 'Successfully stopped task: a1', task_id: 'a1', task_type: 'local_agent', command: 'Implement E1' },
  }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))

  const spawn = $.agent.spawn as unknown as (e: object) => Promise<unknown>
  await spawn({
    tool_use_id: 'toolu_1', prompt: 'Implement E1', description: 'Implement E1',
    subagentType: 'general-purpose', background: true, parentModel: 'claude-opus-5-5',
  })
  await $.tool.call({ tool: 'TaskStop', task_id: 'a1' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^ ✗  Implement E1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /● 0 running/ })).toBeDefined()
  await ui.unmount()
})

test('an unlisted agent with no tool call for five minutes is lost', async ($, on) => {
  // Started at 40s, one call at 50s, stopped unseen: the clock stops at 10s.
  mock.clock(on, { now: 50_000 + 5 * 60_000 + 1 })
  on('agent.list', () => ({ value: [] }))
  const seeded = { ...SEEDED, agents: [{ ...(SEEDED.agents as object[])[0], toolCalls: 1, lastCallAt: 50_000 }] }
  on('state.get', (_, e) => ({ value: { value: seeded[e.key], version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^ ✗  Implement E1 .* 1t +10s/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /● 0 running/ })).toBeDefined()
  await ui.unmount()
})

test('an agent the engine lists as waiting stays still', async ($, on) => {
  mock.clock(on, { now: 100_000 })
  on('agent.list', () => ({ value: [{ ...LIVE_A1, status: 'waiting' }] }))
  on('state.get', (_, e) => ({ value: { value: SEEDED[e.key], version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^ ◐  Implement E1/ })).toBeDefined()
  await ui.unmount()
})

test('a done agent the engine lists as waiting again shows as running', async ($, on) => {
  mock.clock(on, { now: 100_000 })
  on('agent.list', () => ({
    value: [{ id: 'a2', description: 'Review E1', type: 'general-purpose', status: 'waiting' }],
  }))
  on('state.get', (_, e) => ({ value: { value: SEEDED[e.key], version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^ ◐  Review E1/ })).toBeDefined()
  // a1 is not listed, so it is held too: both count as waiting, none as done.
  expect(await ui.find({ type: 'Text', text: /agents\s+0 \/ 2 done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /● 0 running/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /◐ 2 waiting/ })).toBeDefined()
  await ui.unmount()
})

test('an agent the engine lists as idle shows as idle, not running', async ($, on) => {
  mock.clock(on, { now: 100_000 })
  on('agent.list', () => ({ value: [{ ...LIVE_A1, status: 'idle' }] }))
  on('state.get', (_, e) => ({ value: { value: SEEDED[e.key], version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^ ○  Implement E1/ })).toBeDefined()
  await ui.unmount()
})

test('a running agent spins on the terminal and stays still elsewhere', async ($, on) => {
  mock.clock(on, { now: 100_000 })
  on('agent.list', () => ({ value: [LIVE_A1] }))
  on('state.get', (_, e) => ({ value: { value: SEEDED[e.key], version: 1 } }))

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.find({ type: 'Text', text: /^ ⠋  Implement E1/ })).toBeDefined()
  await terminal.unmount()

  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desktop.find({ type: 'Text', text: /^ ◐  Implement E1/ })).toBeDefined()
  await desktop.unmount()
})

test('with language pt-BR the pane speaks Portuguese', { options: { language: 'pt-BR' } }, async ($, on) => {
  mock.clock(on, { now: 100_000 })
  on('agent.list', () => ({ value: [] }))
  on('state.get', (_, e) => ({ value: { value: SEEDED[e.key], version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /0 rodando/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 aguardando/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /tarefas\s+1\/3/ })).toBeDefined()
  await ui.unmount()
})

const TODOS = [
  { content: 'Plan', status: 'pending', activeForm: 'Planning' },
  { content: 'Build', status: 'in_progress', activeForm: 'Building' },
  { content: 'Ship', status: 'completed', activeForm: 'Shipping' },
] as const

test('TodoWrite from the main loop feeds the tasks row', async ($, on) => {
  mock.clock(on)
  on('agent.list', () => ({ value: [] }))
  on('tool.call', { tool: 'TodoWrite' }, () => ({
    result: { oldTodos: [], newTodos: TODOS },
  }))

  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /tasks\s+1 \/ 3 done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /◐ 1 active/ })).toBeDefined()
  await ui.unmount()
})

test('TodoWrite from a subagent leaves the tasks row alone', async ($, on) => {
  mock.clock(on)
  on('agent.list', () => ({ value: [] }))
  on('tool.call', { tool: 'TodoWrite' }, () => ({
    result: { oldTodos: [], newTodos: TODOS },
  }))

  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS], agentId: 'a1' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /tasks/ })).toBeUndefined()
  await ui.unmount()
})

test('the name of the GitHub repo heads the pane in big letters, the context fill under it', async ($, on) => {
  mock.clock(on)
  on('agent.list', () => ({ value: [] }))
  on('session.root', () => ({ value: '/home/me/worktrees/feature-x' }))
  on('session.repo', () => ({
    value: { root: '/home/me/workspace/agents-pane', remote: 'git@github.com:me/agents-pane.git', internal: false, name: null },
  }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 84_000, window: 200_000, percent: 42 }, rateLimits: [] },
  }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (const row of bigText('agents-pane', 80)!) {
    expect(await ui.find({ type: 'Text', text: row })).toBeDefined()
  }
  expect(await ui.find({ type: 'Text', text: /feature-x/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /context\s+84k \/ 200k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /42%/ })).toBeDefined()
  await ui.unmount()

  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desktop.find({ type: 'Text', text: /^agents-pane$/ })).toBeDefined()
  await desktop.unmount()
})

test('without a remote the name falls back to the folder', async ($, on) => {
  mock.clock(on)
  on('agent.list', () => ({ value: [] }))
  on('session.root', () => ({ value: '/home/me/workspace/scratch' }))
  on('session.repo', () => ({ value: null }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^scratch$/ })).toBeDefined()
  await ui.unmount()
})

test('before the first response the context shows only the window', async ($, on) => {
  mock.clock(on)
  on('agent.list', () => ({ value: [] }))
  on('session.root', () => ({ value: '/home/me/workspace/agents-pane' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /context\s+— \/ 200k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /%/ })).toBeUndefined()
  await ui.unmount()
})

test('AGENTS_PANE_ASCII=1 draws the pane with plain ASCII', async ($, on) => {
  mock.clock(on, { now: 100_000 })
  mock.env(on, { AGENTS_PANE_ASCII: '1' })
  on('agent.list', () => ({ value: [LIVE_A1] }))
  on('session.repo', () => ({
    value: { root: '/home/me/workspace/agents-pane', remote: 'git@github.com:me/agents-pane.git', internal: false, name: null },
  }))
  on('state.get', (_, e) => ({ value: { value: SEEDED[e.key], version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^ AGENTS-PANE$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /-- agents ---/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ \|   Implement E1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ ok  Review E1/ })).toBeDefined()
  await ui.unmount()
})

test('the branch, the usage limits and the session fill the header', async ($, on) => {
  mock.clock(on)
  on('agent.list', () => ({ value: [] }))
  const run = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
  on('process.run', (_, e) => ({
    value:
      e.argv[1] === 'status'
        ? run('## pane-stats...origin/pane-stats [ahead 2]\n M hooks/core.ts\n')
        : run('.git\n.git\na1b2c3d\n'),
  }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 84_000, window: 200_000, percent: 42 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 34 }, { kind: 'seven_day', percentUsed: 71 }],
      cost: { usd: 3.42 },
    },
  }))

  on('command.register', () => ({ value: { command: 'agents-pane' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/home/me/workspace/agents-pane', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /branch +pane-stats {2}●1 ↑2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /limit 5h .* 34%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /week .* 71%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /session .* \$3\.42/ })).toBeDefined()
  await ui.unmount()
})

// ---------- the matrix ----------

const TICKETED_AGENTS = [
  { id: 'a1', type: 'general-purpose', description: 'Refinar N1 MYK-1151', background: true, status: 'completed', startedAt: 0, endedAt: 60_000, toolCalls: 20 },
  { id: 'a2', type: 'general-purpose', description: 'Refinar N6 MYK-1156', background: true, status: 'running', startedAt: 70_000, toolCalls: 12 },
  { id: 'a3', type: 'general-purpose', description: 'Fatiar N7 MYK-1157', background: true, status: 'failed', startedAt: 80_000, endedAt: 83_000, toolCalls: 6 },
  { id: 'a4', type: 'general-purpose', description: 'Implement Task 9: N5b sky card', background: true, status: 'completed', startedAt: 90_000, endedAt: 99_000, toolCalls: 160 },
]
const WAITING_A2 = { id: 'a2', description: 'Refinar N6 MYK-1156', type: 'general-purpose', status: 'waiting' }

/** A pane over ticketed agents, `a2` waiting for the person. */
const ticketed = (on: Parameters<typeof mock.clock>[0], list: unknown[] = [WAITING_A2]) => {
  mock.clock(on, { now: 100_000 })
  on('agent.list', () => ({ value: list as never }))
  on('state.get', (_, e) => ({
    value: { value: e.key === 'agents' ? TICKETED_AGENTS : SEEDED[e.key], version: 1 },
  }))
}

const keysOf = async (ui: { findAll: (q: { type: string }) => Promise<Array<{ key: string | undefined }>> }) =>
  (await ui.findAll({ type: 'Button' })).map(b => b.key)

test('agents that name tickets are drawn as a matrix, every cell with an agent a button', async ($, on) => {
  ticketed(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /ticket +1 · Refinar +2 · Fatiar +total/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 agent waiting for you/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /MYK-1156 · Refinar N6 · on background work/ })).toBeDefined()
  expect(await keysOf(ui)).toEqual([
    'urgent',
    'retry',
    'view',
    'cell:MYK-1156:refinar',
    'cell:MYK-1157:fatiar',
    'cell:MYK-1151:refinar',
  ])
  // The agent with no ticket is still listed, under its own title.
  expect(await ui.find({ type: 'Text', text: /no ticket/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Implement Task 9: N5b sky card/ })).toBeDefined()
  await ui.unmount()
})

test('pressing a cell, or ⏎ on the banner, opens the agent in the main view', async ($, on) => {
  ticketed(on)
  const opened: Array<string | undefined> = []
  on('ui.view', (_, e) => {
    opened.push(e.agentId)
    return { value: {} }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'cell:MYK-1151:refinar' })
  await ui.press({ key: 'urgent' })
  await ui.press({ key: 'cell:MYK-1157:fatiar' })
  expect(opened).toEqual(['a1', 'a2', 'a3'])
  await ui.unmount()
})

test('an agent the engine will not show says why in a toast', async ($, on) => {
  ticketed(on)
  on('ui.view', () => ({ value: { deny: 'no agent holds that id' } }))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'cell:MYK-1151:refinar' })
  expect(toasts).toEqual(['Cannot open the agent: no agent holds that id'])
  await ui.unmount()
})

test('v goes to the list and back, and the list offers the matrix', async ($, on) => {
  ticketed(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /ticket +1 · Refinar/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Button', key: 'view' }))[0]?.text).toMatch(/list/)

  await ui.press({ key: 'view' })
  // The list: the agents grouped by ticket, the separator offering the matrix.
  expect(await ui.find({ type: 'Text', text: /ticket +1 · Refinar/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /agents +\d \/ 4 done/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Button', key: 'view' }))[0]?.text).toMatch(/matrix/)
  expect(await keysOf(ui)).toEqual(['view'])

  await ui.press({ key: 'view' })
  expect(await ui.find({ type: 'Text', text: /ticket +1 · Refinar/ })).toBeDefined()
  await ui.unmount()
})

test('r copies a retry request for the cell under the ring, else for the first open failure', async ($, on) => {
  ticketed(on)
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'retry' })
  expect(copied).toEqual(['The agent "Fatiar N7 MYK-1157" failed. Run it again with the same prompt as before.'])
  expect(toasts).toEqual(['Retry request copied: paste it to the orchestrator'])
  await ui.unmount()
})

test('a copy the surface refuses is said so', async ($, on) => {
  ticketed(on)
  on('ui.copy', () => ({ value: { isCopied: false, reason: 'no-clipboard' } }))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'retry' })
  expect(toasts).toEqual(['Could not copy the retry request'])
  await ui.unmount()
})

test('why it waits is the last tool the agent called', async ($, on) => {
  ticketed(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '' } }))
  await $.tool.call({ tool: 'Bash', command: 'sleep 600', agentId: 'a2' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /MYK-1156 · Refinar N6 · stopped after Bash/ })).toBeDefined()
  await ui.unmount()
})

test('an agent the engine does not list is not a waiting agent: no banner, a still cell', async ($, on) => {
  ticketed(on, [])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /agents? waiting for you/ })).toBeUndefined()
  const cell = (await ui.findAll({ type: 'Button', key: 'cell:MYK-1156:refinar' }))[0]
  expect(cell?.text).toMatch(/^◐ 30s · 12t/)
  // With nothing waiting, ⏎ goes to the open failure, from the rule.
  const urgent = (await ui.findAll({ type: 'Button', key: 'urgent' }))[0]
  expect(urgent?.text).toBe('⏎ open')
  await ui.unmount()
})

test('with no agent naming a ticket the list stays, and has no key to the matrix', async ($, on) => {
  mock.clock(on, { now: 100_000 })
  on('agent.list', () => ({ value: [] }))
  on('state.get', (_, e) => ({ value: { value: SEEDED[e.key], version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await keysOf(ui)).toEqual([])
  await ui.unmount()
})

test('on a pane too narrow for the stages the list stays, and `v` is not offered', async ($, on) => {
  ticketed(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 50 } })
  expect(await ui.find({ type: 'Text', text: /ticket +1 · Refinar/ })).toBeUndefined()
  expect(await keysOf(ui)).toEqual([])
  await ui.unmount()
})
