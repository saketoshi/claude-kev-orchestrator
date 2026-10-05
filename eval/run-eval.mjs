import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import {
  DEFAULT_MIN_CONFIDENCE,
  DEFAULT_RIBBON_BASE_URL,
  DEFAULT_RIBBON_MODEL,
  applyConfidenceFloor,
  parseRibbonDecision,
  ribbonRequest,
} from "../hooks/kev.ts"
import { casesFor } from "./cases.mjs"

const repeats = Math.max(1, Number(process.argv[2] || 1))
const variant = process.env.EVAL_VARIANT || "current"
const caseSet = process.env.EVAL_CASES || "development"
const apiKey = process.env.KEV_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
const baseUrl = process.env.KEV_BASE_URL || DEFAULT_RIBBON_BASE_URL
const model = process.env.KEV_MODEL || DEFAULT_RIBBON_MODEL
const minConfidence = Number(process.env.KEV_MIN_CONFIDENCE || DEFAULT_MIN_CONFIDENCE)

if (!apiKey) {
  console.error("Set KEV_API_KEY or ANTHROPIC_AUTH_TOKEN.")
  process.exit(2)
}

const legacyCriteria = {
  haiku: "Small, closed, local implementation with explicit acceptance criteria.",
  sonnet: "Implementation or debugging across several files with moderate reasoning.",
  opus: "Architecture, design, cross-cutting or ambiguous work requiring deep reasoning.",
}

const rank = { haiku: 1, sonnet: 2, opus: 3, inherit: 4 }
const results = []

for (const testCase of casesFor(caseSet)) {
  for (let attempt = 1; attempt <= repeats; attempt += 1) {
    const request = ribbonRequest(baseUrl, apiKey, model, {
      id: `${testCase.id}-${attempt}`,
      description: testCase.description,
      prompt: testCase.description,
      subagentType: "general-purpose",
      parentModel: "sonnet",
      background: false,
      fork: false,
    })

    if (variant === "legacy") {
      const body = JSON.parse(request.body)
      body.questions.model.criteria = legacyCriteria
      request.body = JSON.stringify(body)
    }

    const started = performance.now()
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    })
    const elapsedMs = Math.round(performance.now() - started)
    const requestId = response.headers.get("x-typesafe-request-id")
    const text = await response.text()

    let raw
    try {
      raw = JSON.parse(text)
    } catch {
      raw = { rawText: text }
    }

    const rawDecision = response.ok ? parseRibbonDecision(raw) : undefined
    const acceptedDecision = rawDecision
      ? applyConfidenceFloor(rawDecision, minConfidence)
      : undefined
    const selected = rawDecision?.model
    const accepted = acceptedDecision?.model !== "inherit"
    const expected = testCase.expectedModel
    const delta = selected && rank[selected] && rank[expected]
      ? rank[selected] - rank[expected]
      : undefined

    results.push({
      id: testCase.id,
      attempt,
      variant,
      caseSet,
      description: testCase.description,
      expectedModel: expected,
      expectedSplit: Boolean(testCase.expectedSplit),
      httpStatus: response.status,
      requestId,
      elapsedMs,
      decision: rawDecision,
      acceptedDecision,
      accepted,
      match: selected === expected,
      cheaperMiss: typeof delta === "number" && delta < 0,
      expensiveMiss: typeof delta === "number" && delta > 0,
      raw,
    })

    console.log(
      `${testCase.id} #${attempt}: expected=${expected} selected=${selected ?? "error"} confidence=${rawDecision?.confidence?.toFixed(2) ?? "-"} accepted=${accepted}`,
    )
  }
}

const valid = results.filter((item) => item.decision)
const accepted = valid.filter((item) => item.accepted)
const summary = {
  variant,
  caseSet,
  repeats,
  total: results.length,
  valid: valid.length,
  matchRate: valid.length
    ? valid.filter((item) => item.match).length / valid.length
    : 0,
  cheaperMisses: valid.filter((item) => item.cheaperMiss).length,
  expensiveMisses: valid.filter((item) => item.expensiveMiss).length,
  accepted: accepted.length,
  acceptedRate: valid.length ? accepted.length / valid.length : 0,
  acceptedMatchRate: accepted.length
    ? accepted.filter((item) => item.match).length / accepted.length
    : 0,
  acceptedCheaperMisses: accepted.filter((item) => item.cheaperMiss).length,
  acceptedExpensiveMisses: accepted.filter((item) => item.expensiveMiss).length,
}

console.log(JSON.stringify(summary, null, 2))

await mkdir(join("eval", "results"), { recursive: true })
const stamp = new Date().toISOString().replaceAll(":", "-")
await writeFile(
  join("eval", "results", `${stamp}-${caseSet}-${variant}.json`),
  JSON.stringify({ summary, results }, null, 2) + "\n",
  "utf8",
)
