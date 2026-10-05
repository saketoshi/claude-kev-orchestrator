import type { EngineInterface, HttpResponse, On } from "claude-code"

import type {
  DecisionRecord,
  ModelDecision,
  RunEvent,
  SessionState,
  WorkPackage,
} from "./domain"
import {
  DEFAULT_MIN_CONFIDENCE,
  DEFAULT_RIBBON_BASE_URL,
  DEFAULT_RIBBON_MODEL,
  DEFAULT_TIMEOUT_MS,
  applyConfidenceFloor,
  endpointRequest,
  normalizeDecision,
  parseRibbonDecision,
  ribbonRequest,
  safeRibbonToken,
} from "./kev"
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
  joinPath,
  recordDecision,
  recordEvent,
  reportArtifacts,
  reportDirectory,
  syncRun,
} from "./reporter"
import {
  codexReviewCommand,
  codexReviewErrorRecord,
  codexReviewRecord,
  isEnabled,
  parseCodexTimeout,
} from "./reviewer"
import {
  beginDelegation,
  delegationFinished,
  parentEditDenyReason,
  resetOrchestration,
  shouldDenyParentEdit,
  startOrchestration,
  workerSpawned,
} from "./state-machine"

type KevConfig =
  | {
      mode: "endpoint"
      endpoint: string
      timeoutMs: number
      minConfidence: number
    }
  | {
      mode: "ribbon"
      baseUrl: string
      apiKey?: string
      model: string
      timeoutMs: number
      minConfidence: number
    }

type PaneRuntime = { isOpen: boolean }

type FetchOutcome =
  | { kind: "response"; response: HttpResponse }
  | { kind: "timeout" }
  | { kind: "error"; error: unknown }

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
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

async function resolveKevConfig($: EngineInterface): Promise<KevConfig> {
  const endpoint = await $.env.get("KEV_ENDPOINT")
  const timeoutMs = parsePositiveNumber(
    await $.env.get("KEV_TIMEOUT_MS"),
    DEFAULT_TIMEOUT_MS,
  )
  const minConfidence = Math.max(
    0,
    Math.min(
      1,
      parsePositiveNumber(
        await $.env.get("KEV_MIN_CONFIDENCE"),
        DEFAULT_MIN_CONFIDENCE,
      ),
    ),
  )

  if (endpoint) {
    return { mode: "endpoint", endpoint, timeoutMs, minConfidence }
  }

  const baseUrl =
    (await $.env.get("KEV_BASE_URL")) ?? DEFAULT_RIBBON_BASE_URL
  const explicitKey = await $.env.get("KEV_API_KEY")
  const anthropicToken = await $.env.get("ANTHROPIC_AUTH_TOKEN")
  const apiKey = safeRibbonToken(baseUrl, explicitKey, anthropicToken)
  const model = (await $.env.get("KEV_MODEL")) ?? DEFAULT_RIBBON_MODEL

  return {
    mode: "ribbon",
    baseUrl,
    apiKey,
    model,
    timeoutMs,
    minConfidence,
  }
}

async function fetchWithTimeout(
  $: EngineInterface,
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string },
  timeoutMs: number,
): Promise<FetchOutcome> {
  return new Promise((resolve) => {
    let settled = false
    const timer = $.clock.after(timeoutMs, () => {
      if (settled) return
      settled = true
      resolve({ kind: "timeout" })
    })

    const finish = (outcome: FetchOutcome): void => {
      if (settled) return
      settled = true
      timer.cancel()
      resolve(outcome)
    }

    $.http
      .fetch(url, init)
      .then((response) => finish({ kind: "response", response }))
      .catch((error: unknown) => finish({ kind: "error", error }))
  })
}

async function askKev(
  $: EngineInterface,
  config: KevConfig,
  workPackage: WorkPackage,
): Promise<ModelDecision | undefined> {
  if (config.mode === "ribbon" && !config.apiKey) {
    $.ui.log(
      "kev: Ribbon routing unavailable: set KEV_API_KEY or use the default Ribbon URL with ANTHROPIC_AUTH_TOKEN",
      { to: "debug" },
    )
    return undefined
  }

  const request =
    config.mode === "endpoint"
      ? endpointRequest(config.endpoint, workPackage)
      : ribbonRequest(config.baseUrl, config.apiKey ?? "", config.model, workPackage)

  const outcome = await fetchWithTimeout(
    $,
    request.url,
    {
      method: request.method,
      headers: request.headers,
      body: request.body,
    },
    config.timeoutMs,
  )

  if (outcome.kind === "timeout") {
    $.ui.log(`kev: routing timed out after ${config.timeoutMs}ms`, { to: "debug" })
    return undefined
  }
  if (outcome.kind === "error") {
    const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
    $.ui.log(`kev: routing request failed: ${message}`, { to: "debug" })
    return undefined
  }

  const { response } = outcome
  if (!response.ok) {
    const requestId = response.headers["x-typesafe-request-id"]
    $.ui.log(
      `kev: routing HTTP ${response.status}${requestId ? ` request-id=${requestId}` : ""}`,
      { to: "debug" },
    )
    return undefined
  }

  let value: unknown
  try {
    value = JSON.parse(response.text)
  } catch {
    $.ui.log("kev: routing response was not valid JSON", { to: "debug" })
    return undefined
  }

  const decision =
    config.mode === "endpoint"
      ? normalizeDecision(value)
      : parseRibbonDecision(value)
  if (!decision) {
    $.ui.log("kev: routing response did not contain a valid decision", {
      to: "debug",
    })
    return undefined
  }

  return applyConfidenceFloor(decision, config.minConfidence)
}

function invalidate($: EngineInterface): void {
  $.ui.invalidate("ui.render")
}

async function openPane(
  $: EngineInterface,
  pane: PaneRuntime,
): Promise<void> {
  if (pane.isOpen) {
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

    pane.isOpen = isPlaced
    if (isPlaced) invalidate($)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    $.ui.log(`kev: pane unavailable on this surface: ${message}`, {
      to: "debug",
    })
  }
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
  const directory = reportDirectory(cwd, reportDir, run.id)

  for (const artifact of reportArtifacts(run)) {
    const path = joinPath(directory, artifact.name)
    if (artifact.preserveExisting && (await $.fs.exists(path))) continue
    await $.fs.write(path, artifact.content)
  }
  return directory
}

async function executeCodexReview(
  $: EngineInterface,
  state: SessionState,
  trigger: "manual" | "auto",
): Promise<string> {
  const run = state.currentRun
  if (!run) return "No Kev run is available for review. Start a [kev] task first."

  const cwd = await $.session.cwd()
  const model = await $.env.get("KEV_CODEX_MODEL")
  const timeoutMs = parseCodexTimeout(await $.env.get("KEV_CODEX_TIMEOUT_MS"))
  const command = codexReviewCommand(model, timeoutMs)

  try {
    const result = await $.process.run(command.argv, {
      cwd,
      timeoutMs: command.timeoutMs,
    })
    run.reviews.push(codexReviewRecord(trigger, command, result))
  } catch (error) {
    run.reviews.push(codexReviewErrorRecord(trigger, command, error))
  }

  const review = run.reviews[run.reviews.length - 1]
  const written = await persistRun($, state)
  invalidate($)

  if (!review?.succeeded) {
    const detail = review?.error || review?.output || "unknown error"
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
    isEnabled(await $.env.get("KEV_CODEX_AUTO_REVIEW")) &&
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
  const pane: PaneRuntime = { isOpen: false }

  on("session.start", async ($, e, next) => {
    state.decisions.length = 0
    state.currentRun = undefined
    state.nextModelOverride = undefined
    resetOrchestration(state)

    for (const command of [
      { name: "kev", description: "Toggle the Kev Orchestrator pane" },
      {
        name: "kev-review",
        description: "Run an optional Codex review of uncommitted changes",
      },
    ] as const) {
      try {
        await $.command.register(command)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        $.ui.log(`kev: /${command.name} registration skipped: ${message}`, {
          to: "debug",
        })
      }
    }

    $.ui.log("kev-orchestrator: active", { to: "debug" })
    return next(e)
  })

  on("command.run", { command: "kev" }, async ($) => {
    if (pane.isOpen) {
      await $.ui.close({ id: PANE_ID }).catch(() => undefined)
      pane.isOpen = false
      return { text: "Kev Orchestrator pane hidden." }
    }

    await openPane($, pane)
    return {
      text: pane.isOpen
        ? "Kev Orchestrator pane shown."
        : "Kev Orchestrator pane is unavailable on this surface.",
    }
  })

  on("command.run", { command: "kev-review" }, async ($) => ({
    text: await executeCodexReview($, state, "manual"),
  }))

  on("ui.close", { id: PANE_ID }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined) pane.isOpen = false
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
            $.ui.log(`kev: next worker override=${model ?? "auto"}`, {
              to: "debug",
            })
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
    state.currentRun = createRun(crypto.randomUUID(), e.text)
    runEvent(state, { type: "run_started" })

    const rewritten = rewriteKevPrompt(e.text)
    $.ui.log(
      `kev: orchestration enabled; run=${state.currentRun.id}; parent starts in decompose phase`,
      { to: "debug" },
    )

    void openPane($, pane)
    invalidate($)
    return rewritten === undefined ? next(e) : next({ ...e, text: rewritten })
  })

  on("tool.call", { tool: /^(Edit|Write|NotebookEdit)$/ }, ($, e, next) => {
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

  on("tool.call", { tool: "Agent" }, async ($, e, next) => {
    if (!state.active || e.agentId !== undefined) return next(e)

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
    const succeeded = result.deny === undefined && !result.isError && delegated
    const delegatedRecords = state.currentRun?.decisions.slice(beforeDecisionCount) ?? []

    for (const record of delegatedRecords) {
      completeWorkPackage(state.currentRun, record.workPackage.id, succeeded)
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
          ? `completed work packages: ${delegatedRecords.map((record) => record.workPackage.id).join(", ")}`
          : "no spawned work package observed",
    })
    invalidate($)
    return result
  })

  on("agent.spawn", async ($, e, next) => {
    const workPackage = packageFromSpawn(e)
    const config = await resolveKevConfig($)

    let recommended = await askKev($, config, workPackage)
    let recommendationSource: "kev" | "fallback" = "kev"
    if (!recommended) {
      recommended = fallbackDecision(workPackage)
      recommendationSource = "fallback"
    }

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
      recommendedDecision: source === "human_override" ? recommended : undefined,
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
    $.ui.log(
      `kev: ${workPackage.description} -> ${decision.model} (${Math.round(decision.confidence * 100)}%) [${source}]${decision.reason ? ` - ${decision.reason}` : ""}`,
      { to: "debug" },
    )
    invalidate($)
    return result
  })

  on("tool.call", async ($, e, next) => {
    const result = await next(e)
    if (!state.active || e.agentId === undefined) return result

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
        type: observed.isTest ? "worker_test_completed" : "worker_tool_completed",
        actor: "worker",
        agentId: e.agentId,
        workPackageId: observed.workPackageId,
        tool: e.tool,
        outcome: observed.succeeded ? "succeeded" : "failed",
        detail: observed.isTest && command !== undefined ? command.slice(0, 300) : undefined,
      })
      invalidate($)
    }
    return result
  })

  on("turn.complete", async ($, e, next) => {
    const isWorkerTurn =
      "agentId" in e && typeof (e as { agentId?: unknown }).agentId === "string"
    if (state.active && !isWorkerTurn) await finalizeRun($, state)
    invalidate($)
    return next(e)
  })

  on("session.end", async ($, e, next) => {
    if (state.active) await finalizeRun($, state)
    return next(e)
  })
}
