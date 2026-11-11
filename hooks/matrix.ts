// The ticket-by-stage matrix, as plain data.
//
// Nothing here knows about the screen or Claude Code. `parseAgent` reads a
// ticket and a stage out of an agent's description, `buildMatrix` puts the
// agents in a cell per (ticket, stage) and merges the attempts of one cell,
// and the helpers say which cells need the person. ./matrix-layout.ts draws it.

import { tidy, TICKET_TOKEN } from './core'
import type { LiveStatus } from './core'

/** What the matrix reads of an agent. */
export type MatrixAgent = {
  id: string
  description: string
  status: LiveStatus
  startedAt: number
  endedAt?: number
  toolCalls: number
  /** Not in the engine's list: nothing says what it is doing. */
  unlisted?: boolean
  /** When the engine first listed it as waiting. */
  waitingSince?: number
  /** The last tool it called, when known. */
  lastTool?: string
}

export type Parsed = {
  ticket?: string
  /** The stage as written: `Refinar`, `Implement`. */
  stage: string
  /** The description without the ticket. */
  rest: string
}

// The stage is what comes before the ticket, the node number (N4, N11b), the
// task number (Task 9) or the first colon or bracket.
const STAGE_END = /\bN\d+[a-z]?\b|\bTask\s*\d+\b|[:(\[]/i

export const parseAgent = (description: string): Parsed => {
  const match = TICKET_TOKEN.exec(description)
  const cuts = [match?.index, STAGE_END.exec(description)?.index].filter(
    (n): n is number => n !== undefined,
  )
  // Taking the ticket out can leave a separator alone between two words.
  const rest = match
    ? tidy(description.replace(match[0], ' ').replace(/\s+[:·–—]\s+/g, ' '))
    : tidy(description)
  const before = tidy(description.slice(0, cuts.length > 0 ? Math.min(...cuts) : 0))
  const stage = before || rest.split(' ')[0] || '—'
  return { ...(match?.[1] && { ticket: match[1] }), stage, rest }
}

export type CellState = 'ok' | 'recovered' | 'running' | 'waiting' | 'idle' | 'failed' | 'queued'

export type Cell<A extends MatrixAgent = MatrixAgent> = {
  state: CellState
  /** The attempts, oldest first; none for a stage the ticket has not reached. */
  attempts: A[]
  /** The latest attempt: it sets the state. */
  last?: A
  /** Earlier attempts that failed. */
  retries: number
}

/** What a ticket shows as in the progress bar. */
export type TicketState = 'waiting' | 'failed' | 'running' | 'ready'

export type TicketRow<A extends MatrixAgent = MatrixAgent> = {
  ticket: string
  /** One cell per stage, in the matrix's order. */
  cells: Cell<A>[]
  state: TicketState
}

export type Matrix<A extends MatrixAgent = MatrixAgent> = {
  /** The stages' names, in the order they first appeared. */
  stages: string[]
  rows: TicketRow<A>[]
  /** Agents with no ticket in their description. */
  loose: A[]
}

const FAILED = new Set<LiveStatus>(['failed', 'killed'])

const cellState = (last: MatrixAgent, retries: number): CellState => {
  switch (last.status) {
    case 'completed':
      return retries > 0 ? 'recovered' : 'ok'
    case 'failed':
    case 'killed':
      return 'failed'
    // An agent the engine does not list is not known to wait for anyone.
    case 'waiting':
      return last.unlisted ? 'running' : 'waiting'
    case 'idle':
      return 'idle'
    case 'pending':
      return 'queued'
    default:
      return 'running'
  }
}

const ticketState = (cells: ReadonlyArray<Cell>): TicketState => {
  const states = cells.filter(c => c.last).map(c => c.state)
  if (states.includes('waiting')) return 'waiting'
  if (states.includes('failed')) return 'failed'
  if (states.some(s => s === 'running' || s === 'idle' || s === 'queued')) return 'running'
  return 'ready'
}

const RANK: Record<TicketState, number> = { waiting: 0, failed: 1, running: 2, ready: 3 }

export const buildMatrix = <A extends MatrixAgent>(agents: readonly A[]): Matrix<A> => {
  const ordered = [...agents].sort((a, b) => a.startedAt - b.startedAt)
  const stages = new Map<string, string>()
  const tickets = new Map<string, Map<string, A[]>>()
  const loose: A[] = []

  for (const agent of agents) if (!parseAgent(agent.description).ticket) loose.push(agent)
  for (const agent of ordered) {
    const { ticket, stage } = parseAgent(agent.description)
    if (!ticket) continue
    const key = stage.toLowerCase()
    if (!stages.has(key)) stages.set(key, stage)
    const row = tickets.get(ticket) ?? new Map<string, A[]>()
    row.set(key, [...(row.get(key) ?? []), agent])
    tickets.set(ticket, row)
  }

  const keys = [...stages.keys()]
  const rows = [...tickets].map(([ticket, byStage]): TicketRow<A> => {
    const cells = keys.map((key): Cell<A> => {
      const attempts = byStage.get(key) ?? []
      const last = attempts[attempts.length - 1]
      if (!last) return { state: 'queued', attempts, retries: 0 }
      const retries = attempts.slice(0, -1).filter(a => FAILED.has(a.status)).length
      return { state: cellState(last, retries), attempts, last, retries }
    })
    return { ticket, cells, state: ticketState(cells) }
  })
  // What needs the person goes first; the rest keep the order they began in.
  const sorted = rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => RANK[a.row.state] - RANK[b.row.state] || a.i - b.i)
    .map(({ row }) => row)

  return { stages: [...stages.values()], rows: sorted, loose }
}

/** How long a finished cell took: its last attempt, start to end. */
export const cellTime = (cell: Cell): number | undefined => {
  const last = cell.last
  if (!last || (cell.state !== 'ok' && cell.state !== 'recovered')) return undefined
  return last.endedAt !== undefined ? last.endedAt - last.startedAt : undefined
}

/** What a row's cells took in all; undefined while none has finished. */
export const rowTime = (row: TicketRow): number | undefined => {
  const times = row.cells.map(cellTime).filter((t): t is number => t !== undefined)
  return times.length > 0 ? times.reduce((a, b) => a + b, 0) : undefined
}

/** An agent that needs the person, with how to name it. */
export type Attention<A extends MatrixAgent = MatrixAgent> = {
  agent: A
  /** `MYK-1156 · Refinar N6`, or the description of an agent with no ticket. */
  label: string
  /** The key of its cell, absent for an agent with no ticket. */
  cell?: string
  since: number
}

export const cellKey = (ticket: string, stage: string): string => `cell:${ticket}:${stage.toLowerCase()}`

/**
 * Agents the engine lists as waiting, the longest first, and the cells whose
 * latest attempt failed, in the matrix's order. Failures of an agent with no
 * ticket have no cell to retry and are left out.
 */
export const needsAttention = <A extends MatrixAgent>(
  matrix: Matrix<A>,
): { waiting: Attention<A>[]; failed: Attention<A>[] } => {
  const waiting: Attention<A>[] = []
  const failed: Attention<A>[] = []
  const stageKeys = matrix.stages.map(s => s.toLowerCase())

  for (const row of matrix.rows) {
    row.cells.forEach((cell, i) => {
      if (!cell.last) return
      const item = {
        agent: cell.last,
        label: `${row.ticket} · ${parseAgent(cell.last.description).rest || matrix.stages[i]}`,
        cell: cellKey(row.ticket, stageKeys[i]!),
        since: cell.last.waitingSince ?? cell.last.startedAt,
      }
      if (cell.state === 'waiting') waiting.push(item)
      else if (cell.state === 'failed') failed.push(item)
    })
  }
  for (const agent of matrix.loose) {
    if (agent.status === 'waiting' && !agent.unlisted) {
      waiting.push({ agent, label: tidy(agent.description), since: agent.waitingSince ?? agent.startedAt })
    }
  }
  return { waiting: waiting.sort((a, b) => a.since - b.since), failed }
}
