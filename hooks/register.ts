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
import { fallbackDecision } from "./policy"
import { isKevPrompt, rewriteKevPrompt } from "./prompt"
import {
  createRun,
  recordDecision,
  recordEvent,
  syncRun,
  writeRunReport,
} from "./reporter"
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
  event: Omit<RunEvent, "at" | "phase"> & { at?: number; phase?: RunEvent["phase"] },
): void {
  recordEvent(state.currentRun, {
    at: event.at ?? Date.now(),
    phase: event.phase ?? state.phase,
    ...event,
  })
}

async function finalizeRun(
  $: EngineInterface,
  state: SessionState,
): Promise<void> {
  const run = state.currentRun
  if (!run || run.finishedAt !== undefined) return

  syncRun(run, state)
  run.finishedAt = Date.now()
  run.finalPhase = state.phase
  runEvent(state, { type: "run_completed" })

  const cwd = await $.session.cwd()
  const reportDir = await $.env.get("KEV_REPORT_DIR")
  const written = await writeRunReport(cwd, reportDir, run)

  recordEvent(run, {
    at: Date.now(),
    type: "report_written",
    phase: state.phase,
    detail: written,
  })

  // Rewrite once so report_written is also persisted.
  await writeRunReport(cwd, reportDir, run)
  $.ui.log(`kev: run report written to ${written}`, { to: "debug" })
}

export function register(on: On): void {
  const state: SessionState = {
    active: false,
    phase: "idle",
    delegatedPackages: 0,
    decisions: [],
  }

  on("session.start", ($, e, next) => {
    state.decisions.length = 0
    state.currentRun = undefined
    resetOrchestration(state)
    $.ui.log("claude-kev-orchestrator: active", { to: "debug" })
    return next(e)
  })

  on("prompt.submit", async ($, e, next) => {
    if (!isKevPrompt(e.text)) {
      await finalizeRun($, state)
      resetOrchestration(state)
      state.currentRun = undefined
      return next(e)
    }

    await finalizeRun($, state)
    startOrchestration(state)
    state.decisions.length = 0
    state.currentRun = createRun(randomUUID(), e.text)
    runEvent(state, { type: "run_started" })

    const rewritten = rewriteKevPrompt(e.text)

    $.ui.log(
      `kev: orchestration enabled; run=${state.currentRun.id}; parent starts in decompose phase`,
      { to: "debug" },
    )

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
    beginDelegation(state)
    syncRun(state.currentRun, state)
    runEvent(state, { type: "agent_tool_started", actor: "parent", tool: "Agent" })

    const result = await next(e)
    const delegated = state.delegatedPackages > before
    const succeeded =
      result.deny === undefined && !result.isError && delegated

    delegationFinished(state, succeeded)
    syncRun(state.currentRun, state)
    runEvent(state, {
      type: "agent_tool_completed",
      actor: "parent",
      tool: "Agent",
      outcome: succeeded ? "succeeded" : "failed",
    })

    $.ui.log(
      `kev: Agent tool completed; phase=${state.phase}, delegated=${state.delegatedPackages}`,
      { to: "debug" },
    )

    return result
  })

  on("agent.spawn", async ($, e, next) => {
    const workPackage = packageFromSpawn(e)
    const endpoint = await $.env.get("KEV_ENDPOINT")
    const timeoutMs = parseTimeout(await $.env.get("KEV_TIMEOUT_MS"))

    let decision: ModelDecision | undefined
    let source: DecisionRecord["source"] = "fallback"

    if (endpoint) {
      decision = await askKev(endpoint, timeoutMs, workPackage)
      if (decision) source = "kev"
    }

    decision ??= fallbackDecision(workPackage)

    const record: DecisionRecord = {
      at: Date.now(),
      workPackage,
      decision,
      source,
    }

    state.decisions.push(record)
    recordDecision(state.currentRun, record)
    workerSpawned(state)
    syncRun(state.currentRun, state)

    const result =
      decision.model === "inherit"
        ? await next(e)
        : await next({ ...e, model: decision.model })

    const agentId = result.agentId
    if (agentId !== undefined) record.agentId = agentId

    runEvent(state, {
      type: "agent_spawned",
      actor: "worker",
      agentId,
      workPackageId: workPackage.id,
      model: decision.model,
      detail: decision.reason,
    })

    const reason = decision.reason ? ` - ${decision.reason}` : ""
    $.ui.log(
      `kev: ${workPackage.description} -> ${decision.model} (${Math.round(
        decision.confidence * 100,
      )}%)${reason}`,
      { to: "debug" },
    )

    return result
  })

  on("turn.complete", async ($, e, next) => {
    if (state.active) await finalizeRun($, state)
    return next(e)
  })

  on("session.end", async ($, e, next) => {
    if (state.active) await finalizeRun($, state)
    return next(e)
  })
}
