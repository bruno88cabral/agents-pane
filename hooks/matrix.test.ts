// Unit tests for the ticket-by-stage matrix. Plain functions, no engine; the
// descriptions are the ones of a real orchestration.

import { describe, expect, test } from 'claude-code/testing'

import { buildMatrix, cellTime, needsAttention, parseAgent, rowTime } from './matrix'
import type { MatrixAgent } from './matrix'

describe('parseAgent', () => {
  test('reads the stage before the ticket, the node or the task number', async () => {
    const read = (d: string) => {
      const p = parseAgent(d)
      return [p.ticket, p.stage, p.rest]
    }
    expect(read('Refinar N4 MYK-1154')).toEqual(['MYK-1154', 'Refinar', 'Refinar N4'])
    expect(read('Fatiar N4 MYK-1154')).toEqual(['MYK-1154', 'Fatiar', 'Fatiar N4'])
    expect(read('Implement MYK-983 spec S0')).toEqual(['MYK-983', 'Implement', 'Implement spec S0'])
    expect(read('Re-review MYK-983 fix round 1')).toEqual(['MYK-983', 'Re-review', 'Re-review fix round 1'])
    expect(read('Review Task 6 N4b (MYK-1169)')).toEqual(['MYK-1169', 'Review', 'Review Task 6 N4b'])
    expect(read('Refinar N11+N12 MYK-1161/1162')).toEqual(['MYK-1161', 'Refinar', 'Refinar N11+N12'])
    expect(read('Fatiar [MYK-7]: tela de menu')).toEqual(['MYK-7', 'Fatiar', 'Fatiar tela de menu'])
  })

  test('without a ticket there is none; without a cut the stage is the first word', async () => {
    expect(parseAgent('Implement Task 9: N5b sky card')).toMatchObject({ stage: 'Implement' })
    expect(parseAgent('Implement Task 9: N5b sky card').ticket).toBeUndefined()
    expect(parseAgent('Test artefato-resumo skill').stage).toBe('Test')
  })

  test('a description that starts with the ticket takes the first word after it', async () => {
    expect(parseAgent('MYK-1 spec')).toMatchObject({ ticket: 'MYK-1', stage: 'spec' })
  })
})

const agent = (over: Partial<MatrixAgent> & { id: string; description: string }): MatrixAgent => ({
  status: 'completed',
  startedAt: 0,
  endedAt: 60_000,
  toolCalls: 10,
  ...over,
})

describe('buildMatrix', () => {
  test('merges the attempts of one cell: a failed first try becomes a retry badge', async () => {
    const m = buildMatrix([
      agent({ id: 'a1', description: 'Refinar N4 MYK-1154', status: 'failed', startedAt: 0, endedAt: 1, toolCalls: 0 }),
      agent({ id: 'a2', description: 'Refinar N4 MYK-1154', startedAt: 5_000, endedAt: 5_000 + 411_000, toolCalls: 28 }),
      agent({ id: 'a3', description: 'Fatiar N4 MYK-1154', startedAt: 500_000, endedAt: 735_000, toolCalls: 20 }),
    ])
    expect(m.stages).toEqual(['Refinar', 'Fatiar'])
    expect(m.rows).toHaveLength(1)
    const [refinar, fatiar] = m.rows[0]!.cells
    expect(refinar).toMatchObject({ state: 'recovered', retries: 1 })
    expect(refinar?.last?.id).toBe('a2')
    expect(refinar?.attempts.map(a => a.id)).toEqual(['a1', 'a2'])
    expect(fatiar).toMatchObject({ state: 'ok', retries: 0 })
    expect(cellTime(refinar!)).toBe(411_000)
    expect(rowTime(m.rows[0]!)).toBe(411_000 + 235_000)
    expect(m.rows[0]?.state).toBe('ready')
  })

  test('a stage the ticket has not reached is queued, and does not keep it from ready', async () => {
    const m = buildMatrix([
      agent({ id: 'a1', description: 'Refinar N3 MYK-1153' }),
      agent({ id: 'a2', description: 'Fatiar N3 MYK-1153', startedAt: 1 }),
      agent({ id: 'a3', description: 'Refinar N5 MYK-1155', startedAt: 2 }),
    ])
    const n5 = m.rows.find(r => r.ticket === 'MYK-1155')!
    expect(n5.cells.map(c => c.state)).toEqual(['ok', 'queued'])
    expect(n5.cells[1]?.last).toBeUndefined()
    expect(n5.state).toBe('ready')
  })

  test('the latest attempt sets the state: a failure after a success is open', async () => {
    const m = buildMatrix([
      agent({ id: 'a1', description: 'Fatiar N7 MYK-1157', startedAt: 0 }),
      agent({ id: 'a2', description: 'Fatiar N7 MYK-1157', status: 'failed', startedAt: 10 }),
    ])
    expect(m.rows[0]?.cells[0]).toMatchObject({ state: 'failed', retries: 0 })
    expect(m.rows[0]?.state).toBe('failed')
  })

  test('rows that need the person come first, then the rest in the order they began', async () => {
    const m = buildMatrix([
      agent({ id: 'a1', description: 'Refinar N1 MYK-1', startedAt: 0 }),
      agent({ id: 'a2', description: 'Refinar N2 MYK-2', startedAt: 1, status: 'running', endedAt: undefined }),
      agent({ id: 'a3', description: 'Refinar N3 MYK-3', startedAt: 2, status: 'failed' }),
      agent({ id: 'a4', description: 'Refinar N4 MYK-4', startedAt: 3, status: 'waiting' }),
      agent({ id: 'a5', description: 'Refinar N5 MYK-5', startedAt: 4 }),
    ])
    expect(m.rows.map(r => [r.ticket, r.state])).toEqual([
      ['MYK-4', 'waiting'],
      ['MYK-3', 'failed'],
      ['MYK-2', 'running'],
      ['MYK-1', 'ready'],
      ['MYK-5', 'ready'],
    ])
  })

  test('an agent the engine does not list is running, not waiting', async () => {
    const m = buildMatrix([
      agent({ id: 'a1', description: 'Refinar N1 MYK-1', status: 'waiting', unlisted: true }),
    ])
    expect(m.rows[0]?.cells[0]?.state).toBe('running')
  })

  test('agents with no ticket stay loose, in the order given', async () => {
    const m = buildMatrix([
      agent({ id: 'a1', description: 'Implement Task 1: N1 three upgrade' }),
      agent({ id: 'a2', description: 'Refinar N4 MYK-1154', startedAt: 1 }),
      agent({ id: 'a3', description: 'Review Task 1 (spec + quality)', startedAt: 2 }),
    ])
    expect(m.loose.map(a => a.id)).toEqual(['a1', 'a3'])
    expect(m.rows.map(r => r.ticket)).toEqual(['MYK-1154'])
  })

  test('no agents, no matrix', async () => {
    expect(buildMatrix([])).toEqual({ stages: [], rows: [], loose: [] })
  })
})

describe('needsAttention', () => {
  const m = buildMatrix([
    agent({ id: 'a1', description: 'Refinar N6 MYK-1156', status: 'waiting', startedAt: 0, waitingSince: 50_000 }),
    agent({ id: 'a2', description: 'Fatiar N7 MYK-1157', status: 'failed', startedAt: 1 }),
    agent({ id: 'a3', description: 'Implement Task 9: N5b sky card', status: 'waiting', startedAt: 2, waitingSince: 20_000 }),
    agent({ id: 'a4', description: 'Implement Task 8: N5a sky model', status: 'waiting', unlisted: true, startedAt: 3 }),
    agent({ id: 'a5', description: 'Review Task 2', status: 'failed', startedAt: 4 }),
  ])

  test('lists what waits, the longest first, loose agents too, and open failures of cells', async () => {
    const { waiting, failed } = needsAttention(m)
    expect(waiting.map(w => [w.agent.id, w.label, w.cell])).toEqual([
      ['a3', 'Implement Task 9: N5b sky card', undefined],
      ['a1', 'MYK-1156 · Refinar N6', 'cell:MYK-1156:refinar'],
    ])
    expect(failed.map(f => [f.agent.id, f.label, f.cell])).toEqual([
      ['a2', 'MYK-1157 · Fatiar N7', 'cell:MYK-1157:fatiar'],
    ])
  })
})
