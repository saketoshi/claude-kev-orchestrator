import type { ModelAlias, ModelDecision, WorkPackage } from "./domain"

const ALLOWED = new Set<ModelAlias>(["haiku", "sonnet", "opus", "inherit"])

function normalizeDecision(value: unknown): ModelDecision | undefined {
  if (typeof value !== "object" || value === null) return undefined

  const input = value as Record<string, unknown>
  if (typeof input.model !== "string" || !ALLOWED.has(input.model as ModelAlias)) {
    return undefined
  }

  const confidence =
    typeof input.confidence === "number" && Number.isFinite(input.confidence)
      ? Math.max(0, Math.min(1, input.confidence))
      : 0

  return {
    model: input.model as ModelAlias,
    confidence,
    reason: typeof input.reason === "string" ? input.reason : undefined,
    shouldSplit: typeof input.shouldSplit === "boolean" ? input.shouldSplit : false,
  }
}

export async function askKev(
  endpoint: string,
  timeoutMs: number,
  workPackage: WorkPackage,
): Promise<ModelDecision | undefined> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "claude.model_fit",
        workPackage,
        allowedModels: ["haiku", "sonnet", "opus", "inherit"],
      }),
      signal: controller.signal,
    })

    if (!response.ok) return undefined
    return normalizeDecision(await response.json())
  } catch {
    return undefined
  } finally {
    clearTimeout(timeout)
  }
}
