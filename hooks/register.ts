import type { On } from "claude-code"

import type {
  DecisionRecord,
  ModelDecision,
  SessionState,
  WorkPackage,
} from "./domain"
import { askKev } from "./kev"
import { fallbackDecision } from "./policy"
import { isKevPrompt, rewriteKevPrompt } from "./prompt"
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

export function register(on: On): void {
  const state: SessionState = {
    active: false,
    phase: "idle",
    delegatedPackages: 0,
    decisions: [],
  }

  on("session.start", ($, e, next) => {
    state.decisions.length = 0
    resetOrchestration(state)
    $.ui.log("claude-kev-orchestrator: active", { to: "debug" })
    return next(e)
  })

  on("prompt.submit", ($, e, next) => {
    if (!isKevPrompt(e.text)) {
      resetOrchestration(state)
      return next(e)
    }

    startOrchestration(state)
    const rewritten = rewriteKevPrompt(e.text)

    $.ui.log(
      "kev: orchestration enabled; parent starts in decompose phase",
      { to: "debug" },
    )

    return rewritten === undefined ? next(e) : next({ ...e, text: rewritten })
  })

  // The main-loop parent is an architect/orchestrator while decomposition is
  // active. Workers (tool calls with an agentId) are never blocked here.
  for (const tool of ["Edit", "Write", "NotebookEdit"]) {
    on("tool.call", { tool }, ($, e, next) => {
      if (shouldDenyParentEdit(state, e.tool, e.agentId)) {
        const deny = parentEditDenyReason(state)
        $.ui.log(`kev: denied parent ${e.tool} during ${state.phase}`, {
          to: "debug",
        })
        return { deny }
      }

      return next(e)
    })
  }

  // The Agent tool is the transition from parent decomposition into delegated
  // execution. When the tool returns successfully, the parent can integrate.
  on("tool.call", { tool: "Agent" }, async ($, e, next) => {
    if (!state.active || e.agentId !== undefined) {
      return next(e)
    }

    const before = state.delegatedPackages
    beginDelegation(state)
    const result = await next(e)
    const delegated = state.delegatedPackages > before
    const succeeded =
      result.deny === undefined && !result.isError && delegated

    delegationFinished(state, succeeded)

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

    state.decisions.push({
      at: Date.now(),
      workPackage,
      decision,
      source,
    })

    workerSpawned(state)

    const reason = decision.reason ? ` - ${decision.reason}` : ""
    $.ui.log(
      `kev: ${workPackage.description} -> ${decision.model} (${Math.round(
        decision.confidence * 100,
      )}%)${reason}`,
      { to: "debug" },
    )

    if (decision.model === "inherit") {
      return next(e)
    }

    return next({ ...e, model: decision.model })
  })
}
