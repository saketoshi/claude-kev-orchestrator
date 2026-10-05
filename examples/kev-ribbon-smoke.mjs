import {
  DEFAULT_RIBBON_BASE_URL,
  DEFAULT_RIBBON_MODEL,
  parseRibbonDecision,
  ribbonRequest,
} from "../hooks/kev.ts"

const task = process.argv.slice(2).join(" ") || "Rename one local validator and update its unit test."
const apiKey = process.env.KEV_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
const baseUrl = process.env.KEV_BASE_URL || DEFAULT_RIBBON_BASE_URL
const model = process.env.KEV_MODEL || DEFAULT_RIBBON_MODEL

if (!apiKey) {
  console.error("Set KEV_API_KEY or ANTHROPIC_AUTH_TOKEN.")
  process.exit(2)
}

const request = ribbonRequest(baseUrl, apiKey, model, {
  id: "smoke",
  description: task,
  prompt: task,
  subagentType: "general-purpose",
  parentModel: "sonnet",
  background: false,
  fork: false,
})

const started = performance.now()
const response = await fetch(request.url, {
  method: request.method,
  headers: request.headers,
  body: request.body,
})
const elapsedMs = Math.round(performance.now() - started)
const requestId = response.headers.get("x-typesafe-request-id")
const text = await response.text()

if (!response.ok) {
  console.error(`HTTP ${response.status}${requestId ? ` request-id=${requestId}` : ""}`)
  console.error(text)
  process.exit(1)
}

let json
try {
  json = JSON.parse(text)
} catch {
  console.error("Ribbon response was not JSON:")
  console.error(text)
  process.exit(1)
}

const decision = parseRibbonDecision(json)
console.log(JSON.stringify({ elapsedMs, requestId, decision, raw: json }, null, 2))
