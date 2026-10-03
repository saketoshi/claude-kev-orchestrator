export type ModelAlias = "haiku" | "sonnet" | "opus" | "inherit"

export type ExecutionPhase =
  | "idle"
  | "decompose"
  | "delegate"
  | "workers_running"
  | "integrate"
  | "verify"

export type ExecutionActor = "parent" | "worker"
export type ExecutionAction =
  | "execute"
  | "delegate"
  | "split"
  | "integrate"
  | "verify"

export interface WorkPackage {
  id: string
  prompt: string
  description: string
  subagentType: string
  parentModel: string
  background: boolean
  fork: boolean
}

export interface ModelDecision {
  model: ModelAlias
  confidence: number
  reason?: string
  shouldSplit?: boolean
}

export interface ExecutionDecision {
  actor: ExecutionActor
  action: ExecutionAction
  model?: ModelAlias
  confidence: number
  reason?: string
}

export interface DecisionRecord {
  at: number
  workPackage: WorkPackage
  decision: ModelDecision
  source: "kev" | "fallback"
  agentId?: string
}

export type RunEventType =
  | "run_started"
  | "phase_changed"
  | "parent_edit_denied"
  | "agent_tool_started"
  | "agent_spawned"
  | "agent_tool_completed"
  | "run_completed"
  | "report_written"

export interface RunEvent {
  at: number
  type: RunEventType
  phase: ExecutionPhase
  actor?: ExecutionActor
  tool?: string
  agentId?: string
  workPackageId?: string
  model?: ModelAlias
  outcome?: "succeeded" | "failed" | "denied"
  detail?: string
}

export interface RunObservation {
  id: string
  prompt: string
  startedAt: number
  finishedAt?: number
  phase: ExecutionPhase
  finalPhase?: ExecutionPhase
  delegatedPackages: number
  decisions: DecisionRecord[]
  events: RunEvent[]
}

export interface SessionState {
  active: boolean
  phase: ExecutionPhase
  delegatedPackages: number
  decisions: DecisionRecord[]
  currentRun?: RunObservation
}
