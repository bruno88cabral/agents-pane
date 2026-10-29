// Harness-agnostic core of agents-pane.
//
// Nothing in this file knows about Claude Code: no `$`, no hooks, no UI
// elements. It holds the data model, the reducers that update it, and the
// pure helpers the layout uses (counts, bar cells, time and token formatting,
// the big font, labels). An adapter for another harness only needs to turn
// that harness's events into calls to these functions and paint ./layout.ts.

// ---------- model ----------

import type { AgentRow, AgentState, TaskRow, TaskStatus } from '../types'

export type { AgentRow, AgentState, TaskRow, TaskStatus }

/** Status as a live harness may report it (a superset of AgentState). */
export type LiveStatus = AgentState | 'pending' | 'waiting' | 'idle' | 'killed'

export const MAX_ROWS = 200

// ---------- reducers (pure: list in, new list out) ----------

export const addAgent = (list: AgentRow[], row: AgentRow): AgentRow[] =>
  list.some(a => a.id === row.id) ? list : [...list, row].slice(-MAX_ROWS)

export const countToolCall = (list: AgentRow[], id: string): AgentRow[] =>
  list.map(a => (a.id === id ? { ...a, toolCalls: a.toolCalls + 1 } : a))

/** Closes a running agent. An agent that already ended keeps its first end. */
export const endAgent = (
  list: AgentRow[],
  id: string,
  status: Exclude<AgentState, 'running'>,
  endedAt: number,
): AgentRow[] =>
  list.map(a =>
    a.id === id && a.status === 'running' ? { ...a, status, endedAt } : a,
  )

/** Agents the harness knows about but the pane has not seen yet. */
export const adoptAgents = (
  list: AgentRow[],
  known: ReadonlyArray<{ id: string; type: string; description: string; status: LiveStatus }>,
  now: number,
): AgentRow[] => {
  const seen = new Set(list.map(a => a.id))
  const missing = known.filter(a => !seen.has(a.id))
  if (missing.length === 0) return list

  const rows = missing.map((a): AgentRow => {
    const ended = !isLive(a.status)
    return {
      id: a.id,
      type: a.type,
      description: a.description,
      background: false,
      status: a.status === 'completed' ? 'completed' : ended ? 'failed' : 'running',
      startedAt: now,
      endedAt: ended ? now : undefined,
      toolCalls: 0,
    }
  })
  return [...list, ...rows].slice(-MAX_ROWS)
}

export const upsertTask = (list: TaskRow[], row: TaskRow): TaskRow[] =>
  list.some(t => t.id === row.id)
    ? list.map(t => (t.id === row.id ? { ...t, ...row } : t))
    : [...list, row]

export const updateTask = (
  list: TaskRow[],
  id: string,
  to: TaskStatus | 'deleted',
  subject?: string,
): TaskRow[] =>
  to === 'deleted'
    ? list.filter(t => t.id !== id)
    : list.map(t =>
        t.id === id ? { ...t, status: to, subject: subject ?? t.subject } : t,
      )

/** TodoWrite always sends the whole list, so each call replaces the tasks. */
export const tasksFromTodos = (
  todos: ReadonlyArray<{ content: string; status: TaskStatus }>,
): TaskRow[] =>
  todos.map((todo, i) => ({ id: `todo-${i}`, subject: todo.content, status: todo.status }))

// ---------- status ----------

const LIVE: ReadonlySet<LiveStatus> = new Set(['running', 'pending', 'waiting', 'idle'])

export const isLive = (s: LiveStatus): boolean => LIVE.has(s)

// ---------- summary ----------

export type Summary = {
  agents: { running: number; done: number; failed: number; total: number }
  tasks: { pending: number; active: number; done: number; total: number }
}

export const summarize = (
  agents: ReadonlyArray<{ status: LiveStatus }>,
  tasks: ReadonlyArray<{ status: TaskStatus }>,
): Summary => {
  const running = agents.filter(a => isLive(a.status)).length
  const failed = agents.filter(a => a.status === 'failed' || a.status === 'killed').length
  return {
    agents: {
      running,
      failed,
      done: agents.length - running - failed,
      total: agents.length,
    },
    tasks: {
      pending: tasks.filter(t => t.status === 'pending').length,
      active: tasks.filter(t => t.status === 'in_progress').length,
      done: tasks.filter(t => t.status === 'completed').length,
      total: tasks.length,
    },
  }
}

// ---------- layout math ----------

/**
 * Splits `width` cells between values, in proportion. Leftover cells go to
 * the largest remainders, and any non-zero value gets at least one cell, so
 * a single failed agent among a hundred still shows.
 */
export const barCells = (values: readonly number[], width: number): number[] => {
  const total = values.reduce((sum, v) => sum + v, 0)
  if (total === 0 || width <= 0) return values.map(() => 0)

  const raw = values.map(v => (v / total) * width)
  const cells = raw.map(Math.floor)
  let left = width - cells.reduce((sum, c) => sum + c, 0)

  const order = raw
    .map((r, i) => ({ i, rest: r - Math.floor(r) }))
    .sort((a, b) => b.rest - a.rest)
  for (const { i } of order) {
    if (left <= 0) break
    cells[i] = (cells[i] ?? 0) + 1
    left -= 1
  }
  values.forEach((v, i) => {
    if (v > 0 && cells[i] === 0) cells[i] = 1
  })
  return cells
}

// ---------- text ----------

export const elapsed = (from: number, to: number): string => {
  const s = Math.max(0, Math.round((to - from) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/** Cuts or pads `text` to exactly `width` cells. */
export const fit = (text: string, width: number): string => {
  if (width <= 0) return ''
  if (text.length > width) return width > 1 ? `${text.slice(0, width - 1)}…` : text.slice(0, 1)
  return text.padEnd(width)
}

/** The last segment of a path: the project folder's name. */
export const projectName = (path: string): string => {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/**
 * The repository's name from its remote URL, the same in every worktree:
 * `git@github.com:me/agents-pane.git` and `https://github.com/me/agents-pane`
 * both give `agents-pane`. Undefined when the URL has no path.
 */
export const repoName = (remote: string): string | undefined => {
  const path = remote.trim().replace(/\/+$/, '').replace(/\.git$/, '')
  const name = path.split(/[/:]/).pop()
  return name && !name.includes('@') ? name : undefined
}

// A 3x5 pixel font, five rows of three, drawn with half blocks so each
// letter takes three rows and four columns.
const FONT: Record<string, string> = {
  a: '.#. #.# ### #.# #.#', b: '##. #.# ##. #.# ##.', c: '.## #.. #.. #.. .##', d: '##. #.# #.# #.# ##.',
  e: '### #.. ##. #.. ###', f: '### #.. ##. #.. #..', g: '.## #.. #.# #.# .##', h: '#.# #.# ### #.# #.#',
  i: '### .#. .#. .#. ###', j: '..# ..# ..# #.# .#.', k: '#.# #.# ##. #.# #.#', l: '#.. #.. #.. #.. ###',
  m: '#.# ### ### #.# #.#', n: '##. #.# #.# #.# #.#', o: '.#. #.# #.# #.# .#.', p: '##. #.# ##. #.. #..',
  q: '.#. #.# #.# ##. .##', r: '##. #.# ##. #.# #.#', s: '.## #.. .#. ..# ##.', t: '### .#. .#. .#. .#.',
  u: '#.# #.# #.# #.# ###', v: '#.# #.# #.# #.# .#.', w: '#.# #.# ### ### #.#', x: '#.# #.# .#. #.# #.#',
  y: '#.# #.# .#. .#. .#.', z: '### ..# .#. #.. ###', '0': '### #.# #.# #.# ###', '1': '.#. ##. .#. .#. ###',
  '2': '##. ..# .#. #.. ###', '3': '##. ..# .#. ..# ##.', '4': '#.# #.# ### ..# ..#', '5': '### #.. ##. ..# ##.',
  '6': '.## #.. ### #.# ###', '7': '### ..# .#. .#. .#.', '8': '### #.# ### #.# ###', '9': '### #.# ### ..# ##.',
  '-': '... ... ### ... ...', '_': '... ... ... ... ###', '.': '... ... ... ... .#.', ' ': '... ... ... ... ...',
}

/**
 * `text` in big letters, 3 rows of half blocks, or undefined when a character
 * has no glyph or the letters need more than `width` cells.
 */
export const bigText = (text: string, width: number): string[] | undefined => {
  const glyphs = [...text.toLowerCase()].map(c => FONT[c]?.split(' '))
  if (glyphs.some(g => g === undefined) || glyphs.length * 4 - 1 > width) return undefined
  const on = (g: string[], row: number, col: number) => g[row]?.[col] === '#'
  return [0, 2, 4].map(row =>
    glyphs
      .map(g =>
        [0, 1, 2]
          .map(col => {
            const top = on(g!, row, col)
            const bottom = on(g!, row + 1, col)
            return top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' '
          })
          .join(''),
      )
      .join(' ')
      .trimEnd(),
  )
}

/** Token counts the short way: 950, 84k, 1.2M. */
export const tokens = (n: number): string => {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  const m = n / 1_000_000
  return `${Number.isInteger(m) ? m : m.toFixed(1)}M`
}

// ---------- git ----------

export type GitState = {
  /** The branch, or the short commit hash when HEAD is detached. */
  branch: string
  detached: boolean
  /** True in a linked worktree, false in the main checkout. */
  worktree: boolean
  /** Files with changes, staged or not, untracked included. */
  changed: number
  ahead: number
  behind: number
}

/**
 * Reads `git status --porcelain --branch` and `git rev-parse --git-dir
 * --git-common-dir --short HEAD`. Undefined when the first is not a status.
 */
export const parseGit = (status: string, revParse: string): GitState | undefined => {
  const [head, ...files] = status.split('\n')
  if (!head?.startsWith('## ')) return undefined
  const [gitDir, commonDir, sha = ''] = revParse.trim().split('\n')

  const info = head.slice(3)
  const unborn = /^(?:No commits yet on|Initial commit on) (.+)$/.exec(info)
  const detached = info.startsWith('HEAD (no branch)')
  const branch = unborn?.[1] ?? (detached ? sha : info.split('...')[0]!.split(' ')[0]!)

  return {
    branch,
    detached,
    worktree: gitDir !== undefined && commonDir !== undefined && gitDir !== commonDir,
    changed: files.filter(Boolean).length,
    ahead: Number(/ahead (\d+)/.exec(info)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(info)?.[1] ?? 0),
  }
}

// ---------- limits ----------

/** When a limit resets: the time today or tomorrow, else the weekday and time. */
export const resetTime = (at: number, now: number, weekdays: readonly string[]): string => {
  const d = new Date(at)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return at - now < 24 * 3_600_000 ? time : `${weekdays[d.getDay()]} ${time}`
}

// ---------- labels ----------

export type Language = 'en' | 'pt-BR'

export type Labels = {
  title: string
  commandDescription: string
  agents: string
  running: string
  done: string
  failed: string
  total: string
  tasks: string
  tasksPending: string
  tasksActive: string
  tasksDone: string
  empty: string
  context: string
  section: string
  statContext: string
  statContextShort: string
  statAgents: string
  statTasks: string
  doneShort: string
  activeShort: string
  statBranch: string
  statLimit5h: string
  statWeek: string
  statSpend: string
  statSession: string
  worktree: string
  detached: string
  /** Sunday first, as `Date.getDay()` counts. */
  weekdays: readonly string[]
  opened: (running: number, total: number) => string
}

const LABELS: Record<Language, Labels> = {
  en: {
    title: 'Agents',
    commandDescription: 'Open the pane with the agents of this session and their status',
    agents: 'Agents',
    running: 'running',
    done: 'done',
    failed: 'failed',
    total: 'total',
    tasks: 'Tasks',
    tasksPending: 'to start',
    tasksActive: 'in progress',
    tasksDone: 'done',
    empty: 'No agents in this session yet.',
    context: 'context',
    section: 'agents',
    statContext: 'context',
    statContextShort: 'ctx',
    statAgents: 'agents',
    statTasks: 'tasks',
    doneShort: 'done',
    activeShort: 'active',
    statBranch: 'branch',
    statLimit5h: 'limit 5h',
    statWeek: 'week',
    statSpend: 'spend',
    statSession: 'session',
    worktree: 'worktree',
    detached: 'detached',
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    opened: (running, total) => `Agents pane open: ${running} running, ${total} in this session.`,
  },
  'pt-BR': {
    title: 'Subagentes',
    commandDescription: 'Abre o painel com os subagentes desta sessão e o status de cada um',
    agents: 'Agentes',
    running: 'rodando',
    done: 'finalizados',
    failed: 'falhos',
    total: 'no total',
    tasks: 'Tarefas',
    tasksPending: 'a disparar',
    tasksActive: 'em andamento',
    tasksDone: 'concluídas',
    empty: 'Nenhum subagente nesta sessão ainda.',
    context: 'contexto',
    section: 'agentes',
    statContext: 'contexto',
    statContextShort: 'ctx',
    statAgents: 'agentes',
    statTasks: 'tarefas',
    doneShort: 'prontos',
    activeShort: 'ativas',
    statBranch: 'branch',
    statLimit5h: 'limite 5h',
    statWeek: 'semana',
    statSpend: 'gasto',
    statSession: 'sessão',
    worktree: 'worktree',
    detached: 'solto',
    weekdays: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'],
    opened: (running, total) =>
      `Painel de subagentes aberto: ${running} rodando, ${total} nesta sessão.`,
  },
}

export const labels = (language: unknown): Labels =>
  language === 'pt-BR' ? LABELS['pt-BR'] : LABELS.en
