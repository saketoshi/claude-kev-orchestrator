import { describe, expect, test } from "claude-code/testing"

import type { WorkPackage } from "../hooks/domain"
import {
  DEFAULT_RIBBON_BASE_URL,
  applyConfidenceFloor,
  endpointRequest,
  normalizeDecision,
  parseRibbonDecision,
  ribbonRequest,
  safeRibbonToken,
} from "../hooks/kev"

const workPackage: WorkPackage = {
  id: "wp-1",
  description: "Investigate intermittent double billing",
  prompt: "Find the root cause and prove the fix with a regression test.",
  subagentType: "general-purpose",
  parentModel: "opus",
  background: false,
  fork: false,
}

describe("Kev routing", () => {
  test("builds the legacy /decide request", () => {
    const request = endpointRequest("http://127.0.0.1:8787/decide", workPackage)
    const body = JSON.parse(request.body) as Record<string, unknown>
    expect(request.url).toBe("http://127.0.0.1:8787/decide")
    expect(body.kind).toBe("claude.model_fit")
  })

  test("builds Ribbon System One request with revised model criteria", () => {
    const request = ribbonRequest(DEFAULT_RIBBON_BASE_URL, "token", "kev-qwen3.5-4b", workPackage)
    const body = JSON.parse(request.body) as {
      state: string
      questions: { model: { criteria: Record<string, string> } }
    }
    expect(body.state).toContain("Intermittent double billing")
    expect(body.questions.model.criteria.opus).toContain("root-cause investigation")
    expect(body.questions.model.criteria.sonnet).toContain("design is already decided")
  })

  test("truncates worker instructions to 6000 characters", () => {
    const request = ribbonRequest(
      DEFAULT_RIBBON_BASE_URL,
      "token",
      "kev-qwen3.5-4b",
      { ...workPackage, prompt: "x".repeat(7000) },
    )
    const body = JSON.parse(request.body) as { state: string }
    const marker = "Instructions given to the worker:\n"
    expect(body.state.split(marker)[1]?.length).toBe(6000)
  })

  test("parses Ribbon model and split probabilities", () => {
    const decision = parseRibbonDecision({
      answers: {
        model: {
          answer: "opus",
          confidence: 0.42,
          probabilities: { haiku: 0.11, sonnet: 0.26, opus: 0.63 },
        },
        should_split: {
          probabilities: { yes: 0.54, no: 0.46 },
        },
      },
    })
    expect(decision?.model).toBe("opus")
    expect(decision?.confidence).toBe(0.42)
    expect(decision?.shouldSplit).toBe(true)
    expect(decision?.reason).toContain("opus=0.63")
  })

  test("keeps low-confidence routing on inherit", () => {
    const decision = applyConfidenceFloor(
      { model: "haiku", confidence: 0.13, shouldSplit: false },
      0.2,
    )
    expect(decision.model).toBe("inherit")
  })

  test("normalizes the legacy decision response", () => {
    expect(
      normalizeDecision({ model: "sonnet", confidence: 0.7, shouldSplit: false }),
    ).toEqual({
      model: "sonnet",
      confidence: 0.7,
      reason: undefined,
      shouldSplit: false,
    })
  })

  test("reuses the Claude token only for the default Ribbon endpoint", () => {
    expect(safeRibbonToken(DEFAULT_RIBBON_BASE_URL, undefined, "claude-token")).toBe(
      "claude-token",
    )
    expect(
      safeRibbonToken("https://example.invalid/systemone", undefined, "claude-token"),
    ).toBe(undefined)
    expect(
      safeRibbonToken("https://example.invalid/systemone", "explicit", "claude-token"),
    ).toBe("explicit")
  })
})
