import type { On } from "claude-code"

import type {
  DecisionRecord,
  ModelDecision,
  SessionState,
  WorkPackage,
} from "./domain"
import { askKev } from "./kev"
import { fallbackDecision } from "./policy"
import { rewriteKevPrompt } from "./prompt"

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
  const state: SessionState = { decisions: [] }

  on("session.start", ($, e, next) => {
    state.decisions.length = 0
    $.ui.log("claude-kev-orchestrator: active", { to: "debug" })
    return next(e)
  })

  on("prompt.submit", ($, e, next) => {
    const rewritten = rewriteKevPrompt(e.text)
    return rewritten === undefined ? next(e) : next({ ...e, text: rewritten })
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
