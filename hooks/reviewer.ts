import type { EngineInterface } from "claude-code"

import type { ReviewRecord, RunObservation } from "./domain"

const DEFAULT_TIMEOUT_MS = 120_000

function parseTimeout(raw: string | undefined): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS
  return Math.min(parsed, 600_000)
}

function isEnabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true"
}

export async function shouldAutoReview($: EngineInterface): Promise<boolean> {
  return isEnabled(await $.env.get("KEV_CODEX_AUTO_REVIEW"))
}

export async function runCodexReview(
  $: EngineInterface,
  run: RunObservation | undefined,
  trigger: ReviewRecord["trigger"],
): Promise<ReviewRecord> {
  const cwd = await $.session.cwd()
  const timeoutMs = parseTimeout(await $.env.get("KEV_CODEX_TIMEOUT_MS"))
  const model = await $.env.get("KEV_CODEX_MODEL")

  const argv = ["codex", "exec", "--ephemeral", "--color", "never"]
  if (model) argv.push("--model", model)
  argv.push("review", "--uncommitted")

  const at = Date.now()

  try {
    const result = await $.process.run(argv, { cwd, timeoutMs })
    const output = [result.stdout, result.stderr]
      .filter((value) => value.trim().length > 0)
      .join("\n")
      .trim()

    const record: ReviewRecord = {
      at,
      reviewer: "codex",
      trigger,
      model: model || undefined,
      exitCode: result.exitCode,
      succeeded: result.exitCode === 0,
      output,
      error: result.exitCode === 0 ? undefined : result.stderr.trim() || undefined,
    }

    run?.reviews.push(record)
    return record
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const record: ReviewRecord = {
      at,
      reviewer: "codex",
      trigger,
      model: model || undefined,
      succeeded: false,
      output: "",
      error: message,
    }

    run?.reviews.push(record)
    return record
  }
}
