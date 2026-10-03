import { randomUUID } from "node:crypto"

import type { EngineInterface, On } from "claude-code"

import type {
  DecisionRecord,
  ModelDecision,
  RunEvent,
  SessionState,
  WorkPackage,
} from "./domain"
import { askKev } from "./kev"
import {
  bindAgent,
  completeWorkPackage,
  observeWorkerTool,
  startWorkPackageOutcome,
} from "./observer"
import { PANE_ID, PANE_TITLE, paneView } from "./pane"
import { fallbackDecision } from "./policy"
import { isKevPrompt, rewriteKevPrompt } from "./prompt"
import {
  createRun,
  recordDecision,
  recordEvent,
  syncRun,
  writeRunReport,
} from "./reporter"
import { runCodexReview, shouldAutoReview } from "./reviewer"
import {
  beginDelegation,
  delegationFinished,
  parentEditDenyReason,
  resetOrchestration,
  shouldDenyParentEdit,
  startOrchestration,
  workerSpawned,
} from "./state-machine"

const DEFAULT_TIMEOUT_MS = 1500

function parseTimeout(raw: string | undefined): number {
  if (!raw) return DEFAULT_TIMEOUT_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
}

function packageFromSpawn(e: {
  tool_use_id: string
  prompt: string
  description: string
  subagentType: string
  parentModel: string
  background: boolean
  fork: boolean
}): WorkPackage {
  return {
    id: e.tool_use_id,
    prompt: e.prompt,
    description: e.description,
    subagentType: e.subagentType,
    parentModel: e.parentModel,
    background: e.background,
    fork: e.fork,
  }
}

function runEvent(
  state: SessionState,
  event: Omit<RunEvent, "at" | "phase"> & {
    at?: number
    phase?: RunEvent["phase"]
  },
): void {
  recordEvent(state.currentRun, {
    at: event.at ?? Date.now(),
    phase: event.phase ?? state.phase,
    ...event,
  })
}

async function persistRun(
  $: EngineInterface,
  state: SessionState,
): Promise<string | undefined> {
  const run = state.currentRun
  if (!run) return undefined

  syncRun(run, state)
  const cwd = await $.session.cwd()
  const reportDir = await $.env.get("KEV_REPORT_DIR")
  return writeRunReport(cwd, reportDir, run)
}

async function executeCodexReview(
  $: EngineInterface,
  state: SessionState,
  trigger: "manual" | "auto",
): Promise<string> {
  const review = await runCodexReview($, state.currentRun, trigger)
  const written = await persistRun($, state)

  $.ui.invalidate("ui.render")

  if (!review.succeeded) {
    const detail = review.error || review.output || "unknown error"
    $.ui.log(`kev: Codex review failed: ${detail}`, { to: "debug" })
    return `Codex review failed: ${detail}`
  }

  $.ui.log(
    `kev: Codex review completed${written ? `; report=${written}` : ""}`,
    { to: "debug" },
  )

  return review.output || "Codex review completed with no textual output."
}

async function finalizeRun(
  $: EngineInterface,
  state: SessionState,
): Promise<void> {
  const run = state.currentRun
  if (!run || run.finishedAt !== undefined) return

  if (
    (await shouldAutoReview($)) &&
    !run.reviews.some((review) => review.trigger === "auto")
  ) {
    await executeCodexReview($, state, "auto")
  }

  syncRun(run, state)
  run.finishedAt = Date.now()
  run.finalPhase = state.phase
  runEvent(state, { type: "run_completed" })

  const written = await persistRun($, state)
  if (!written) return

  recordEvent(run, {
    at: Date.now(),
    type: "report_written",
    phase: state.phase,
    detail: written,
  })

  // Rewrite once so report_written is also persisted.
  await persistRun($, state)
  $.ui.log(`kev: run report written to ${written}`, { to: "debug" })
}

export function register(on: On): void {
  const state: SessionState = {
    active: false,
    phase: "idle",
    delegatedPackages: 0,
    decisions: [],
  }

  let isPaneOpen = false

  const invalidate = ($: EngineInterface): void => {
    $.ui.invalidate("ui.render")
  }

  const openPane = async ($: EngineInterface): Promise<void> => {
    if (isPaneOpen) {
      invalidate($)
      return
    }

    try {
      const opened = await $.ui.open({
        id: PANE_ID,
        title: PANE_TITLE,
        holdToasts: true,
      })
      const isPlaced =
        typeof opened !== "object" ||
        opened === null ||
        !("isPlaced" in opened) ||
        (opened as { isPlaced?: unknown }).isPlaced !== false

      isPaneOpen = isPlaced
      if (isPlaced) invalidate($)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      $.ui.log(`kev: pane unavailable on this surface: ${message}`, {
        to: "debug",
      })
    }
  }

  on("session.start", async ($, e, next) => {
    state.decisions.length = 0
    state.currentRun = undefined
    state.nextModelOverride = undefined
    resetOrchestration(state)

    for (const command of [
      {
        name: "kev",
        description: "Toggle the Kev Orchestrator pane",
      },
      {
        name: "kev-review",
        description: "Run an optional Codex review of uncommitted changes",
      },
    ] as const) {
      try {
        await $.command.register(command)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        $.ui.log(
          `kev: /${command.name} registration skipped: ${message}`,
          { to: "debug" },
        )
      }
    }

    $.ui.log("claude-kev-orchestrator: active", { to: "debug" })
    return next(e)
  })

  on("command.run", { command: "kev" }, async ($) => {
    if (isPaneOpen) {
      await $.ui.close({ id: PANE_ID }).catch(() => undefined)
      isPaneOpen = false
      return { text: "Kev Orchestrator pane hidden." }
    }

    await openPane($)
    return {
      text: isPaneOpen
        ? "Kev Orchestrator pane shown."
        : "Kev Orchestrator pane is unavailable on this surface.",
    }
  })

  on("command.run", { command: "kev-review" }, async ($) => {
    const text = await executeCodexReview($, state, "manual")
    return { text }
  })

  on("ui.close", { id: PANE_ID }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined) isPaneOpen = false
    return result
  })

  on("ui.render", { component: "Pane" }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e)

    try {
      const { Box, Text, Button } = await $.ui.resolve(e)

      return paneView(
        { Box, Text, Button },
        state,
        {
          setNextModel: (model) => {
            state.nextModelOverride = model
            $.ui.log(
              `kev: next worker override=${model ?? "auto"}`,
              { to: "debug" },
            )
            invalidate($)
          },
          runCodexReview: () => {
            void executeCodexReview($, state, "manual")
          },
        },
      )
    } catch {
      return next(e)
    }
  })

  on("prompt.submit", async ($, e, next) => {
    if (!isKevPrompt(e.text)) {
      await finalizeRun($, state)
      resetOrchestration(state)
      state.currentRun = undefined
      state.nextModelOverride = undefined
      invalidate($)
      return next(e)
    }

    await finalizeRun($, state)
    startOrchestration(state)
    state.decisions.length = 0
    state.nextModelOverride = undefined
    state.currentRun = createRun(randomUUID(), e.text)
    runEvent(state, { type: "run_started" })

    const rewritten = rewriteKevPrompt(e.text)

    $.ui.log(
      `kev: orchestration enabled; run=${state.currentRun.id}; parent starts in decompose phase`,
      { to: "debug" },
    )

    void openPane($)
    invalidate($)

    return rewritten === undefined ? next(e) : next({ ...e, text: rewritten })
  })

  for (const tool of ["Edit", "Write", "NotebookEdit"]) {
    on("tool.call", { tool }, ($, e, next) => {
      if (shouldDenyParentEdit(state, e.tool, e.agentId)) {
        const deny = parentEditDenyReason(state)
        runEvent(state, {
          type: "parent_edit_denied",
          actor: "parent",
          tool: e.tool,
          outcome: "denied",
          detail: deny,
        })
        $.ui.log(`kev: denied parent ${e.tool} during ${state.phase}`, {
          to: "debug",
        })
        invalidate($)
        return { deny }
      }

      return next(e)
    })
  }

  on("tool.call", { tool: "Agent" }, async ($, e, next) => {
    if (!state.active || e.agentId !== undefined) {
      return next(e)
    }

    const before = state.delegatedPackages
    const beforeDecisionCount = state.currentRun?.decisions.length ?? 0
    beginDelegation(state)
    syncRun(state.currentRun, state)
    runEvent(state, {
      type: "agent_tool_started",
      actor: "parent",
      tool: "Agent",
    })
    invalidate($)

    const result = await next(e)
    const delegated = state.delegatedPackages > before
    const succeeded =
      result.deny === undefined && !result.isError && delegated

    const delegatedRecords =
      state.currentRun?.decisions.slice(beforeDecisionCount) ?? []

    for (const record of delegatedRecords) {
      completeWorkPackage(
        state.currentRun,
        record.workPackage.id,
        succeeded,
      )
    }

    delegationFinished(state, succeeded)
    syncRun(state.currentRun, state)
    runEvent(state, {
      type: "agent_tool_completed",
      actor: "parent",
      tool: "Agent",
      outcome: succeeded ? "succeeded" : "failed",
      detail:
        delegatedRecords.length > 0
          ? `completed work packages: ${delegatedRecords
              .map((record) => record.workPackage.id)
              .join(", ")}`
          : "no spawned work package observed",
    })

    $.ui.log(
      `kev: Agent tool completed; phase=${state.phase}, delegated=${state.delegatedPackages}`,
      { to: "debug" },
    )
    invalidate($)

    return result
  })

  on("agent.spawn", async ($, e, next) => {
    const workPackage = packageFromSpawn(e)
    const endpoint = await $.env.get("KEV_ENDPOINT")
    const timeoutMs = parseTimeout(await $.env.get("KEV_TIMEOUT_MS"))

    let recommended: ModelDecision | undefined
    let recommendationSource: "kev" | "fallback" = "fallback"

    if (endpoint) {
      recommended = await askKev(endpoint, timeoutMs, workPackage)
      if (recommended) recommendationSource = "kev"
    }

    recommended ??= fallbackDecision(workPackage)

    let decision = recommended
    let source: DecisionRecord["source"] = recommendationSource

    const humanOverride = state.nextModelOverride
    if (humanOverride !== undefined) {
      decision = {
        ...recommended,
        model: humanOverride,
        reason: `Human override: ${recommended.model} -> ${humanOverride}. ${recommended.reason ?? ""}`.trim(),
      }
      source = "human_override"
      state.nextModelOverride = undefined
    }

    const record: DecisionRecord = {
      at: Date.now(),
      workPackage,
      decision,
      recommendedDecision:
        source === "human_override" ? recommended : undefined,
      source,
    }

    state.decisions.push(record)
    recordDecision(state.currentRun, record)

    const lineage = startWorkPackageOutcome(
      state.currentRun,
      workPackage.id,
      workPackage.description,
      decision.model,
      record.at,
    )
    record.lineageId = lineage.lineageId
    record.attempt = lineage.attempt
    record.escalatedFrom = lineage.escalatedFrom

    workerSpawned(state)
    syncRun(state.currentRun, state)
    invalidate($)

    const result =
      decision.model === "inherit"
        ? await next(e)
        : await next({ ...e, model: decision.model })

    const agentId = result.agentId
    if (agentId !== undefined) record.agentId = agentId
    bindAgent(state.currentRun, workPackage.id, agentId)

    runEvent(state, {
      type: "agent_spawned",
      actor: "worker",
      agentId,
      workPackageId: workPackage.id,
      model: decision.model,
      detail:
        source === "human_override"
          ? `recommended=${recommended.model}; selected=${decision.model}`
          : decision.reason,
    })

    const reason = decision.reason ? ` - ${decision.reason}` : ""
    $.ui.log(
      `kev: ${workPackage.description} -> ${decision.model} (${Math.round(
        decision.confidence * 100,
      )}%) [${source}]${reason}`,
      { to: "debug" },
    )
    invalidate($)

    return result
  })

  // Observe worker-side tools after execution and bind them back to the
  // Work Package through agentId. This does not alter tool behavior.
  on("tool.call", async ($, e, next) => {
    const result = await next(e)

    if (!state.active || e.agentId === undefined) {
      return result
    }

    const command =
      e.tool === "Bash" && "command" in e && typeof e.command === "string"
        ? e.command
        : undefined

    const observed = observeWorkerTool(
      state.currentRun,
      e.agentId,
      e.tool,
      command,
      result,
    )

    if (observed.workPackageId !== undefined) {
      runEvent(state, {
        type: observed.isTest
          ? "worker_test_completed"
          : "worker_tool_completed",
        actor: "worker",
        agentId: e.agentId,
        workPackageId: observed.workPackageId,
        tool: e.tool,
        outcome: observed.succeeded ? "succeeded" : "failed",
        detail:
          observed.isTest && command !== undefined
            ? command.slice(0, 300)
            : undefined,
      })
      invalidate($)
    }

    return result
  })

  on("turn.complete", async ($, e, next) => {
    const isWorkerTurn =
      "agentId" in e &&
      typeof (e as { agentId?: unknown }).agentId === "string"

    if (state.active && !isWorkerTurn) await finalizeRun($, state)
    invalidate($)
    return next(e)
  })

  on("session.end", async ($, e, next) => {
    if (state.active) await finalizeRun($, state)
    return next(e)
  })
}
