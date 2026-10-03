import type { SessionState } from "./domain"

export const PARENT_EDITING_TOOLS = new Set([
  "Edit",
  "Write",
  "NotebookEdit",
])

export function resetOrchestration(state: SessionState): void {
  state.active = false
  state.phase = "idle"
  state.delegatedPackages = 0
}

export function startOrchestration(state: SessionState): void {
  state.active = true
  state.phase = "decompose"
  state.delegatedPackages = 0
}

export function beginDelegation(state: SessionState): void {
  if (!state.active) return
  state.phase = "delegate"
}

export function workerSpawned(state: SessionState): void {
  if (!state.active) return
  state.delegatedPackages += 1
  state.phase = "workers_running"
}

export function delegationFinished(
  state: SessionState,
  succeeded: boolean,
): void {
  if (!state.active) return

  if (succeeded && state.delegatedPackages > 0) {
    state.phase = "integrate"
    return
  }

  state.phase = "decompose"
}

export function shouldDenyParentEdit(
  state: SessionState,
  tool: string,
  agentId: string | undefined,
): boolean {
  if (!state.active) return false
  if (agentId !== undefined) return false
  if (!PARENT_EDITING_TOOLS.has(tool)) return false

  return (
    state.phase === "decompose" ||
    state.phase === "delegate" ||
    state.phase === "workers_running"
  )
}

export function parentEditDenyReason(state: SessionState): string {
  return [
    `Kev orchestration is active (phase=${state.phase}).`,
    "The parent agent is acting as architect/orchestrator and must delegate implementation through the Agent tool before editing files directly.",
    "Create one or more closed work packages with explicit boundaries and acceptance criteria, delegate them, then integrate/verify the returned work.",
  ].join(" ")
}
