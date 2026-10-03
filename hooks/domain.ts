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
}

export interface SessionState {
  active: boolean
  phase: ExecutionPhase
  delegatedPackages: number
  decisions: DecisionRecord[]
}
