// Unit tests for the harness-agnostic core. No engine, no UI: plain
// functions in, plain values out.

import { describe, expect, test } from 'claude-code/testing'

import {
  addAgent,
  adoptAgents,
  barCells,
  columns,
  countToolCall,
  elapsed,
  endAgent,
  fit,
  labels,
  summarize,
  tasksFromTodos,
  updateTask,
  upsertTask,
} from './core'
import type { AgentRow } from './core'

const agent = (over: Partial<AgentRow> = {}): AgentRow => ({
  id: 'a1',
  type: 'general-purpose',
  description: 'Implement E1',
  background: false,
  status: 'running',
  startedAt: 0,
  toolCalls: 0,
  ...over,
})

describe('agents', () => {
  test('addAgent ignores an id it already has', async () => {
    const list = addAgent([agent()], agent({ description: 'other' }))
    expect(list).toHaveLength(1)
    expect(list[0]?.description).toBe('Implement E1')
  })

  test('countToolCall counts for that agent only', async () => {
    const list = countToolCall([agent(), agent({ id: 'a2' })], 'a2')
    expect(list.map(a => a.toolCalls)).toEqual([0, 1])
  })

  test('endAgent closes a running agent and keeps the first end', async () => {
    const once = endAgent([agent()], 'a1', 'completed', 5_000)
    expect(once[0]).toMatchObject({ status: 'completed', endedAt: 5_000 })
    const twice = endAgent(once, 'a1', 'failed', 9_000)
    expect(twice[0]).toMatchObject({ status: 'completed', endedAt: 5_000 })
  })

  test('adoptAgents adds only the unknown ones, mapping their status', async () => {
    const list = adoptAgents(
      [agent()],
      [
        { id: 'a1', type: 'x', description: 'x', status: 'running' },
        { id: 'a2', type: 'Explore', description: 'scan', status: 'waiting' },
        { id: 'a3', type: 'Plan', description: 'plan', status: 'killed' },
      ],
      1_000,
    )
    expect(list.map(a => [a.id, a.status])).toEqual([
      ['a1', 'running'],
      ['a2', 'running'],
      ['a3', 'failed'],
    ])
    expect(list[2]?.endedAt).toBe(1_000)
  })
})

describe('tasks', () => {
  test('upsertTask adds then updates by id', async () => {
    const one = upsertTask([], { id: 't1', subject: 'E1', status: 'pending' })
    const two = upsertTask(one, { id: 't1', subject: 'E1', status: 'in_progress' })
    expect(two).toEqual([{ id: 't1', subject: 'E1', status: 'in_progress' }])
  })

  test('updateTask changes status, or removes on deleted', async () => {
    const list = [
      { id: 't1', subject: 'E1', status: 'pending' as const },
      { id: 't2', subject: 'E2', status: 'pending' as const },
    ]
    expect(updateTask(list, 't1', 'completed')[0]?.status).toBe('completed')
    expect(updateTask(list, 't1', 'deleted').map(t => t.id)).toEqual(['t2'])
  })
})

describe('todos', () => {
  test('tasksFromTodos turns each todo into a task with a positional id', async () => {
    const todos = [
      { content: 'Plan', status: 'pending' as const },
      { content: 'Build', status: 'in_progress' as const },
      { content: 'Ship', status: 'completed' as const },
    ]
    expect(tasksFromTodos(todos)).toEqual([
      { id: 'todo-0', subject: 'Plan', status: 'pending' },
      { id: 'todo-1', subject: 'Build', status: 'in_progress' },
      { id: 'todo-2', subject: 'Ship', status: 'completed' },
    ])
  })

  test('tasksFromTodos of an empty list is empty', async () => {
    expect(tasksFromTodos([])).toEqual([])
  })
})

describe('summary', () => {
  test('counts live states as running and killed as failed', async () => {
    const s = summarize(
      [
        { status: 'running' },
        { status: 'waiting' },
        { status: 'completed' },
        { status: 'killed' },
      ],
      [{ status: 'pending' }, { status: 'in_progress' }, { status: 'completed' }],
    )
    expect(s.agents).toEqual({ running: 2, done: 1, failed: 1, total: 4 })
    expect(s.tasks).toEqual({ pending: 1, active: 1, done: 1, total: 3 })
  })
})

describe('layout', () => {
  test('barCells fills the width in proportion', async () => {
    const cells = barCells([1, 1, 2], 40)
    expect(cells.reduce((a, b) => a + b, 0)).toBe(40)
    expect(cells).toEqual([10, 10, 20])
  })

  test('barCells keeps a tiny value visible', async () => {
    const cells = barCells([1, 999], 20)
    expect(cells[0]).toBe(1)
  })

  test('barCells is empty when there is nothing', async () => {
    expect(barCells([0, 0], 20)).toEqual([0, 0])
  })

  test('columns always add up to the width on a normal pane', async () => {
    const c = columns(100)
    expect(2 + c.type + 1 + c.description + 1 + c.tools + c.time + c.background).toBe(100)
  })

  test('the type column fits general-purpose without cutting it', async () => {
    expect(fit('general-purpose', columns(80).type)).toBe('general-purpose')
  })

  test('fit cuts with an ellipsis or pads to the width', async () => {
    expect(fit('general-purpose', 10)).toBe('general-p…')
    expect(fit('Plan', 6)).toBe('Plan  ')
  })

  test('elapsed reads as seconds, minutes or hours', async () => {
    expect(elapsed(0, 42_000)).toBe('42s')
    expect(elapsed(0, 125_000)).toBe('2m05')
    expect(elapsed(0, 3_780_000)).toBe('1h03')
  })
})

describe('labels', () => {
  test('defaults to English and knows pt-BR', async () => {
    expect(labels(undefined).running).toBe('running')
    expect(labels('pt-BR').running).toBe('rodando')
    expect(labels('fr').running).toBe('running')
  })
})
