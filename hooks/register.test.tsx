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
    surface: 'terminal',
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

  // Under 12 rows the pane turns compact: one line of stats, no tasks row.
  const short = await $.ui.mount({
    ...PANE,
    surface: 'terminal',
    props: { ...PANE.props, scroll: { offset: 0, bodyRows: 10 } },
  })
  expect(await short.find({ type: 'Text', text: /agents 1\/2 · ● 1 running/ })).toBeDefined()
  expect(await short.find({ type: 'Text', text: /tasks/ })).toBeUndefined()
  await short.unmount()
})

test('with language pt-BR the pane speaks Portuguese', { options: { language: 'pt-BR' } }, async ($, on) => {
  mock.clock(on, { now: 100_000 })
  on('agent.list', () => ({ value: [] }))
  on('state.get', (_, e) => ({ value: { value: SEEDED[e.key], version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /1 rodando/ })).toBeDefined()
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
  on('agent.list', () => ({ value: [] }))
  on('session.repo', () => ({
    value: { root: '/home/me/workspace/agents-pane', remote: 'git@github.com:me/agents-pane.git', internal: false, name: null },
  }))
  on('state.get', (_, e) => ({ value: { value: SEEDED[e.key], version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^ AGENTS-PANE$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /-- agents ---/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ \.\.  Implement E1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ ok  Review E1/ })).toBeDefined()
  await ui.unmount()
})
