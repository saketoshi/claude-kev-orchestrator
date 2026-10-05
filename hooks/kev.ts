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
    if (numeric !== undefined) output[key] = numeric
  }
  return output
}

function answerNode(root: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const direct = recordOf(root[key])
  if (direct) return direct

  for (const containerName of ["answers", "questions", "results", "output"]) {
    const container = recordOf(root[containerName])
    const nested = container ? recordOf(container[key]) : undefined
    if (nested) return nested
  }
  return undefined
}

function choiceOf(node: Record<string, unknown> | undefined): string | undefined {
  if (!node) return undefined
  for (const key of ["answer", "choice", "value", "result"]) {
    const value = stringOf(node[key])
    if (value) return value.toLowerCase()
  }
  return undefined
}

function confidenceOf(node: Record<string, unknown> | undefined): number {
  if (!node) return 0
  for (const key of ["confidence", "score", "probability"]) {
    const value = numberOf(node[key])
    if (value !== undefined) return value
  }
  return 0
}

function probabilitiesOf(node: Record<string, unknown> | undefined): Record<string, number> {
  if (!node) return {}
  for (const key of ["probabilities", "scores", "distribution"]) {
    const result = distributionOf(node[key])
    if (Object.keys(result).length > 0) return result
  }

  const direct = distributionOf(node)
  for (const metadata of ["confidence", "score", "probability"]) delete direct[metadata]
  return direct
}

function yesProbabilityOf(node: Record<string, unknown> | undefined): number {
  if (!node) return 0
  const probabilities = probabilitiesOf(node)
  for (const key of ["yes", "true", "1"]) {
    const value = probabilities[key]
    if (value !== undefined) return value
  }

  const answer = node.answer
  if (typeof answer === "boolean") return answer ? confidenceOf(node) : 1 - confidenceOf(node)
  return numberOf(node.probability) ?? 0
}

function probabilityReason(modelProbabilities: Record<string, number>, split: number): string {
  const parts = ["haiku", "sonnet", "opus"].map(
    (model) => `${model}=${(modelProbabilities[model] ?? 0).toFixed(2)}`,
  )
  parts.push(`split=${split.toFixed(2)}`)
  return `Kev: ${parts.join(" ")}`
}

export function normalizeDecision(value: unknown): ModelDecision | undefined {
  const input = recordOf(value)
  if (!input || typeof input.model !== "string" || !ALLOWED.has(input.model as ModelAlias)) {
    return undefined
  }

  const confidence = numberOf(input.confidence) ?? 0
  return {
    model: input.model as ModelAlias,
    confidence,
    reason: stringOf(input.reason),
    shouldSplit: typeof input.shouldSplit === "boolean" ? input.shouldSplit : false,
  }
}

export function applyConfidenceFloor(
  decision: ModelDecision,
  minConfidence: number,
): ModelDecision {
  if (decision.confidence >= minConfidence || decision.model === "inherit") return decision
  return {
    ...decision,
    model: "inherit",
    reason: `${decision.reason ? `${decision.reason}; ` : ""}confidence ${decision.confidence.toFixed(2)} < ${minConfidence.toFixed(2)}; inherit parent model`,
  }
}

export function endpointRequest(endpoint: string, workPackage: WorkPackage): KevHttpRequest {
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

  const modelNode = answerNode(root, "model")
  const model = choiceOf(modelNode)
  if (!model || !ROUTABLE.has(model as ModelAlias)) return undefined

  const modelProbabilities = probabilitiesOf(modelNode)
  const splitNode = answerNode(root, "should_split") ?? answerNode(root, "shouldSplit")
  const splitProbability = yesProbabilityOf(splitNode)

  return {
    model: model as ModelAlias,
    confidence: confidenceOf(modelNode),
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
