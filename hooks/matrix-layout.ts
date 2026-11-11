// The matrix view of the pane, as plain data: a header of one line, a bar of
// tickets, the agents that wait for the person, then ticket rows by stage.
//
// Like ./layout.ts it is pure. A cell the person can open is a run of
// segments sharing a `press` key; `targets` says which agent each key opens.

import { age, barCells, elapsed, fit, tidy } from './core'
import { agentRow, blank, clip, columnsFor, fillTone, GUTTER, MIN_LIST, seg, segWidth, spiral } from './layout'
import type { Layout, LayoutAgent, LayoutInput, Line, Segment, Tone } from './layout'
import { buildMatrix, cellKey, needsAttention, rowTime } from './matrix'
import type { Attention, Cell, CellState, Matrix, TicketRow, TicketState } from './matrix'

/** The one blue of the pane: a running cell, and a running ticket in the bar. */
const BLUE = '#6BA6F0'
const CELL_MIN = 16
const CELL_MAX = 24
const TOTAL = 7
const METER = 6
const BLOCK_MAX = 3

/** What a key of the pane opens: an agent, with the words to ask for a retry. */
export type PressTarget = { agentId: string; description: string; state: CellState }

export type MatrixLayout = Layout & {
  /** Cell keys to the agent each opens. */
  targets: Record<string, PressTarget>
  /** What `urgent` opens: the longest waiting, else the first open failure. */
  urgent?: PressTarget
  /** What `retry` asks to run again when no cell is under the cursor. */
  retry?: PressTarget
}

type Agent = LayoutAgent

// ---------- the header ----------

const meter = (label: string, pct: number | undefined, input: LayoutInput, bars: boolean): Segment[] => {
  const tone = fillTone(pct)
  const out: Segment[] = [seg(`${label} `, 'dim')]
  if (pct === undefined) return [...out, seg('—', 'dim')]
  if (bars) {
    const filled = Math.min(METER, Math.max(pct > 0 ? 1 : 0, Math.round((pct / 100) * METER)))
    out.push(seg((input.ascii ? '#' : '█').repeat(filled), tone))
    out.push(seg((input.ascii ? '-' : '░').repeat(METER - filled), 'dim'), seg(' '))
  }
  return [...out, seg(`${Math.round(pct)}%`, tone)]
}

const limitNames = (input: LayoutInput): Record<string, string> => ({
  five_hour: '5h',
  seven_day: input.labels.matrix.weekShort,
  spend_limit: input.labels.statSpend,
})

const gitMarks = (input: LayoutInput): Segment[] => {
  const git = input.git
  if (!git) return []
  const a = input.ascii
  return [
    ...(git.changed > 0 ? [seg(` ${a ? '*' : '●'}${git.changed}`, 'warn')] : []),
    ...(git.ahead > 0 ? [seg(` ${a ? '^' : '↑'}${git.ahead}`, 'accent')] : []),
    ...(git.behind > 0 ? [seg(` ${a ? 'v' : '↓'}${git.behind}`, 'warn')] : []),
  ]
}

const lineWidth = (line: Line): number => line.reduce((n, s) => n + segWidth(s), 0)

/** The name, the branch, the meters and the session, in one line that gives up its bars before its words. */
const titleLine = (input: LayoutInput): Line => {
  const t = input.labels
  const build = (bars: boolean, session: boolean): Line => {
    const groups: Segment[][] = []
    if (input.name) groups.push([seg(input.name.toUpperCase(), 'accent', true)])
    if (input.git) {
      groups.push([seg(input.git.branch.split('/').pop() || input.git.branch, undefined, true), ...gitMarks(input)])
    }
    if (input.context) groups.push(meter(t.statContextShort, input.context.percent, input, bars))
    const names = limitNames(input)
    for (const limit of input.limits ?? []) {
      groups.push(meter(names[limit.kind] ?? limit.kind, limit.percent, input, bars))
    }
    if (input.session) {
      const parts = [
        ...(session ? [elapsed(input.session.startedAt, input.now)] : []),
        ...(input.session.usd !== undefined ? [`$${input.session.usd.toFixed(2)}`] : []),
      ]
      if (parts.length > 0) groups.push([seg(parts.join(' · '))])
    }
    return [seg(GUTTER), ...groups.flatMap((g, i) => (i > 0 ? [seg('  '), ...g] : g))]
  }
  const tries = [build(true, true), build(true, false), build(false, false)]
  return tries.find(line => lineWidth(line) <= input.width) ?? tries[tries.length - 1]!
}

/** The limit past 85% that is closest to its ceiling, if any. */
const limitAlert = (input: LayoutInput): { name: string; percent: number; resetsIn?: string } | undefined => {
  const hot = (input.limits ?? []).filter(l => l.percent >= 85).sort((a, b) => b.percent - a.percent)[0]
  if (!hot) return undefined
  const resetsIn = hot.resetsAt !== undefined && hot.resetsAt > input.now ? age(input.now, hot.resetsAt) : undefined
  return { name: limitNames(input)[hot.kind] ?? hot.kind, percent: Math.round(hot.percent), ...(resetsIn && { resetsIn }) }
}

// ---------- the bar of tickets ----------

const STATE_TONE: Record<TicketState, { tone?: Tone; color?: string }> = {
  ready: { tone: 'ok' },
  waiting: { tone: 'warn' },
  failed: { tone: 'error' },
  running: { color: BLUE },
}

/** One block per ticket when each gets a cell or more; else the same colors in proportion. */
const ticketBar = (rows: readonly TicketRow[], width: number, ascii: boolean): Segment[] => {
  const block = ascii ? '#' : '█'
  const n = rows.length
  if (width < n) {
    const order: TicketState[] = ['ready', 'waiting', 'failed', 'running']
    const cells = barCells(order.map(s => rows.filter(r => r.state === s).length), width)
    return order.map((s, i) => ({ text: block.repeat(cells[i] ?? 0), ...STATE_TONE[s] })).filter(s => s.text)
  }
  const gap = width >= 2 * n - 1 ? 1 : 0
  const size = Math.max(1, Math.min(BLOCK_MAX, Math.floor((width - gap * (n - 1)) / n)))
  return rows.flatMap((row, i) => [
    ...(i > 0 && gap > 0 ? [seg(' ')] : []),
    { text: block.repeat(size), ...STATE_TONE[row.state] },
  ])
}

// ---------- the cells ----------

type Pieces = Segment[]

const retryBadge = (cell: Cell, ascii: boolean): Segment[] =>
  cell.retries > 0 ? [seg(' '), seg(`${ascii ? 'r' : '↻'}${cell.retries}`, 'warn')] : []

/** The glyph of a cell and the pieces after it, from the most to the least needed. */
const cellPieces = (cell: Cell, input: LayoutInput, line: number): Pieces[] => {
  const t = input.labels.matrix
  const a = input.ascii
  const last = cell.last
  const tools = last ? [seg(` · ${last.toolCalls}t`, 'dim')] : []
  const glyphWidth = a ? 2 : 1
  const g = (text: string, tone?: Tone, color?: string): Segment => ({
    ...seg(text.padEnd(glyphWidth), tone),
    ...(color && { color }),
  })

  switch (cell.state) {
    case 'ok':
    case 'recovered': {
      const time = elapsed(last!.startedAt, last!.endedAt ?? input.now)
      return [[g(a ? 'ok' : '✓', 'ok'), seg(` ${time}`)], retryBadge(cell, a), tools]
    }
    case 'running': {
      // A row the engine does not list stays still: nothing says it works.
      const glyph = last!.unlisted
        ? g(a ? '..' : '◐', 'accent')
        : input.frame !== undefined
          ? (s => ({ ...s, text: s.text.padEnd(glyphWidth) }))(spiral(input.frame, line, a))
          : g(a ? '*' : '●', undefined, BLUE)
      return [[glyph, seg(` ${elapsed(last!.startedAt, input.now)}`)], tools]
    }
    case 'waiting': {
      const since = last!.waitingSince ?? last!.startedAt
      return [[g(a ? '..' : '◐', 'warn'), seg(` ${t.waiting} · ${age(since, input.now)}`, 'warn', true)]]
    }
    case 'idle':
      return [[g(a ? '-' : '○', 'dim'), seg(` ${t.idle} · ${elapsed(last!.startedAt, input.now)}`, 'dim')]]
    case 'failed':
      return [[g(a ? 'x' : '✗', 'error'), seg(` ${t.failed}`, 'error')], retryBadge(cell, a), [seg(' · r', 'dim')]]
    default:
      return [[g(a ? '.' : '·', 'dim'), seg(` ${t.queued}`, 'dim')]]
  }
}

/** A cell as `width` cells of segments: pieces are dropped from the end until they fit. */
const cellSegments = (cell: Cell, input: LayoutInput, width: number, line: number): Segment[] => {
  const pieces = cellPieces(cell, input, line)
  const take = [...pieces]
  const size = (ps: Pieces[]) => ps.reduce((n, p) => n + lineWidth(p), 0)
  while (take.length > 1 && size(take) > width) take.pop()
  const segs = take.flat()
  return [...segs, seg(' '.repeat(Math.max(0, width - lineWidth(segs))))]
}

// ---------- the pane ----------

const matrixLegend = (input: LayoutInput): Line => {
  const t = input.labels.matrix
  const a = input.ascii
  const item = (glyph: Segment, word: string): Segment[] => [glyph, seg(` ${word}`, 'dim'), seg('   ')]
  return [
    seg(GUTTER),
    ...item(seg(a ? 'ok' : '✓', 'ok'), t.legendOk),
    ...item(seg(a ? 'r' : '↻', 'warn'), t.legendRecovered),
    ...item({ text: a ? '*' : '●', color: BLUE }, t.legendRunning),
    ...item(seg(a ? '..' : '◐', 'warn'), t.legendWaiting),
    ...item(seg(a ? 'x' : '✗', 'error'), t.legendFailed),
    ...item(seg(a ? '.' : '·', 'dim'), t.legendQueued),
  ]
}

const target = (item: Attention<Agent>, state: CellState): PressTarget => ({
  agentId: item.agent.id,
  description: item.agent.description,
  state,
})

/**
 * The pane as a matrix of tickets by stage, or undefined when it cannot be
 * drawn: no agent names a ticket, the stages do not fit the width, or (on the
 * terminal) the header would leave the list no room.
 */
export const matrixLayout = (input: LayoutInput): MatrixLayout | undefined => {
  const t = input.labels
  const m: Matrix<Agent> = buildMatrix(input.agents)
  if (m.rows.length === 0) return undefined

  // ticket | one cell per stage | total, two cells apart
  const ticketWidth = Math.max(t.matrix.ticket.length, ...m.rows.map(r => r.ticket.length))
  const room = input.width - GUTTER.length - ticketWidth - 2 - TOTAL
  const cellWidth = Math.min(CELL_MAX, Math.floor(room / m.stages.length) - 2)
  if (cellWidth < CELL_MIN) return undefined

  const { waiting, failed } = needsAttention(m)
  const alert = limitAlert(input)
  const targets: Record<string, PressTarget> = {}
  const urgentItem = waiting[0] ?? failed[0]
  const urgent = urgentItem ? target(urgentItem, waiting[0] ? 'waiting' : 'failed') : undefined
  const retry = failed[0] ? target(failed[0], 'failed') : undefined

  // ----- header -----
  const stripTone: Tone = alert ? 'error' : waiting.length > 0 ? 'warn' : 'ok'
  const header: Line[] = [
    [seg(GUTTER), seg((input.ascii ? '=' : '━').repeat(Math.max(0, input.width - GUTTER.length)), stripTone)],
    titleLine(input),
  ]
  if (alert) {
    header.push([
      seg(GUTTER),
      seg(input.ascii ? '!' : '▲', 'error', true),
      seg(` ${t.matrix.limitAlert(alert.name, alert.percent, alert.resetsIn)}`, 'error'),
    ])
  }

  const ready = m.rows.filter(r => r.state === 'ready').length
  const text = t.matrix.ticketsReady(ready, m.rows.length)
  const barWidth = Math.max(0, Math.min(40, input.width - GUTTER.length - 2 - text.length))
  header.push([seg(GUTTER), ...ticketBar(m.rows, barWidth, input.ascii), seg('  '), seg(text, 'dim')])

  const first = waiting[0]
  if (first) {
    const reason = t.matrix.reason(first.agent.lastTool)
    const open = { text: `⏎ ${t.matrix.open}`, tone: 'warn' as const, bold: true, press: 'urgent' }
    header.push(
      [
        seg(GUTTER),
        seg(`${input.ascii ? '..' : '◐'} ${t.matrix.attention(waiting.length)}`, 'warn', true),
        seg('   '),
        open,
      ],
      [
        seg(GUTTER + '  '),
        seg(`${first.label} · ${reason} · ${t.matrix.ago(age(first.since, input.now))}`, 'dim'),
      ],
    )
  }

  // The rule under it: the keys, as many as fit.
  const dash = input.ascii ? '-' : '─'
  const head = `${dash}${dash} ${t.section} `
  const openHint: Segment =
    urgent && !first
      ? { text: `⏎ ${t.matrix.open}`, tone: 'error', bold: true, press: 'urgent' }
      : seg(`⏎ ${t.matrix.open}`, 'dim')
  const move = seg(`←↑↓→ ${t.matrix.move}`, 'dim')
  const retryKey: Segment[] = failed[0] ? [{ text: t.matrix.retry, tone: 'error', press: 'retry', hotkey: 'r' }] : []
  const viewKey: Segment = { text: t.matrix.viewList, tone: 'dim', press: 'view', hotkey: 'v' }
  const keySets: Segment[][] = [
    [move, openHint, ...retryKey, viewKey],
    [openHint, ...retryKey, viewKey],
    [...retryKey, viewKey],
    [viewKey],
  ]
  const joined = (keys: Segment[]): Segment[] => keys.flatMap((k, i) => (i > 0 ? [seg('  '), k] : [k]))
  const keys = keySets.find(k => head.length + 2 + lineWidth(joined(k)) <= input.width - GUTTER.length)
    ?? keySets[keySets.length - 1]!
  const fill = Math.max(0, input.width - GUTTER.length - head.length - 2 - lineWidth(joined(keys)))
  header.push([seg(GUTTER), seg(head + dash.repeat(fill), 'dim'), seg('  '), ...joined(keys)])

  // ----- body -----
  const body: Line[] = []
  body.push([
    seg(GUTTER),
    seg(fit(t.matrix.ticket, ticketWidth), 'dim'),
    ...m.stages.flatMap((stage, i) => [seg('  '), seg(fit(t.matrix.stage(i + 1, stage), cellWidth), 'dim')]),
    seg('  '),
    seg(t.matrix.total.padStart(TOTAL), 'dim'),
  ])

  let line = 0
  for (const row of m.rows) {
    const cells = row.cells.flatMap((cell, i): Segment[] => {
      const segs = cellSegments(cell, input, cellWidth, line++)
      if (!cell.last) return [seg('  '), ...segs]
      const key = cellKey(row.ticket, m.stages[i]!)
      targets[key] = { agentId: cell.last.id, description: cell.last.description, state: cell.state }
      return [seg('  '), ...segs.map(s => ({ ...s, press: key }))]
    })
    const time = rowTime(row)
    body.push([
      seg(GUTTER),
      seg(fit(row.ticket, ticketWidth), undefined, true),
      ...cells,
      seg('  '),
      time !== undefined ? seg(elapsed(0, time).padStart(TOTAL)) : seg('—'.padStart(TOTAL), 'dim'),
    ])
  }

  if (m.loose.length > 0) {
    const cols = { ...columnsFor(m.loose, input), mode: false }
    body.push(blank, [seg(GUTTER), seg(t.matrix.noTicket, 'dim')])
    for (const agent of m.loose) body.push(agentRow(agent, tidy(agent.description), 2, cols, input))
  }
  body.push(blank, matrixLegend(input))

  // On the terminal the header must leave some rows for the list.
  if (input.terminal && input.height - header.length < Math.min(MIN_LIST, body.length)) return undefined

  return {
    header: header.map(l => clip(l, input.width)),
    body: body.map(l => clip(l, input.width)),
    targets,
    ...(urgent && { urgent }),
    ...(retry && { retry }),
  }
}
