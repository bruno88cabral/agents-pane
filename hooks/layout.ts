// The pane's layout, as plain data.
//
// `layout()` is pure: sizes, the context fill and the agents in, lines out.
// Each line is a list of segments carrying a color role, so the adapter only
// paints them and the tests read them as plain strings with `plain()`.

import { barCells, bigText, elapsed, fit, isLive, resetTime, tokens } from './core'
import type { GitState, Labels, LiveStatus } from './core'

/** The color roles of the pane; no tone is the terminal's own color. */
export type Tone = 'accent' | 'ok' | 'warn' | 'error' | 'dim'

export type Segment = { text: string; tone?: Tone; bold?: boolean; title?: boolean }
export type Line = Segment[]

export type LayoutAgent = {
  id: string
  type: string
  description: string
  background: boolean
  status: LiveStatus
  startedAt: number
  endedAt?: number
  toolCalls: number
  /** Tool calls per minute over the last intervals, oldest first. */
  rates?: readonly number[]
}

export type LayoutInput = {
  width: number
  height: number
  /** The terminal draws the name in big letters; other surfaces as a title. */
  terminal: boolean
  ascii: boolean
  now: number
  name?: string
  context?: { tokens?: number; window: number; percent?: number }
  git?: GitState
  /** Usage limits: `five_hour`, `seven_day` or `spend_limit`, resets in ms. */
  limits?: ReadonlyArray<{ kind: string; percent: number; resetsAt?: number }>
  /** When the session (or its last /clear) started, and its cost when priced. */
  session?: { startedAt: number; usd?: number }
  agents: readonly LayoutAgent[]
  tasks?: { pending: number; active: number; done: number; total: number }
  labels: Labels
}

/** The header stays put while the body scrolls under it. */
export type Layout = { header: Line[]; body: Line[] }

export const COMPACT_HEIGHT = 12
/** From this height the terminal has room for a blank line between the rows. */
export const SPACED_HEIGHT = 40
export const NARROW_WIDTH = 40

const GUTTER = ' '
const LABEL = 9
const VALUE = 12
const BAR = 20
const PERCENT = 5
const TOOLS = 5
const TIME = 6
const MODE = 2
const SPARK = 4
const DEFAULT_TYPE = 'general-purpose'
const TICKET = /\b([A-Z]+-\d+)\b/

// ---------- pieces ----------

const seg = (text: string, tone?: Tone, bold?: boolean): Segment =>
  tone || bold ? { text, ...(tone && { tone }), ...(bold && { bold }) } : { text }

export const statusGlyph = (status: LiveStatus, ascii: boolean): { text: string; tone: Tone } => {
  if (status === 'completed') return { text: ascii ? 'ok' : '✓', tone: 'ok' }
  if (status === 'failed' || status === 'killed') return { text: ascii ? 'x' : '✗', tone: 'error' }
  if (status === 'pending') return { text: ascii ? '.' : '·', tone: 'dim' }
  return { text: ascii ? '..' : '◐', tone: 'accent' }
}

const LEVELS = '▁▂▃▄▅▆▇█'

/** Four cells, one per interval, scaled to the busiest; blank before the agent existed. */
export const sparkline = (rates: readonly number[]): string => {
  const last = rates.slice(-SPARK)
  const max = Math.max(0, ...last)
  const cells = last.map(r =>
    max === 0 ? LEVELS[0] : LEVELS[Math.min(7, Math.max(0, Math.ceil((r / max) * 8) - 1))],
  )
  return cells.join('').padStart(SPARK)
}

/** A bar with its track always showing; `parts` are filled cells with their tones. */
const bar = (parts: ReadonlyArray<{ value: number; tone?: Tone }>, total: number, width: number, ascii: boolean): Segment[] => {
  if (width <= 0) return []
  const empty = Math.max(0, total - parts.reduce((s, p) => s + p.value, 0))
  const cells = total > 0 ? barCells([...parts.map(p => p.value), empty], width) : [width]
  const filled = cells.slice(0, -1).map((n, i) => seg((ascii ? '#' : '█').repeat(n), parts[i]?.tone))
  return [...filled.filter(s => s.text), seg((ascii ? '-' : '░').repeat(cells[cells.length - 1] ?? 0), 'dim')]
}

const percent = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 100) : 0

/** `8 / 8 done`, or `8/8` when the words do not fit the column. */
const ratio = (part: number, whole: number, word: string): string => {
  const long = `${part} / ${whole} ${word}`
  return long.length <= VALUE ? long : `${part}/${whole}`
}

const statRow = (
  label: string,
  value: string,
  valueTone: Tone | undefined,
  fill: Segment[],
  pct: string,
  pctTone: Tone | undefined,
  extra: Segment[],
): Line => [
  seg(GUTTER),
  seg(fit(label, LABEL), 'dim'),
  seg(value.padStart(VALUE), valueTone),
  seg('  '),
  ...fill,
  seg(pct.padStart(PERCENT), pctTone),
  ...extra,
]

// ---------- grouping ----------

type Group = { ticket?: string; subtitle: string; rows: Array<{ agent: LayoutAgent; text: string }> }

const squeeze = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * Agents grouped by the ticket their description names. Undefined when none
 * names one: the list stays flat. Agents without a ticket close the list in a
 * group of their own, with no header.
 */
export const groupByTicket = (agents: readonly LayoutAgent[]): Group[] | undefined => {
  if (!agents.some(a => TICKET.test(a.description))) return undefined

  const groups = new Map<string, Group>()
  const loose: Group = { subtitle: '', rows: [] }
  for (const agent of agents) {
    const match = TICKET.exec(agent.description)
    if (!match?.[1]) {
      loose.rows.push({ agent, text: agent.description })
      continue
    }
    const ticket = match[1]
    const after = squeeze(agent.description.slice((match.index ?? 0) + ticket.length))
    let group = groups.get(ticket)
    if (!group) {
      group = { ticket, subtitle: after, rows: [] }
      groups.set(ticket, group)
    }
    const rest = squeeze(agent.description.replace(ticket, ' '))
    const text =
      group.subtitle && rest.includes(group.subtitle)
        ? squeeze(rest.replace(group.subtitle, ' '))
        : rest
    group.rows.push({ agent, text: text || group.subtitle || ticket })
  }
  return [...groups.values(), ...(loose.rows.length > 0 ? [loose] : [])]
}

// ---------- rows ----------

type Columns = { mode: boolean; type: number; spark: boolean; glyph: number }

const agentRow = (
  agent: LayoutAgent,
  text: string,
  indent: number,
  cols: Columns,
  input: LayoutInput,
): Line => {
  const live = isLive(agent.status)
  const g = statusGlyph(agent.status, input.ascii)
  const time = elapsed(agent.startedAt, live ? input.now : (agent.endedAt ?? input.now))

  const right: Segment[] = [
    seg(`${agent.toolCalls}t`.padStart(TOOLS), 'dim'),
    seg('  '),
    seg(time.padStart(TIME), live ? undefined : 'dim'),
  ]
  if (cols.mode) right.push(seg('  '), seg((agent.background ? 'bg' : '').padEnd(MODE), 'dim'))
  if (cols.type > 0) {
    const type = agent.type === DEFAULT_TYPE ? '' : agent.type
    right.push(seg('  '), seg(fit(type, cols.type), 'dim'))
  }
  if (cols.spark) {
    const spark = live && agent.rates ? sparkline(agent.rates) : ''.padEnd(SPARK)
    right.push(seg('  '), seg(spark, 'accent'))
  }

  const rightWidth = right.reduce((n, s) => n + s.text.length, 0)
  const left = GUTTER.length + indent + cols.glyph + 2
  const description = Math.max(1, input.width - left - 1 - rightWidth)
  return [
    seg(GUTTER + ' '.repeat(indent)),
    seg(g.text.padEnd(cols.glyph), g.tone),
    seg('  '),
    seg(fit(text, description)),
    seg(' '),
    ...right,
  ]
}

const columnsFor = (agents: readonly LayoutAgent[], input: LayoutInput): Columns => {
  const roomy = input.width >= NARROW_WIDTH
  const types = agents.map(a => (a.type === DEFAULT_TYPE ? 0 : a.type.length))
  return {
    mode: roomy,
    type: Math.min(15, Math.max(0, ...types)),
    spark: roomy && !input.ascii && agents.some(a => isLive(a.status) && a.rates),
    glyph: input.ascii ? 2 : 1,
  }
}

// ---------- header ----------

const blank: Line = [seg('')]

const title = (input: LayoutInput, compact: boolean): Line[] => {
  const name = input.name
  if (!name) return []
  if (!input.terminal) return [[{ text: name, tone: 'accent', bold: true, title: true }]]
  const big = !compact && !input.ascii ? bigText(name, input.width - GUTTER.length) : undefined
  if (big) return big.map(row => [seg(GUTTER), seg(row, 'accent', true)])
  return [[seg(GUTTER), seg(name.toUpperCase(), 'accent', true)]]
}

/** Green below 70%, yellow from 70%, red from 85%. */
const fillTone = (pct: number | undefined): Tone | undefined => {
  if (pct === undefined) return undefined
  if (pct >= 85) return 'error'
  if (pct >= 70) return 'warn'
  return 'ok'
}

const barWidthFor = (input: LayoutInput): number => {
  const width = Math.min(BAR, input.width - GUTTER.length - LABEL - VALUE - 2 - PERCENT)
  return width >= 4 ? width : 0
}

/** Where am I: the branch, its changes and whether this is a worktree. */
const where = (input: LayoutInput): Line[] => {
  const git = input.git
  if (!git) return []
  const t = input.labels
  const a = input.ascii
  const marks: Segment[] = []
  if (git.changed > 0) marks.push(seg('  '), seg(`${a ? '*' : '●'}${git.changed}`, 'warn'))
  if (git.ahead > 0) marks.push(seg(' '), seg(`${a ? '^' : '↑'}${git.ahead}`, 'accent'))
  if (git.behind > 0) marks.push(seg(' '), seg(`${a ? 'v' : '↓'}${git.behind}`, 'warn'))
  const tags = [git.detached && t.detached, git.worktree && t.worktree].filter(Boolean)
  return [
    [
      seg(GUTTER),
      seg(fit(t.statBranch, LABEL), 'dim'),
      seg(git.branch, undefined, true),
      ...marks,
      ...(tags.length > 0 ? [seg(`  ${tags.join(' · ')}`, 'dim')] : []),
    ],
  ]
}

/** How much am I using: context, usage limits and the session. */
const usage = (input: LayoutInput): Line[] => {
  const t = input.labels
  const fillWidth = barWidthFor(input)
  const lines: Line[] = []

  const ctx = input.context
  if (ctx) {
    const tone = fillTone(ctx.percent)
    lines.push(
      statRow(
        t.statContext,
        `${ctx.tokens !== undefined ? tokens(ctx.tokens) : '—'} / ${tokens(ctx.window)}`,
        ctx.tokens !== undefined ? tone : 'dim',
        bar([{ value: Math.min(100, ctx.percent ?? 0), tone }], 100, fillWidth, input.ascii),
        ctx.percent !== undefined ? `${ctx.percent}%` : '',
        tone,
        [],
      ),
    )
  }

  const names: Record<string, string> = {
    five_hour: t.statLimit5h,
    seven_day: t.statWeek,
    spend_limit: t.statSpend,
  }
  for (const limit of input.limits ?? []) {
    const tone = fillTone(limit.percent)
    const resets =
      limit.resetsAt !== undefined && input.width >= NARROW_WIDTH
        ? resetTime(limit.resetsAt, input.now, t.weekdays)
        : ''
    lines.push(
      statRow(
        names[limit.kind] ?? limit.kind,
        resets,
        'dim',
        bar([{ value: Math.min(100, limit.percent), tone }], 100, fillWidth, input.ascii),
        `${Math.round(limit.percent)}%`,
        tone,
        [],
      ),
    )
  }

  const session = input.session
  if (session) {
    const cost = session.usd !== undefined ? [seg(`$${session.usd.toFixed(2)}`)] : []
    lines.push(statRow(t.statSession, elapsed(session.startedAt, input.now), undefined, cost, '', undefined, []))
  }
  return lines
}

/** What is running: the agents and the orchestration tasks. */
const activity = (input: LayoutInput): Line[] => {
  const t = input.labels
  const fillWidth = barWidthFor(input)
  const lines: Line[] = []

  const agents = input.agents
  const running = agents.filter(a => isLive(a.status)).length
  const failed = agents.filter(a => a.status === 'failed' || a.status === 'killed').length
  const done = agents.length - running - failed
  const dot = input.ascii ? '*' : '●'
  lines.push(
    statRow(
      t.statAgents,
      ratio(done + failed, agents.length, t.doneShort),
      undefined,
      bar(
        [{ value: done, tone: 'ok' }, { value: failed, tone: 'error' }, { value: running, tone: 'accent' }],
        agents.length,
        fillWidth,
        input.ascii,
      ),
      agents.length > 0 ? `${percent(done + failed, agents.length)}%` : '',
      undefined,
      [
        seg(`   ${dot} ${running} ${t.running}`, 'accent'),
        ...(failed > 0 ? [seg(`  ${input.ascii ? 'x' : '✗'} ${failed} ${t.failed}`, 'error')] : []),
      ],
    ),
  )

  const tasks = input.tasks
  if (tasks && tasks.total > 0) {
    lines.push(
      statRow(
        t.statTasks,
        ratio(tasks.done, tasks.total, t.doneShort),
        undefined,
        bar([{ value: tasks.done, tone: 'ok' }, { value: tasks.active, tone: 'warn' }], tasks.total, fillWidth, input.ascii),
        `${percent(tasks.done, tasks.total)}%`,
        undefined,
        [seg(`   ${input.ascii ? '..' : '◐'} ${tasks.active} ${t.activeShort}`, 'warn')],
      ),
    )
  }
  return lines
}

const compactStats = (input: LayoutInput): Line => {
  const t = input.labels
  const agents = input.agents
  const running = agents.filter(a => isLive(a.status)).length
  const ended = agents.length - running
  const parts: string[] = []
  if (input.git) parts.push(input.ascii ? input.git.branch : `⎇ ${input.git.branch}`)
  if (input.context?.percent !== undefined) parts.push(`${t.statContextShort} ${input.context.percent}%`)
  const fiveHour = input.limits?.find(l => l.kind === 'five_hour')
  if (fiveHour) parts.push(`5h ${Math.round(fiveHour.percent)}%`)
  parts.push(`${t.statAgents} ${ended}/${agents.length}`)
  parts.push(`${input.ascii ? '*' : '●'} ${running} ${t.running}`)
  return [seg(GUTTER), seg(parts.join(' · '), 'dim')]
}

const separator = (input: LayoutInput): Line => {
  const dash = input.ascii ? '-' : '─'
  const head = `${dash}${dash} ${input.labels.section} `
  return [seg(GUTTER), seg(head + dash.repeat(Math.max(0, input.width - GUTTER.length - head.length)), 'dim')]
}

/**
 * The blocks one under another, a blank line between them and, when
 * `spaced`, between their rows too. Empty blocks drop out.
 */
const stack = (blocks: Line[][], spaced: boolean): Line[] =>
  blocks
    .filter(block => block.length > 0)
    .flatMap(block => [...(spaced ? block.flatMap((l, i) => (i > 0 ? [blank, l] : [l])) : block), blank])

// ---------- the pane ----------

export const layout = (input: LayoutInput): Layout => {
  const compact = input.height < COMPACT_HEIGHT
  const header: Line[] = []
  const name = title(input, compact)

  if (compact) {
    header.push(...name, compactStats(input))
  } else {
    const spaced = input.terminal && input.height >= SPACED_HEIGHT
    // The big letters are one block of rows: they never take the spacing.
    header.push(...stack([name], false), ...stack([where(input), usage(input), activity(input)], spaced), separator(input))
  }

  const body: Line[] = []
  const cols = columnsFor(input.agents, input)
  if (input.agents.length === 0) {
    body.push([seg(GUTTER), seg(input.labels.empty, 'dim')])
    return { header, body: body.map(l => clip(l, input.width)) }
  }

  const groups = compact ? undefined : groupByTicket(input.agents)
  if (!groups) {
    for (const agent of input.agents) body.push(agentRow(agent, agent.description, 0, cols, input))
  } else {
    groups.forEach((group, i) => {
      if (i > 0) body.push(blank)
      if (group.ticket) {
        const room = input.width - GUTTER.length - group.ticket.length - 2
        const subtitle = group.subtitle && room > 0 ? `  ${fit(group.subtitle, room).trimEnd()}` : ''
        body.push([seg(GUTTER), seg(group.ticket, undefined, true), seg(subtitle)])
      }
      for (const row of group.rows) body.push(agentRow(row.agent, row.text, 2, cols, input))
    })
  }

  return { header: header.map(l => clip(l, input.width)), body: body.map(l => clip(l, input.width)) }
}

/** Cuts a line to `width` cells, segment by segment, dropping empty ones. */
export const clip = (line: Line, width: number): Line => {
  const out: Line = []
  let left = width
  for (const s of line) {
    if (left <= 0) break
    const text = s.text.length > left ? s.text.slice(0, left) : s.text
    left -= text.length
    if (text) out.push({ ...s, text })
  }
  return out.length > 0 ? out : [seg('')]
}

/** The layout as plain text, one string per line, trailing spaces cut. */
export const plain = ({ header, body }: Layout): string[] =>
  [...header, ...body].map(line => line.map(s => s.text).join('').trimEnd())

// ---------- tool-call rate samples ----------

/**
 * Tool-call counts an agent had at each minute mark, kept to the last five,
 * so four full intervals and the current one can be told apart.
 */
export type Marks = { minute: number; counts: number[] }

/** Records `count` at `now`'s minute when the minute changes. */
export const mark = (prev: Marks | undefined, now: number, count: number): Marks => {
  const minute = Math.floor(now / 60_000)
  if (!prev) return { minute, counts: [count] }
  if (minute === prev.minute) return prev
  // A gap of several minutes repeats the last count: no calls in between.
  const gap = Math.min(5, minute - prev.minute)
  const last = prev.counts[prev.counts.length - 1] ?? count
  const filled = [...prev.counts, ...Array<number>(gap - 1).fill(last), count]
  return { minute, counts: filled.slice(-5) }
}

/** Calls per interval: between the marks, then from the last mark to now. */
export const rates = (marks: Marks, count: number): number[] => {
  const points = [...marks.counts, count]
  return points.slice(1).map((c, i) => Math.max(0, c - (points[i] ?? c))).slice(-SPARK)
}
