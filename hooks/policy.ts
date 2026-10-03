import type { ModelDecision, WorkPackage } from "./domain"

/**
 * Conservative fallback only. Kev is the intended decision maker.
 *
 * The fallback deliberately avoids "smart" code classification. It only
 * recognizes obviously small/local packages; everything else inherits the
 * model Claude Code would otherwise resolve.
 */
export function fallbackDecision(work: WorkPackage): ModelDecision {
  const text = `${work.description}\n${work.prompt}`.toLowerCase()

  const architectureSignals = [
    "architect",
    "architecture",
    "design",
    "migration",
    "public api",
    "schema",
    "cross-cutting",
    "trade-off",
    "tradeoff",
  ]

  if (architectureSignals.some((signal) => text.includes(signal))) {
    return {
      model: "opus",
      confidence: 0.55,
      reason: "Fallback detected an architecture/contract signal.",
      shouldSplit: false,
    }
  }

  const smallTaskSignals = [
    "single function",
    "one function",
    "add test",
    "write test",
    "rename",
    "format",
    "getter",
    "setter",
    "mapper",
    "converter",
    "validator",
  ]

  const isShort = work.prompt.length < 900
  const looksClosed = smallTaskSignals.some((signal) => text.includes(signal))

  if (isShort && looksClosed) {
    return {
      model: "haiku",
      confidence: 0.5,
      reason: "Fallback detected a short, likely closed implementation unit.",
      shouldSplit: false,
    }
  }

  return {
    model: "inherit",
    confidence: 0,
    reason: "Kev unavailable; preserve Claude Code model resolution.",
    shouldSplit: false,
  }
}
