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
  const agentCompletions = run.events.filter((event) => event.type === "agent_tool_completed")
  const failedAgentCalls = agentCompletions.filter((event) => event.outcome === "failed")

  const decisionRows =
    decisions.length === 0
      ? "_No work packages were routed._"
      : [
          "| Work package | Model | Confidence | Source | Split? | Reason |",
          "| --- | --- | ---: | --- | --- | --- |",
          ...decisions.map((record) => {
            const reason = (record.decision.reason ?? "").replaceAll("|", "\\|")
            return `| ${record.workPackage.description.replaceAll("|", "\\|")} | ${record.decision.model} | ${Math.round(record.decision.confidence * 100)}% | ${record.source} | ${record.decision.shouldSplit ? "yes" : "no"} | ${reason} |`
          }),
        ].join("\n")

  return `# Kev Orchestration Run

## Summary

- Run ID: \`${run.id}\`
- Started: ${new Date(run.startedAt).toISOString()}
- Finished: ${run.finishedAt ? new Date(run.finishedAt).toISOString() : "not finished"}
- Final phase: \`${run.finalPhase ?? run.phase}\`
- Delegated packages: ${run.delegatedPackages}
- Parent execution-contract violations: ${violations.length}
- Failed Agent calls: ${failedAgentCalls.length}

### Model routing

${Object.keys(models).length === 0 ? "- none" : Object.entries(models).map(([model, count]) => `- ${model}: ${count}`).join("\n")}

## Routing decisions

${decisionRows}

## Execution-contract violations

${violations.length === 0 ? "_None._" : violations.map((event) => `- ${new Date(event.at).toISOString()} — ${event.tool ?? "unknown tool"} during \`${event.phase}\``).join("\n")}

## Evaluation prompts

Review this run and answer:

1. Was each selected model appropriate for the work package?
2. Which packages should have been split further?
3. Which packages were over-routed to a stronger model?
4. Did runtime enforcement prevent useful work or correctly stop premature parent implementation?
5. What execution-policy rule should change before the next run?

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

  await Promise.all([
    writeFile(path.join(dir, "run.json"), JSON.stringify(run, null, 2) + "\n", "utf8"),
    writeFile(path.join(dir, "events.jsonl"), jsonl(run.events), "utf8"),
    writeFile(path.join(dir, "decisions.jsonl"), jsonl(run.decisions), "utf8"),
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
