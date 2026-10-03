import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import type {
  DecisionRecord,
  RunEvent,
  RunObservation,
  SessionState,
} from "./domain"

function jsonl(values: readonly unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : "")
}

function countBy<T extends string>(values: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const value of values) out[value] = (out[value] ?? 0) + 1
  return out
}

function markdown(run: RunObservation): string {
  const decisions = run.decisions
  const models = countBy(decisions.map((record) => record.decision.model))
  const violations = run.events.filter((event) => event.type === "parent_edit_denied")
  const outcomes = Object.values(run.workPackageOutcomes)
  const tested = outcomes.filter((outcome) => outcome.testRuns > 0)
  const firstPassLike = tested.filter(
    (outcome) => outcome.testPasses > 0 && outcome.testFailures === 0,
  )
  const failed = outcomes.filter((outcome) => outcome.finalOutcome === "failed")
  const partial = outcomes.filter((outcome) => outcome.finalOutcome === "partial")
  const retries = outcomes.filter((outcome) => outcome.attempt > 1)
  const escalations = outcomes.filter((outcome) => outcome.escalatedFrom !== undefined)

  const decisionRows =
    decisions.length === 0
      ? "_No work packages were routed._"
      : [
          "| Work package | Model | Confidence | Source | Split? | Outcome | Tests | Edits | Reason |",
          "| --- | --- | ---: | --- | --- | --- | --- | ---: | --- |",
          ...decisions.map((record) => {
            const reason = (record.decision.reason ?? "").replaceAll("|", "\\|")
            const outcome = run.workPackageOutcomes[record.workPackage.id]
            const tests = outcome
              ? `${outcome.testPasses} pass / ${outcome.testFailures} fail`
              : "n/a"
            return `| ${record.workPackage.description.replaceAll("|", "\\|")} | ${record.decision.model} | ${Math.round(record.decision.confidence * 100)}% | ${record.source} | ${record.decision.shouldSplit ? "yes" : "no"} | ${outcome?.finalOutcome ?? "unknown"} | ${tests} | ${outcome?.editCalls ?? 0} | ${reason} |`
          }),
        ].join("\n")

  const outcomeRows =
    outcomes.length === 0
      ? "_No worker outcomes were observed._"
      : outcomes
          .map((outcome) => {
            const duration =
              outcome.finishedAt === undefined
                ? "open"
                : `${outcome.finishedAt - outcome.startedAt} ms`
            return `- \`${outcome.workPackageId}\` lineage=\`${outcome.lineageId}\`, attempt=${outcome.attempt}, model=${outcome.model}${outcome.escalatedFrom ? ` (escalated from ${outcome.escalatedFrom})` : ""}, outcome=${outcome.finalOutcome}, edits=${outcome.editCalls}, tests=${outcome.testRuns} (${outcome.testPasses} pass / ${outcome.testFailures} fail), otherToolFailures=${outcome.otherToolFailures}, duration=${duration}`
          })
          .join("\n")

  return `# Kev Orchestration Run

## Summary

- Run ID: \`${run.id}\`
- Started: ${new Date(run.startedAt).toISOString()}
- Finished: ${run.finishedAt ? new Date(run.finishedAt).toISOString() : "not finished"}
- Final phase: \`${run.finalPhase ?? run.phase}\`
- Delegated packages: ${run.delegatedPackages}
- Parent execution-contract violations: ${violations.length}
- Worker outcomes: ${outcomes.length}
- Failed worker outcomes: ${failed.length}
- Partial worker outcomes: ${partial.length}
- Inferred retries: ${retries.length}
- Inferred model escalations: ${escalations.length}
- Work packages with observed tests: ${tested.length}
- Test-clean packages: ${firstPassLike.length}

### Model routing

${Object.keys(models).length === 0 ? "- none" : Object.entries(models).map(([model, count]) => `- ${model}: ${count}`).join("\n")}

## Routing decisions and observed outcomes

${decisionRows}

## Worker execution

${outcomeRows}

## Execution-contract violations

${violations.length === 0 ? "_None._" : violations.map((event) => `- ${new Date(event.at).toISOString()} — ${event.tool ?? "unknown tool"} during \`${event.phase}\``).join("\n")}

## Evaluation prompts

Review this run and answer:

1. Was each selected model appropriate for the observed outcome?
2. Did a Haiku/Sonnet package need retries, failed tests, or stronger-model follow-up?
3. Which packages should have been split further?
4. Which packages were over-routed to a stronger model?
5. Did runtime enforcement prevent useful work or correctly stop premature parent implementation?
6. What execution-policy rule should change before the next run?

Human feedback can be recorded in \`feedback.json\` beside this report.
`
}

export function createRun(id: string, prompt: string, at = Date.now()): RunObservation {
  return {
    id,
    prompt,
    startedAt: at,
    phase: "decompose",
    delegatedPackages: 0,
    decisions: [],
    events: [],
    workPackageOutcomes: {},
    agentToWorkPackage: {},
    lineageAttempts: {},
  }
}

export function recordEvent(run: RunObservation | undefined, event: RunEvent): void {
  run?.events.push(event)
}

export function recordDecision(
  run: RunObservation | undefined,
  decision: DecisionRecord,
): void {
  run?.decisions.push(decision)
}

export function syncRun(run: RunObservation | undefined, state: SessionState): void {
  if (!run) return
  run.phase = state.phase
  run.delegatedPackages = state.delegatedPackages
}

export async function writeRunReport(
  cwd: string,
  reportDir: string | undefined,
  run: RunObservation,
): Promise<string> {
  const base = reportDir
    ? path.resolve(cwd, reportDir)
    : path.join(cwd, ".kev", "runs")
  const dir = path.join(base, run.id)

  await mkdir(dir, { recursive: true })

  const outcomes = Object.values(run.workPackageOutcomes)

  await Promise.all([
    writeFile(path.join(dir, "run.json"), JSON.stringify(run, null, 2) + "\n", "utf8"),
    writeFile(path.join(dir, "events.jsonl"), jsonl(run.events), "utf8"),
    writeFile(path.join(dir, "decisions.jsonl"), jsonl(run.decisions), "utf8"),
    writeFile(path.join(dir, "outcomes.jsonl"), jsonl(outcomes), "utf8"),
    writeFile(path.join(dir, "report.md"), markdown(run), "utf8"),
    writeFile(
      path.join(dir, "feedback.json"),
      JSON.stringify(
        {
          runId: run.id,
          overall: null,
          problematicWorkPackages: [],
          comments: "",
          suggestedPolicyChanges: [],
        },
        null,
        2,
      ) + "\n",
      "utf8",
    ),
  ])

  return dir
}
