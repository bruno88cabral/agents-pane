// Layout tests: the pane as plain text, no engine and no terminal. Each
// scenario's expected lines are its snapshot; a change to the layout shows
// here as a readable diff.

import { describe, expect, test } from 'claude-code/testing'

import { labels } from './core'
import { groupByTicket, layout, mark, plain, rates, sparkline } from './layout'
import type { LayoutAgent, LayoutInput } from './layout'

const MIN = 60_000
const NOW = 100 * MIN

const done = (id: string, description: string, toolCalls: number, seconds: number, over: Partial<LayoutAgent> = {}): LayoutAgent => ({
  id, type: 'general-purpose', description, background: true, status: 'completed',
  startedAt: 0, endedAt: seconds * 1000, toolCalls, ...over,
})

const TICKETED: LayoutAgent[] = [
  done('a1', 'Implement MYK-983 spec S0', 86, 926),
  done('a2', 'Review MYK-983 spec S0', 30, 247),
  done('a3', 'Re-review MYK-983 fix round 1', 4, 34),
  done('a4', 'Implement MYK-984 S1 classics+harness', 131, 1630),
  done('a5', 'Review MYK-984 S1 classics+harness', 29, 209),
  { id: 'a6', type: 'general-purpose', description: 'Implement MYK-986 Maxwell tunnel', background: true,
    status: 'running', startedAt: NOW - 128_000, toolCalls: 41, rates: [2, 4, 8, 10] },
]

const base: LayoutInput = {
  width: 64, height: 30, terminal: true, ascii: false, now: NOW, name: 'racing-web',
  context: { tokens: 583_000, window: 1_000_000, percent: 58 },
  agents: TICKETED, labels: labels('en'),
}

const SCENARIOS: Record<string, LayoutInput> = {
  'normal, grouped by ticket': base,
  'some without a ticket': {
    ...base,
    agents: [...TICKETED, done('a7', 'Scan the repo for pane hooks', 12, 61, { type: 'Explore', background: false })],
  },
  'flat list, no ticket': {
    ...base,
    agents: [
      done('b1', 'Implement E1', 12, 300),
      done('b2', 'Review E1', 3, 60, { status: 'failed', background: false }),
      { ...done('b3', 'Plan E2', 0, 0, { type: 'Plan' }), status: 'pending', endedAt: undefined, startedAt: NOW },
    ],
    tasks: { pending: 1, active: 1, done: 3, total: 5 },
  },
  'compact (height 10)': { ...base, height: 10 },
  'width 40': { ...base, width: 40 },
  'ASCII fallback': { ...base, ascii: true },
  'long description cut with an ellipsis': {
    ...base,
    agents: [done('c1', 'MYK-990 Rewrite the whole renderer so that every column lines up across rows', 7, 3_725)],
  },
}

describe('scenarios', () => {
  test("normal, grouped by ticket", async () => {
    expect(plain(layout(SCENARIOS["normal, grouped by ticket"]!))).toEqual([
      ' █▀▄ ▄▀▄ ▄▀▀ ▀█▀ █▀▄ ▄▀▀     █ █ █▀▀ █▀▄',
      ' █▀▄ █▀█ █    █  █ █ █ █ ▀▀▀ ███ █▀  █▀▄',
      ' ▀ ▀ ▀ ▀  ▀▀ ▀▀▀ ▀ ▀  ▀▀     ▀ ▀ ▀▀▀ ▀▀',
      '',
      ' context     583k / 1M  ████████████░░░░░░░░  58%',
      '',
      ' agents     5 / 6 done  ████████████████████  83%   ● 1 running',
      '',
      ' ── agents ─────────────────────────────────────────────────────',
      ' MYK-983  spec S0',
      '   ✓  Implement                            86t   15m26  bg',
      '   ✓  Review                               30t    4m07  bg',
      '   ✓  Re-review fix round 1                 4t     34s  bg',
      '',
      ' MYK-984  S1 classics+harness',
      '   ✓  Implement                           131t   27m10  bg',
      '   ✓  Review                               29t    3m29  bg',
      '',
      ' MYK-986  Maxwell tunnel',
      '   ◐  Implement                            41t    2m08  bg  ▂▄▇█',
    ])
  })

  test("some without a ticket", async () => {
    expect(plain(layout(SCENARIOS["some without a ticket"]!))).toEqual([
      ' █▀▄ ▄▀▄ ▄▀▀ ▀█▀ █▀▄ ▄▀▀     █ █ █▀▀ █▀▄',
      ' █▀▄ █▀█ █    █  █ █ █ █ ▀▀▀ ███ █▀  █▀▄',
      ' ▀ ▀ ▀ ▀  ▀▀ ▀▀▀ ▀ ▀  ▀▀     ▀ ▀ ▀▀▀ ▀▀',
      '',
      ' context     583k / 1M  ████████████░░░░░░░░  58%',
      '',
      ' agents     6 / 7 done  ████████████████████  86%   ● 1 running',
      '',
      ' ── agents ─────────────────────────────────────────────────────',
      ' MYK-983  spec S0',
      '   ✓  Implement                   86t   15m26  bg',
      '   ✓  Review                      30t    4m07  bg',
      '   ✓  Re-review fix round 1        4t     34s  bg',
      '',
      ' MYK-984  S1 classics+harness',
      '   ✓  Implement                  131t   27m10  bg',
      '   ✓  Review                      29t    3m29  bg',
      '',
      ' MYK-986  Maxwell tunnel',
      '   ◐  Implement                   41t    2m08  bg           ▂▄▇█',
      '',
      '   ✓  Scan the repo for pane h…   12t    1m01      Explore',
    ])
  })

  test("flat list, no ticket", async () => {
    expect(plain(layout(SCENARIOS["flat list, no ticket"]!))).toEqual([
      ' █▀▄ ▄▀▄ ▄▀▀ ▀█▀ █▀▄ ▄▀▀     █ █ █▀▀ █▀▄',
      ' █▀▄ █▀█ █    █  █ █ █ █ ▀▀▀ ███ █▀  █▀▄',
      ' ▀ ▀ ▀ ▀  ▀▀ ▀▀▀ ▀ ▀  ▀▀     ▀ ▀ ▀▀▀ ▀▀',
      '',
      ' context     583k / 1M  ████████████░░░░░░░░  58%',
      '',
      ' agents     2 / 3 done  ████████████████████  67%   ● 1 running',
      ' tasks      3 / 5 done  ████████████████░░░░  60%   ◐ 1 active',
      '',
      ' ── agents ─────────────────────────────────────────────────────',
      ' ✓  Implement E1                           12t    5m00  bg',
      ' ✗  Review E1                               3t    1m00',
      ' ·  Plan E2                                 0t      0s  bg  Plan',
    ])
  })

  test("compact (height 10)", async () => {
    expect(plain(layout(SCENARIOS["compact (height 10)"]!))).toEqual([
      ' RACING-WEB',
      ' ctx 58% · agents 5/6 · ● 1 running',
      ' ✓  Implement MYK-983 spec S0              86t   15m26  bg',
      ' ✓  Review MYK-983 spec S0                 30t    4m07  bg',
      ' ✓  Re-review MYK-983 fix round 1           4t     34s  bg',
      ' ✓  Implement MYK-984 S1 classics+harne…  131t   27m10  bg',
      ' ✓  Review MYK-984 S1 classics+harness     29t    3m29  bg',
      ' ◐  Implement MYK-986 Maxwell tunnel       41t    2m08  bg  ▂▄▇█',
    ])
  })

  test("width 40", async () => {
    expect(plain(layout(SCENARIOS["width 40"]!))).toEqual([
      ' █▀▄ ▄▀▄ ▄▀▀ ▀█▀ █▀▄ ▄▀▀     █ █ █▀▀ █▀▄',
      ' █▀▄ █▀█ █    █  █ █ █ █ ▀▀▀ ███ █▀  █▀▄',
      ' ▀ ▀ ▀ ▀  ▀▀ ▀▀▀ ▀ ▀  ▀▀     ▀ ▀ ▀▀▀ ▀▀',
      '',
      ' context     583k / 1M  ██████░░░░░  58%',
      '',
      ' agents     5 / 6 done  ███████████  83%',
      '',
      ' ── agents ─────────────────────────────',
      ' MYK-983  spec S0',
      '   ✓  Implement    86t   15m26  bg',
      '   ✓  Review       30t    4m07  bg',
      '   ✓  Re-review…    4t     34s  bg',
      '',
      ' MYK-984  S1 classics+harness',
      '   ✓  Implement   131t   27m10  bg',
      '   ✓  Review       29t    3m29  bg',
      '',
      ' MYK-986  Maxwell tunnel',
      '   ◐  Implement    41t    2m08  bg  ▂▄▇█',
    ])
  })

  test("ASCII fallback", async () => {
    expect(plain(layout(SCENARIOS["ASCII fallback"]!))).toEqual([
      ' RACING-WEB',
      '',
      ' context     583k / 1M  ############--------  58%',
      '',
      ' agents     5 / 6 done  ####################  83%   * 1 running',
      '',
      ' -- agents -----------------------------------------------------',
      ' MYK-983  spec S0',
      '   ok  Implement                                 86t   15m26  bg',
      '   ok  Review                                    30t    4m07  bg',
      '   ok  Re-review fix round 1                      4t     34s  bg',
      '',
      ' MYK-984  S1 classics+harness',
      '   ok  Implement                                131t   27m10  bg',
      '   ok  Review                                    29t    3m29  bg',
      '',
      ' MYK-986  Maxwell tunnel',
      '   ..  Implement                                 41t    2m08  bg',
    ])
  })

  test("long description cut with an ellipsis", async () => {
    expect(plain(layout(SCENARIOS["long description cut with an ellipsis"]!))).toEqual([
      ' █▀▄ ▄▀▄ ▄▀▀ ▀█▀ █▀▄ ▄▀▀     █ █ █▀▀ █▀▄',
      ' █▀▄ █▀█ █    █  █ █ █ █ ▀▀▀ ███ █▀  █▀▄',
      ' ▀ ▀ ▀ ▀  ▀▀ ▀▀▀ ▀ ▀  ▀▀     ▀ ▀ ▀▀▀ ▀▀',
      '',
      ' context     583k / 1M  ████████████░░░░░░░░  58%',
      '',
      ' agents     1 / 1 done  ████████████████████ 100%   ● 0 running',
      '',
      ' ── agents ─────────────────────────────────────────────────────',
      ' MYK-990  Rewrite the whole renderer so that every column lines…',
      '   ✓  Rewrite the whole renderer so that ever…    7t   1h02m  bg',
    ])
  })

})

describe('rules', () => {
  test('below 40 columns the mode and the sparkline go, the right columns stay', async () => {
    const lines = plain(layout({ ...base, width: 39 }))
    const row = lines.find(l => l.includes('Maxwell') === false && l.includes('◐'))
    expect(row).toBe('   ◐  Implement             41t    2m08')
    expect(lines.some(l => l.includes(' bg'))).toBe(false)
  })

  test('from 12 rows the pane is no longer compact', async () => {
    expect(plain(layout({ ...base, height: 11 }))[0]).toBe(' RACING-WEB')
    expect(plain(layout({ ...base, height: 12 }))[0]).toBe(' █▀▄ ▄▀▄ ▄▀▀ ▀█▀ █▀▄ ▄▀▀     █ █ █▀▀ █▀▄')
  })

  test('off the terminal the name is a title, not big letters', async () => {
    const { header } = layout({ ...base, terminal: false })
    expect(header[0]).toEqual([{ text: 'racing-web', tone: 'accent', bold: true, title: true }])
  })

  test('the name falls back to plain text when the big letters do not fit', async () => {
    expect(plain(layout({ ...base, width: 30 }))[0]).toBe(' RACING-WEB')
  })

  test('no agents yet says so under the separator', async () => {
    const lines = plain(layout({ ...base, agents: [] }))
    expect(lines.at(-1)).toBe(' No agents in this session yet.')
    expect(lines).toContain(' agents     0 / 0 done  ░░░░░░░░░░░░░░░░░░░░        ● 0 running')
  })

  test('the bars are colored: agents done, running and failed; tasks done and active', async () => {
    const tonesOf = (input: LayoutInput, label: string) =>
      layout(input).header.find(l => l.some(s => s.text.includes(label)))!
        .filter(s => /█/.test(s.text)).map(s => s.tone)
    const flat = SCENARIOS['flat list, no ticket']!
    expect(tonesOf(flat, 'agents ')).toEqual(['ok', 'error', 'accent'])
    expect(tonesOf(flat, 'tasks')).toEqual(['ok', 'warn'])
  })

  test('a blank line sits between the context and the agents', async () => {
    const lines = plain(layout(base))
    const ctx = lines.findIndex(l => l.includes('context'))
    expect(lines[ctx + 1]).toBe('')
    expect(lines[ctx + 2]).toContain('agents')
  })

  test('context is green below 70%, yellow from 70% and red from 85%', async () => {
    const row = (percent: number) =>
      layout({ ...base, context: { tokens: 1, window: 1, percent } }).header.find(l =>
        l.some(s => s.text.includes('context')),
      )!
    const tones = (percent: number) => [...new Set(row(percent).map(s => s.tone).filter(t => t && t !== 'dim'))]
    expect(tones(69)).toEqual(['ok'])
    expect(tones(70)).toEqual(['warn'])
    expect(tones(84)).toEqual(['warn'])
    expect(row(85).filter(s => s.tone === 'error').map(s => s.text)).toEqual(['       1 / 1', '█████████████████', '  85%'])
  })

  test('statuses: running in the accent, done ok, failed error, pending dim', async () => {
    const agents: LayoutAgent[] = (['running', 'completed', 'failed', 'pending'] as const).map((status, i) => ({
      id: `s${i}`, type: 'general-purpose', description: status, background: false, status,
      startedAt: 0, endedAt: status === 'running' || status === 'pending' ? undefined : 1000, toolCalls: 0,
    }))
    const glyphs = layout({ ...base, agents }).body.map(l => l[1])
    expect(glyphs).toEqual([
      { text: '◐', tone: 'accent' },
      { text: '✓', tone: 'ok' },
      { text: '✗', tone: 'error' },
      { text: '·', tone: 'dim' },
    ])
  })

  test('only a type other than general-purpose shows', async () => {
    const lines = plain(layout(SCENARIOS['some without a ticket']!))
    expect(lines.filter(l => l.includes('general-purpose'))).toEqual([])
    expect(lines.filter(l => l.includes('Explore'))).toHaveLength(1)
  })
})

describe('grouping', () => {
  test('the ticket may come anywhere in the description', async () => {
    const groups = groupByTicket(TICKETED)!
    expect(groups.map(g => [g.ticket, g.subtitle, g.rows.map(r => r.text)])).toEqual([
      ['MYK-983', 'spec S0', ['Implement', 'Review', 'Re-review fix round 1']],
      ['MYK-984', 'S1 classics+harness', ['Implement', 'Review']],
      ['MYK-986', 'Maxwell tunnel', ['Implement']],
    ])
  })

  test('a description that is only the ticket and its subtitle keeps the subtitle', async () => {
    const [group] = groupByTicket([{ ...TICKETED[0]!, description: 'MYK-1 spec' }])!
    expect(group?.rows[0]?.text).toBe('spec')
  })

  test('no ticket anywhere keeps the list flat', async () => {
    expect(groupByTicket([{ ...TICKETED[0]!, description: 'Implement E1' }])).toBeUndefined()
  })
})

describe('sparkline', () => {
  test('scales to the busiest interval and pads the missing ones', async () => {
    expect(sparkline([1, 2, 4, 8])).toBe('▁▂▄█')
    expect(sparkline([3])).toBe('   █')
    expect(sparkline([0, 0])).toBe('  ▁▁')
  })

  test('marks keep the count at each minute and rates read the intervals', async () => {
    let m = mark(undefined, 0, 0)
    m = mark(m, 30_000, 5) // same minute: nothing new
    m = mark(m, 60_000, 6)
    m = mark(m, 120_000, 10)
    m = mark(m, 300_000, 12) // two quiet minutes in between
    expect(m.counts).toEqual([6, 10, 10, 10, 12])
    expect(rates(m, 15)).toEqual([0, 0, 2, 3])
  })
})
