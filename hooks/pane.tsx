/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { ElementTable, RenderElement } from "claude-code"

import type { ModelAlias, RunObservation, SessionState } from "./domain"

export const PANE_ID = "kev-orchestrator"
export const PANE_TITLE = "Kev Orchestrator"

type Ui = Pick<
  ElementTable<"terminal" | "desktop">,
  "Box" | "Text" | "Button"
>

export interface PaneActions {
  setNextModel(model: Exclude<ModelAlias, "inherit"> | undefined): void
  runCodexReview(): void
}

function short(value: string | undefined, length = 8): string {
  if (!value) return "-"
  return value.length <= length ? value : value.slice(0, length)
}

function modelLabel(model: ModelAlias | undefined): string {
  return model ?? "auto"
}

export function paneView(
  ui: Ui,
  state: SessionState,
  actions: PaneActions,
): RenderElement {
  const { Box, Text, Button } = ui
  const run = state.currentRun
  const decisions = run?.decisions.slice(-6).reverse() ?? []
  const latestReview = run?.reviews[run.reviews.length - 1]

  return (
    <Box flexDirection="column">
      <Text>
        Phase: <Text bold>{state.phase}</Text>
        <Text dimColor>{run ? `  run ${short(run.id)}` : "  no active run"}</Text>
      </Text>

      <Text>
        Next worker: <Text bold>{modelLabel(state.nextModelOverride)}</Text>
      </Text>

      <Box flexDirection="row">
        <Button key="kev-auto" plain onPress={() => actions.setNextModel(undefined)}>
          [Auto]
        </Button>
        <Text> </Text>
        <Button key="kev-haiku" plain onPress={() => actions.setNextModel("haiku")}>
          [Haiku]
        </Button>
        <Text> </Text>
        <Button key="kev-sonnet" plain onPress={() => actions.setNextModel("sonnet")}>
          [Sonnet]
        </Button>
        <Text> </Text>
        <Button key="kev-opus" plain onPress={() => actions.setNextModel("opus")}>
          [Opus]
        </Button>
      </Box>

      <Box flexDirection="row">
        <Button key="kev-review" plain onPress={() => actions.runCodexReview()}>
          [Codex Review]
        </Button>
        <Text dimColor>
          {latestReview
            ? `  last: ${latestReview.succeeded ? "ok" : "failed"}`
            : "  optional external review"}
        </Text>
      </Box>

      <Text dimColor>────────────────────────────────</Text>

      {decisions.length === 0 ? (
        <Text dimColor>No Work Packages yet.</Text>
      ) : (
        <Box flexDirection="column">
          {decisions.map((record) => {
            const outcome = run?.workPackageOutcomes[record.workPackage.id]
            const recommended = record.recommendedDecision?.model
            const routed =
              recommended && recommended !== record.decision.model
                ? `${recommended}→${record.decision.model}`
                : record.decision.model
            const tests = outcome
              ? ` t:${outcome.testPasses}/${outcome.testFailures}`
              : ""

            return (
              <Text key={record.workPackage.id} wrap="truncate-end">
                {short(record.workPackage.id, 6)}{" "}
                <Text bold>{routed}</Text>{" "}
                <Text dimColor>
                  {Math.round(record.decision.confidence * 100)}%
                  {outcome ? ` ${outcome.finalOutcome}${tests}` : ""}
                </Text>
              </Text>
            )
          })}
        </Box>
      )}

      <Text dimColor>
        delegated={state.delegatedPackages}
        {run
          ? ` violations=${run.events.filter((e) => e.type === "parent_edit_denied").length}`
          : ""}
      </Text>
    </Box>
  )
}
