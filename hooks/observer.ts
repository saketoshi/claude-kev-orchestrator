import type {
  ModelAlias,
  RunObservation,
  WorkPackageOutcome,
} from "./domain"

const TEST_PATTERNS = [
  /(^|\s)(npm|pnpm|yarn|bun)\s+(run\s+)?test\b/i,
  /(^|\s)(pytest|python\s+-m\s+pytest)\b/i,
  /(^|\s)(go\s+test)\b/i,
  /(^|\s)(cargo\s+test)\b/i,
  /(^|\s)(mvn|mvnw|gradle|gradlew)\b.*\btest\b/i,
  /(^|\s)(dotnet\s+test)\b/i,
  /(^|\s)(ctest)\b/i,
  /(^|\s)(vitest|jest|mocha)\b/i,
]

const EDITING_TOOLS = new Set(["Edit", "Write", "NotebookEdit"])

export function isTestCommand(command: string | undefined): boolean {
  if (!command) return false
  return TEST_PATTERNS.some((pattern) => pattern.test(command))
}

export function startWorkPackageOutcome(
  run: RunObservation | undefined,
  workPackageId: string,
  model: ModelAlias,
  at = Date.now(),
): void {
  if (!run) return
  run.workPackageOutcomes[workPackageId] = {
    workPackageId,
    model,
    startedAt: at,
    editCalls: 0,
    testRuns: 0,
    testPasses: 0,
    testFailures: 0,
    otherToolFailures: 0,
    finalOutcome: "unknown",
    evidence: [],
  }
}

export function bindAgent(
  run: RunObservation | undefined,
  workPackageId: string,
  agentId: string | undefined,
): void {
  if (!run || !agentId) return
  run.agentToWorkPackage[agentId] = workPackageId
  const outcome = run.workPackageOutcomes[workPackageId]
  if (outcome) outcome.agentId = agentId
}

export function outcomeForAgent(
  run: RunObservation | undefined,
  agentId: string | undefined,
): WorkPackageOutcome | undefined {
  if (!run || !agentId) return undefined
  const workPackageId = run.agentToWorkPackage[agentId]
  if (!workPackageId) return undefined
  return run.workPackageOutcomes[workPackageId]
}

export function observeWorkerTool(
  run: RunObservation | undefined,
  agentId: string | undefined,
  tool: string,
  command: string | undefined,
  result: { deny?: string; isError?: boolean },
  at = Date.now(),
): { workPackageId?: string; isTest: boolean; succeeded: boolean } {
  const outcome = outcomeForAgent(run, agentId)
  const isTest = tool === "Bash" && isTestCommand(command)
  const succeeded = result.deny === undefined && !result.isError

  if (!outcome) return { isTest, succeeded }

  if (EDITING_TOOLS.has(tool)) outcome.editCalls += 1

  if (isTest) {
    outcome.testRuns += 1
    if (succeeded) outcome.testPasses += 1
    else outcome.testFailures += 1
    outcome.evidence.push(
      `${new Date(at).toISOString()} test ${succeeded ? "passed" : "failed"}`,
    )
  } else if (!succeeded) {
    outcome.otherToolFailures += 1
    outcome.evidence.push(
      `${new Date(at).toISOString()} ${tool} failed`,
    )
  }

  return {
    workPackageId: outcome.workPackageId,
    isTest,
    succeeded,
  }
}

export function completeWorkPackage(
  run: RunObservation | undefined,
  workPackageId: string,
  succeeded: boolean,
  at = Date.now(),
): void {
  const outcome = run?.workPackageOutcomes[workPackageId]
  if (!outcome) return

  outcome.finishedAt = at

  if (!succeeded) {
    outcome.finalOutcome = "failed"
    outcome.evidence.push(`${new Date(at).toISOString()} agent boundary failed`)
    return
  }

  if (outcome.testFailures > 0 && outcome.testPasses === 0) {
    outcome.finalOutcome = "partial"
    return
  }

  outcome.finalOutcome = "succeeded"
}
