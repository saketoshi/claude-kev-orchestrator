import type { ModelAlias, ModelDecision, WorkPackage } from "./domain"

export const DEFAULT_RIBBON_BASE_URL =
  "https://ai.shofr.wwws.nri.co.jp/api/user/typesafe-proxy/v1/systemone"
export const DEFAULT_RIBBON_MODEL = "kev-qwen3.5-4b"
export const DEFAULT_TIMEOUT_MS = 5000
export const DEFAULT_MIN_CONFIDENCE = 0.2

const ALLOWED = new Set<ModelAlias>(["haiku", "sonnet", "opus", "inherit"])
const ROUTABLE = new Set<ModelAlias>(["haiku", "sonnet", "opus"])

export interface KevHttpRequest {
  url: string
  method: "POST"
  headers: Record<string, string>
  body: string
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : undefined
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function distributionOf(value: unknown): Record<string, number> {
  const input = recordOf(value)
  if (!input) return {}
  const output: Record<string, number> = {}
  for (const [key, raw] of Object.entries(input)) {
    const numeric = numberOf(raw)
    if (numeric !== undefined) output[key.toLowerCase()] = numeric
  }
  return output
}

function answerValue(root: Record<string, unknown>, key: string): unknown {
  if (root[key] !== undefined) return root[key]
  for (const containerName of ["answers", "questions", "results", "output", "data"]) {
    const container = recordOf(root[containerName])
    if (container?.[key] !== undefined) return container[key]
  }
  return undefined
}

function choiceOf(value: unknown): string | undefined {
  const direct = stringOf(value)
  if (direct) return direct.toLowerCase()

  const node = recordOf(value)
  if (!node) return undefined
  for (const key of ["answer", "choice", "value", "result", "selected", "label"]) {
    const answer = stringOf(node[key])
    if (answer) return answer.toLowerCase()
  }
  return undefined
}

function confidenceOf(value: unknown, root?: Record<string, unknown>): number {
  const direct = numberOf(value)
  if (direct !== undefined) return direct

  const node = recordOf(value)
  if (node) {
    for (const key of ["confidence", "score", "probability"]) {
      const numeric = numberOf(node[key])
      if (numeric !== undefined) return numeric
    }
  }

  if (root) {
    for (const key of ["confidence", "model_confidence", "modelConfidence"]) {
      const numeric = numberOf(root[key])
      if (numeric !== undefined) return numeric
    }
  }
  return 0
}

function probabilitiesOf(value: unknown, root?: Record<string, unknown>): Record<string, number> {
  const node = recordOf(value)
  if (node) {
    for (const key of ["probabilities", "scores", "distribution"]) {
      const result = distributionOf(node[key])
      if (Object.keys(result).length > 0) return result
    }

    const direct = distributionOf(node)
    for (const metadata of [
      "confidence",
      "score",
      "probability",
      "answer",
      "choice",
      "value",
      "result",
      "selected",
      "label",
    ]) {
      delete direct[metadata]
    }
    if (Object.keys(direct).length > 0) return direct
  }

  if (root) {
    for (const key of ["model_probabilities", "modelProbabilities", "probabilities"]) {
      const result = distributionOf(root[key])
      if (Object.keys(result).length > 0) return result
    }
  }
  return {}
}

function yesProbabilityOf(value: unknown): number {
  const numeric = numberOf(value)
  if (numeric !== undefined) return numeric

  const node = recordOf(value)
  if (!node) return 0

  const probabilities = probabilitiesOf(node)
  for (const key of ["yes", "true", "1"]) {
    const probability = probabilities[key]
    if (probability !== undefined) return probability
  }

  if (typeof node.answer === "boolean") {
    const confidence = confidenceOf(node)
    return node.answer ? confidence : 1 - confidence
  }

  return numberOf(node.probability) ?? numberOf(node.score) ?? 0
}

function probabilityReason(
  modelProbabilities: Record<string, number>,
  splitProbability: number,
): string {
  const parts = ["haiku", "sonnet", "opus"].map(
    (model) => `${model}=${(modelProbabilities[model] ?? 0).toFixed(2)}`,
  )
  parts.push(`split=${splitProbability.toFixed(2)}`)
  return `Kev: ${parts.join(" ")}`
}

export function normalizeDecision(value: unknown): ModelDecision | undefined {
  const input = recordOf(value)
  if (
    !input ||
    typeof input.model !== "string" ||
    !ALLOWED.has(input.model as ModelAlias)
  ) {
    return undefined
  }

  const confidence = numberOf(input.confidence) ?? 0
  return {
    model: input.model as ModelAlias,
    confidence,
    reason: stringOf(input.reason),
    shouldSplit:
      typeof input.shouldSplit === "boolean" ? input.shouldSplit : false,
  }
}

export function applyConfidenceFloor(
  decision: ModelDecision,
  minConfidence: number,
): ModelDecision {
  if (
    decision.confidence >= minConfidence ||
    decision.model === "inherit"
  ) {
    return decision
  }

  return {
    ...decision,
    model: "inherit",
    reason: `${decision.reason ? `${decision.reason}; ` : ""}confidence ${decision.confidence.toFixed(2)} < ${minConfidence.toFixed(2)}; inherit parent model`,
  }
}

export function endpointRequest(
  endpoint: string,
  workPackage: WorkPackage,
): KevHttpRequest {
  return {
    url: endpoint,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "claude.model_fit",
      workPackage,
      allowedModels: ["haiku", "sonnet", "opus", "inherit"],
    }),
  }
}

export function ribbonRequest(
  baseUrl: string,
  apiKey: string,
  model: string,
  workPackage: WorkPackage,
): KevHttpRequest {
  const state = [
    `Work package: ${workPackage.description}`,
    `Subagent type: ${workPackage.subagentType}`,
    `Parent model: ${workPackage.parentModel}`,
    "",
    "Instructions given to the worker:",
    workPackage.prompt.slice(0, 6000),
  ].join("\n")

  return {
    url: baseUrl,
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      state,
      questions: {
        model: {
          type: "choice",
          instructions:
            "Which is the least expensive Claude model that can reliably complete this coding work package on the first attempt?",
          criteria: {
            haiku:
              "Small, closed, local change with explicit acceptance criteria (single function, test, rename, mapper, validator).",
            sonnet:
              "Implementation across several files where the design is already decided and the steps are clear.",
            opus:
              "Needs deep reasoning: architecture or design decisions, root-cause investigation of intermittent or unclear bugs, concurrency or race conditions, performance regressions with unknown cause, security threat modelling, migrations, cross-cutting changes.",
          },
        },
        should_split: {
          type: "noul",
          instructions:
            "Is this work package too large or mixed, so it should be split into smaller independent packages before delegation?",
        },
      },
    }),
  }
}

export function parseRibbonDecision(value: unknown): ModelDecision | undefined {
  const root = recordOf(value)
  if (!root) return undefined

  const modelValue = answerValue(root, "model")
  const model = choiceOf(modelValue)
  if (!model || !ROUTABLE.has(model as ModelAlias)) return undefined

  const confidence = confidenceOf(modelValue, root)
  const modelProbabilities = probabilitiesOf(modelValue, root)
  const splitValue =
    answerValue(root, "should_split") ?? answerValue(root, "shouldSplit")
  const splitProbability = yesProbabilityOf(splitValue)

  return {
    model: model as ModelAlias,
    confidence,
    shouldSplit: splitProbability >= 0.5,
    reason: probabilityReason(modelProbabilities, splitProbability),
  }
}

export function safeRibbonToken(
  baseUrl: string,
  explicitKey: string | undefined,
  anthropicToken: string | undefined,
): string | undefined {
  if (explicitKey) return explicitKey
  return baseUrl === DEFAULT_RIBBON_BASE_URL ? anthropicToken : undefined
}
