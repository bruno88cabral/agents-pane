// Layout tests of the matrix view: plain data in, lines out, no engine. The
// scenario is a slice of a real orchestration (tickets refined and sliced,
// one waiting, one failed, one that recovered on a retry).

import { describe, expect, test } from 'claude-code/testing'

import { labels } from './core'
import { plain } from './layout'
import type { LayoutAgent, LayoutInput, Segment } from './layout'
import { matrixLayout } from './matrix-layout'

const NOW = 10_000_000
const min = (n: number) => n * 60_000

const agent = (
  id: string,
  description: string,
  status: LayoutAgent['status'],
  startedAt: number,
  took: number,
  toolCalls: number,
  over: Partial<LayoutAgent> = {},
): LayoutAgent => ({
  id,
  type: 'general-purpose',
  description,
  background: true,
  status,
  startedAt,
  ...(status === 'completed' || status === 'failed' ? { endedAt: startedAt + took } : {}),
  toolCalls,
  ...over,
})

const AGENTS: LayoutAgent[] = [
  agent('a1', 'Refinar N1 MYK-1151', 'completed', 0, min(5) + 41_000, 28),
  agent('a2', 'Refinar N3 MYK-1153', 'completed', 10, min(7) + 12_000, 24),
  agent('a3', 'Fatiar N3 MYK-1153', 'completed', 20, min(2) + 25_000, 14),
  agent('a4', 'Refinar N4 MYK-1154', 'failed', 30, 1, 0),
  agent('a5', 'Refinar N4 MYK-1154', 'completed', 40, min(6) + 51_000, 28),
  agent('a6', 'Fatiar N4 MYK-1154', 'completed', 50, min(3) + 55_000, 20),
  agent('a7', 'Refinar N6 MYK-1156', 'waiting', 60, 0, 12, { waitingSince: NOW - min(4), lastTool: 'Bash' }),
  agent('a8', 'Refinar N7 MYK-1157', 'completed', 70, min(4) + 2_000, 22),
  agent('a9', 'Fatiar N7 MYK-1157', 'failed', 80, 3_000, 6),
  agent('a10', 'Implement Task 9: N5b sky card', 'running', NOW - min(51), 0, 160),
]

const base: LayoutInput = {
  width: 80,
  height: 40,
  terminal: true,
  ascii: false,
  now: NOW,
  name: 'racing-web',
  context: { tokens: 387_000, window: 1_000_000, percent: 39 },
  git: { branch: 'bruno88cabral/myk-1149-m23-fase-a', detached: false, worktree: true, changed: 36, ahead: 0, behind: 0 },
  limits: [
    { kind: 'five_hour', percent: 14, resetsAt: NOW + min(200) },
    { kind: 'seven_day', percent: 62 },
  ],
  session: { startedAt: NOW - min(1247), usd: 237.37 },
  agents: AGENTS,
  labels: labels('pt-BR'),
}

const draw = (over: Partial<LayoutInput> = {}) => matrixLayout({ ...base, ...over })!
const text = (over: Partial<LayoutInput> = {}) => plain(draw(over))
const STRIP = (width: number, glyph = '━') => ` ${glyph.repeat(width - 1)}`

describe('the matrix', () => {
  test('a header, the tickets by stage, those with no ticket and the legend', async () => {
    expect(text()).toEqual([
      STRIP(80),
      ' RACING-WEB  myk-1149-m23-fase-a ●36  ctx 39%  5h 14%  sem 62%  $237.37',
      ' ███ ███ ███ ███ ███  3 de 5 tickets prontos',
      ' ◐ 1 agente aguardando você   ⏎ abrir',
      '   MYK-1156 · Refinar N6 · parado depois de Bash · há 4m',
      ' ── agentes ───────────────────────────  ←↑↓→ mover  ⏎ abrir  r: retry  v: lista',
      ' ticket    1 · Refinar               2 · Fatiar                  total',
      ' MYK-1156  ◐ aguardando · 4m         · na fila                       —',
      ' MYK-1157  ✓ 4m02 · 22t              ✗ falha · r                  4m02',
      ' MYK-1151  ✓ 5m41 · 28t              · na fila                    5m41',
      ' MYK-1153  ✓ 7m12 · 24t              ✓ 2m25 · 14t                 9m37',
      ' MYK-1154  ✓ 6m51 ↻1 · 28t           ✓ 3m55 · 20t                10m46',
      '',
      ' sem ticket',
      '   ◐  Implement Task 9: N5b sky card                                160t   51m00',
      '',
      ' ✓ ok   ↻ recuperou no retry   ● rodando   ◐ aguardando você   ✗ falha aberta',
    ])
  })

  test('the retries of one stage are one cell, and the old failure leaves no row of its own', async () => {
    const lines = text()
    expect(lines.filter(l => l.includes('MYK-1154'))).toHaveLength(1)
    expect(lines.some(l => /✗ +0t/.test(l))).toBe(false)
  })

  test('with room the meters draw their bars and the session its time', async () => {
    expect(text({ width: 120 })[1]).toBe(
      ' RACING-WEB  myk-1149-m23-fase-a ●36  ctx ██░░░░ 39%  5h █░░░░░ 14%  sem ████░░ 62%  20h47m · $237.37',
    )
  })

  test('the stages come from the agents names, so another set of names gives other columns', async () => {
    const lines = text({
      agents: [
        agent('b1', 'Plan MYK-1', 'completed', 0, 1000, 3),
        agent('b2', 'Build MYK-1', 'completed', 10, 2000, 4),
        agent('b3', 'Ship MYK-1', 'completed', 20, 3000, 5),
      ],
    })
    expect(lines.find(l => l.startsWith(' ticket'))).toMatch(/^ ticket +1 · Plan +2 · Build +3 · Ship +total$/)
  })
})

describe('what needs the person', () => {
  test('the strip is green when nothing waits, amber when something does, red over a limit', async () => {
    const strip = (over: Partial<LayoutInput>) => draw(over).header[0]![1]!
    const quiet = AGENTS.filter(a => a.status === 'completed' || a.status === 'running')
    expect(strip({ agents: quiet })).toMatchObject({ tone: 'ok' })
    expect(strip({})).toMatchObject({ tone: 'warn' })
    expect(strip({ limits: [{ kind: 'five_hour', percent: 91, resetsAt: NOW + min(22) }] })).toMatchObject({ tone: 'error' })
  })

  test('over 85% a line names the limit and when it resets', async () => {
    const lines = text({ limits: [{ kind: 'five_hour', percent: 91, resetsAt: NOW + min(22) }] })
    expect(lines[2]).toBe(' ▲ limite 5h em 91% · reseta em 22m · segure novos agentes')
    expect(text({ limits: [{ kind: 'five_hour', percent: 85 }] })[2]).toBe(' ▲ limite 5h em 85% · segure novos agentes')
    expect(text().some(l => l.includes('▲'))).toBe(false)
  })

  test('the banner shows only while an agent waits, with the ticket, the stage and the time', async () => {
    expect(text().filter(l => l.includes('aguardando você'))).toHaveLength(2)
    const quiet = text({ agents: AGENTS.filter(a => a.status !== 'waiting') })
    expect(quiet.some(l => l.includes('agente aguardando'))).toBe(false)
    expect(quiet.some(l => l.includes('⏎ abrir'))).toBe(true)
  })

  test('several waiting: the count, and the one waiting longest named', async () => {
    const more = [
      ...AGENTS,
      agent('a11', 'Fatiar N8 MYK-1158', 'waiting', 90, 0, 3, { waitingSince: NOW - min(30) }),
    ]
    const lines = text({ agents: more })
    expect(lines[3]).toBe(' ◐ 2 agentes aguardando você   ⏎ abrir')
    expect(lines[4]).toBe('   MYK-1158 · Fatiar N8 · em trabalho em background · há 30m')
  })

  test('an agent the engine does not list is not asking for anyone', async () => {
    const lines = text({
      agents: [agent('c1', 'Refinar N1 MYK-1', 'waiting', NOW - min(2), 0, 5, { unlisted: true })],
    })
    expect(lines.some(l => l.includes('agente aguardando'))).toBe(false)
    expect(lines.find(l => l.startsWith(' MYK-1'))).toMatch(/^ MYK-1 +◐ 2m00 · 5t/)
    expect(draw({ agents: [agent('c1', 'Refinar N1 MYK-1', 'waiting', NOW - min(2), 0, 5, { unlisted: true })] }).header[0]![1]).toMatchObject({ tone: 'ok' })
  })

  test('the words are English with the English labels', async () => {
    const lines = text({ labels: labels('en') })
    expect(lines[3]).toBe(' ◐ 1 agent waiting for you   ⏎ open')
    expect(lines[4]).toBe('   MYK-1156 · Refinar N6 · stopped after Bash · 4m ago')
    expect(lines[5]).toMatch(/← ↑ ↓ →|←↑↓→ move +⏎ open +r: retry +v: list$/)
  })
})

describe('keys', () => {
  const pressed = (over: Partial<LayoutInput> = {}) => {
    const out = draw(over)
    const all = [...out.header, ...out.body].flat()
    return { out, keys: [...new Set(all.map(s => s.press).filter(Boolean))] as string[], all }
  }

  test('each cell with an agent is one button, a stage not reached is none', async () => {
    const { out, keys } = pressed()
    expect(keys).toEqual([
      'urgent',
      'retry',
      'view',
      'cell:MYK-1156:refinar',
      'cell:MYK-1157:refinar',
      'cell:MYK-1157:fatiar',
      'cell:MYK-1151:refinar',
      'cell:MYK-1153:refinar',
      'cell:MYK-1153:fatiar',
      'cell:MYK-1154:refinar',
      'cell:MYK-1154:fatiar',
    ])
    expect(out.targets['cell:MYK-1154:refinar']).toEqual({ agentId: 'a5', description: 'Refinar N4 MYK-1154', state: 'recovered' })
    expect(out.targets['cell:MYK-1157:fatiar']).toMatchObject({ agentId: 'a9', state: 'failed' })
    expect(out.targets['cell:MYK-1151:fatiar']).toBeUndefined()
  })

  test('a cell is one run of segments under one key, as wide as its column', async () => {
    const { all } = pressed()
    const cell = all.filter(s => s.press === 'cell:MYK-1154:refinar')
    expect(cell.map(s => s.text).join('')).toBe('✓ 6m51 ↻1 · 28t'.padEnd(24))
    expect(cell.find(s => s.text === '↻1')).toMatchObject({ tone: 'warn' })
  })

  test('⏎ opens the one waiting longest; with none waiting, the first open failure', async () => {
    expect(draw().urgent).toEqual({ agentId: 'a7', description: 'Refinar N6 MYK-1156', state: 'waiting' })
    const noWait = draw({ agents: AGENTS.filter(a => a.status !== 'waiting') })
    expect(noWait.urgent).toMatchObject({ agentId: 'a9', state: 'failed' })
  })

  test('with only a failure the ⏎ button moves to the rule, red, and there is no banner', async () => {
    const out = draw({ agents: AGENTS.filter(a => a.status !== 'waiting') })
    const line = out.header.find(l => l.some(s => s.press === 'urgent'))!
    expect(plain({ header: [line], body: [] })[0]).toMatch(/^ ── agentes ─+  ←↑↓→ mover  ⏎ abrir  r: retry  v: lista$/)
    expect(line.find(s => s.press === 'urgent')).toMatchObject({ tone: 'error' })
    expect(out.header.some(l => l.some(s => s.text.includes('agente aguardando')))).toBe(false)
  })

  test('r asks for the first open failure; there is no r when none failed', async () => {
    expect(draw().retry).toEqual({ agentId: 'a9', description: 'Fatiar N7 MYK-1157', state: 'failed' })
    const healthy = pressed({ agents: AGENTS.filter(a => a.status === 'completed') })
    expect(healthy.keys).not.toContain('retry')
    expect(healthy.keys).not.toContain('urgent')
    expect(healthy.out.retry).toBeUndefined()
    expect(healthy.out.urgent).toBeUndefined()
    expect(healthy.all.find(s => s.press === 'view')).toMatchObject({ hotkey: 'v', text: 'lista' })
  })

  test('v and r come with their keys, drawn before the words', async () => {
    const { all } = pressed()
    expect(all.find(s => s.press === 'retry')).toMatchObject({ hotkey: 'r', text: 'retry' })
    expect(all.find(s => s.press === 'view')).toMatchObject({ hotkey: 'v', text: 'lista' })
  })

  test('on a narrow pane the rule keeps v and r and drops the hints first', async () => {
    // one stage is the narrowest matrix: 36 columns
    const one = [
      agent('n1', 'Refinar N1 MYK-1', 'failed', 0, 10, 1),
      agent('n2', 'Refinar N2 MYK-2', 'completed', 20, 1000, 4),
    ]
    const rule = (width: number) => text({ width, agents: one }).find(l => l.startsWith(' ── agentes'))!
    expect(rule(60)).toMatch(/←↑↓→ mover {2}⏎ abrir {2}r: retry {2}v: lista$/)
    expect(rule(46)).toMatch(/ {2}⏎ abrir {2}r: retry {2}v: lista$/)
    expect(rule(46)).not.toContain('←')
    expect(rule(40)).toMatch(/ {2}r: retry {2}v: lista$/)
    expect(rule(40)).not.toContain('⏎')
    expect(rule(36).length).toBeLessThanOrEqual(36)
  })
})

describe('the cells', () => {
  test('a running cell is blue and still when drawn still, and spins with a frame', async () => {
    const running = [agent('r1', 'Refinar N1 MYK-1', 'running', NOW - min(2) - 8_000, 0, 41)]
    const still = draw({ agents: running })
    const dot = [...still.body.flat()].find(s => s.press === 'cell:MYK-1:refinar')!
    expect(dot).toMatchObject({ text: '●', color: '#6BA6F0' })
    const row = (lines: string[]) => lines.find(l => l.startsWith(' MYK-1'))
    expect(row(plain(still))).toMatch(/^ MYK-1 +● 2m08 · 41t/)

    const spinning = draw({ agents: running, frame: 0 })
    expect(row(plain(spinning))).toMatch(/^ MYK-1 +⠋ 2m08 · 41t/)
    expect(spinning.body.flat().find(s => s.press && s.text === '⠋')?.color).toBeDefined()
  })

  test('an idle cell is dim, a failed one red with its retries', async () => {
    const lines = text({
      agents: [
        agent('i1', 'Refinar N1 MYK-1', 'idle', NOW - min(3), 0, 9),
        agent('f1', 'Refinar N2 MYK-2', 'failed', 0, 10, 1),
        agent('f2', 'Refinar N2 MYK-2', 'failed', 20, 10, 1),
      ],
    })
    expect(lines.find(l => l.startsWith(' MYK-1'))).toMatch(/○ ocioso · 3m00/)
    expect(lines.find(l => l.startsWith(' MYK-2'))).toMatch(/✗ falha ↻1 · r/)
  })

  test('the ticket total sums the cells that finished, or shows a dash', async () => {
    const lines = text()
    expect(lines.find(l => l.startsWith(' MYK-1153'))).toMatch(/9m37$/)
    expect(lines.find(l => l.startsWith(' MYK-1156'))).toMatch(/—$/)
  })

  test('in ASCII the glyphs keep their column', async () => {
    const lines = text({ ascii: true })
    expect(lines[0]).toBe(STRIP(80, '='))
    expect(lines[2]).toBe(' ### ### ### ### ###  3 de 5 tickets prontos')
    expect(lines[3]).toBe(' .. 1 agente aguardando você   ⏎ abrir')
    expect(lines.find(l => l.startsWith(' MYK-1157'))).toBe(' MYK-1157  ok 4m02 · 22t             x  falha · r                 4m02')
    expect(lines.find(l => l.startsWith(' MYK-1154'))).toMatch(/ok 6m51 r1 · 28t/)
  })
})

describe('the bar of tickets', () => {
  const blocks = (over: Partial<LayoutInput> = {}): Segment[] =>
    draw(over).header[2]!.filter(s => /^[█#]+$/.test(s.text))

  test('one block per ticket, in the color of its state', async () => {
    expect(blocks().map(s => [s.text.length, s.tone ?? s.color])).toEqual([
      [3, 'warn'],
      [3, 'error'],
      [3, 'ok'],
      [3, 'ok'],
      [3, 'ok'],
    ])
    const running = [agent('r1', 'Refinar N1 MYK-1', 'running', 0, 0, 1)]
    expect(blocks({ agents: running }).map(s => s.color)).toEqual(['#6BA6F0'])
  })

  test('with more tickets than cells it draws the same colors in proportion', async () => {
    const many = Array.from({ length: 70 }, (_, i) =>
      agent(`m${i}`, `Refinar N${i} MYK-${2000 + i}`, i < 60 ? 'completed' : 'failed', i, 10, 1),
    )
    const bar = blocks({ agents: many, width: 80 })
    expect(bar.reduce((n, s) => n + s.text.length, 0)).toBeLessThanOrEqual(40)
    expect(bar.map(s => s.tone)).toEqual(['ok', 'error'])
    expect(plain(draw({ agents: many, width: 80 }))[2]).toContain('60 de 70 tickets prontos')
  })
})

describe('when it is not drawn', () => {
  test('no agent names a ticket: there is no matrix', async () => {
    expect(matrixLayout({ ...base, agents: AGENTS.filter(a => a.id === 'a10') })).toBeUndefined()
    expect(matrixLayout({ ...base, agents: [] })).toBeUndefined()
  })

  test('the stages must fit: 16 cells each, else the list stays', async () => {
    // ticket 8 + total 7 + the gaps leave room for two cells of 16 from 54 columns
    expect(matrixLayout({ ...base, width: 54 })).toBeDefined()
    expect(matrixLayout({ ...base, width: 53 })).toBeUndefined()
  })

  test('on the terminal the header must leave rows for the list', async () => {
    // the header takes 6 rows here and the list asks for 5
    expect(matrixLayout({ ...base, height: 11 })).toBeDefined()
    expect(matrixLayout({ ...base, height: 10 })).toBeUndefined()
    expect(matrixLayout({ ...base, height: 10, terminal: false })).toBeDefined()
  })
})
