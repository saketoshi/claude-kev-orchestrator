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
  recommendedDecision?: ModelDecision
  source: "kev" | "fallback" | "human_override"
  agentId?: string
  lineageId?: string
  attempt?: number
  escalatedFrom?: ModelAlias
}

export interface WorkPackageOutcome {
  workPackageId: string
  lineageId: string
  attempt: number
  agentId?: string
  model: ModelAlias
  escalatedFrom?: ModelAlias
  startedAt: number
  finishedAt?: number
  editCalls: number
  testRuns: number
  testPasses: number
  testFailures: number
  otherToolFailures: number
  finalOutcome: "unknown" | "succeeded" | "failed" | "partial"
  evidence: string[]
}

export type RunEventType =
  | "run_started"
  | "phase_changed"
  | "parent_edit_denied"
  | "agent_tool_started"
  | "agent_spawned"
  | "worker_tool_completed"
  | "worker_test_completed"
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

export interface ReviewRecord {
  at: number
  reviewer: "codex"
  trigger: "manual" | "auto"
  model?: string
  exitCode?: number
  succeeded: boolean
  output: string
  error?: string
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
  workPackageOutcomes: Record<string, WorkPackageOutcome>
  agentToWorkPackage: Record<string, string>
  lineageAttempts: Record<string, string[]>
  reviews: ReviewRecord[]
}

export interface SessionState {
  active: boolean
  phase: ExecutionPhase
  delegatedPackages: number
  decisions: DecisionRecord[]
  currentRun?: RunObservation
  nextModelOverride?: Exclude<ModelAlias, "inherit">
}
