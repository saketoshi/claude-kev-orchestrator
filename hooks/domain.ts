export type ModelAlias = "haiku" | "sonnet" | "opus" | "inherit"

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

export interface DecisionRecord {
  at: number
  workPackage: WorkPackage
  decision: ModelDecision
  source: "kev" | "fallback"
}

export interface SessionState {
  decisions: DecisionRecord[]
}
