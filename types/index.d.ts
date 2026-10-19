// The data model of agents-pane, and the state contract Claude Code checks.
// Plain types only: hooks/core.ts imports them, and so would any adapter.

/** Status of an agent as the pane tracks it. */
export type AgentState = 'running' | 'completed' | 'failed'

export type AgentRow = {
  id: string
  type: string
  description: string
  model?: string
  background: boolean
  status: AgentState
  startedAt: number
  endedAt?: number
  toolCalls: number
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type TaskRow = {
  id: string
  subject: string
  status: TaskStatus
}

declare module 'claude-code' {
  interface PluginState {
    'agents-pane': { agents: AgentRow[]; tasks: TaskRow[] }
  }
}
