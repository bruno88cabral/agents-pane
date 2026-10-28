// Adapter tests: the pane and the command, drawn through the real engine.

import { expect, mock, test } from 'claude-code/testing'

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

test('the header shows both summaries and stays at the scroll offset', async ($, on) => {
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
    props: { ...PANE.props, scroll: { offset: 1, bodyRows: 10 } },
  })
  expect(await ui.find({ type: 'Text', text: /1 running/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 to start/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 in progress/ })).toBeDefined()
  // offset 1: the first agent row is scrolled away, the second shows
  expect(await ui.find({ type: 'Text', text: /Review E1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Implement E1/ })).toBeUndefined()
  await ui.unmount()
})

test('with language pt-BR the pane speaks Portuguese', { options: { language: 'pt-BR' } }, async ($, on) => {
  mock.clock(on, { now: 100_000 })
  on('agent.list', () => ({ value: [] }))
  on('state.get', (_, e) => ({ value: { value: SEEDED[e.key], version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /1 rodando/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 a disparar/ })).toBeDefined()
  await ui.unmount()
})

const TODOS = [
  { content: 'Plan', status: 'pending', activeForm: 'Planning' },
  { content: 'Build', status: 'in_progress', activeForm: 'Building' },
  { content: 'Ship', status: 'completed', activeForm: 'Shipping' },
] as const

test('TodoWrite from the main loop feeds the task line', async ($, on) => {
  mock.clock(on)
  on('agent.list', () => ({ value: [] }))
  on('tool.call', { tool: 'TodoWrite' }, () => ({
    result: { oldTodos: [], newTodos: TODOS },
  }))

  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /1 to start/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 in progress/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 done/ })).toBeDefined()
  await ui.unmount()
})

test('TodoWrite from a subagent leaves the task line alone', async ($, on) => {
  mock.clock(on)
  on('agent.list', () => ({ value: [] }))
  on('tool.call', { tool: 'TodoWrite' }, () => ({
    result: { oldTodos: [], newTodos: TODOS },
  }))

  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS], agentId: 'a1' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /to start/ })).toBeUndefined()
  await ui.unmount()
})

test('the top line shows the project folder and the context fill', async ($, on) => {
  mock.clock(on)
  on('agent.list', () => ({ value: [] }))
  on('session.root', () => ({ value: '/home/me/workspace/agents-pane' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 84_000, window: 200_000, percent: 42 }, rateLimits: [] },
  }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^agents-pane$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /context 84k \/ 200k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /42%/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /context — \/ 200k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /%/ })).toBeUndefined()
  await ui.unmount()
})
