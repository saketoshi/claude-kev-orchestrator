import type { ReviewRecord } from "./domain"

export const DEFAULT_CODEX_TIMEOUT_MS = 120_000

export interface CodexReviewCommand {
  argv: string[]
  timeoutMs: number
  model?: string
}

export function parseCodexTimeout(raw: string | undefined): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CODEX_TIMEOUT_MS
  return Math.min(parsed, 600_000)
}

export function isEnabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true"
}

export function codexReviewCommand(
  model: string | undefined,
  timeoutMs: number,
): CodexReviewCommand {
  const argv = ["codex", "exec", "--ephemeral", "--color", "never"]
  if (model) argv.push("--model", model)
  argv.push("review", "--uncommitted")
  return { argv, timeoutMs, model }
}

export function codexReviewRecord(
  trigger: ReviewRecord["trigger"],
  command: CodexReviewCommand,
  result: { exitCode: number; stdout: string; stderr: string },
  at = Date.now(),
): ReviewRecord {
  const output = [result.stdout, result.stderr]
    .filter((value) => value.trim().length > 0)
    .join("\n")
    .trim()

  return {
    at,
    reviewer: "codex",
    trigger,
    model: command.model,
    exitCode: result.exitCode,
    succeeded: result.exitCode === 0,
    output,
    error: result.exitCode === 0 ? undefined : result.stderr.trim() || undefined,
  }
}

export function codexReviewErrorRecord(
  trigger: ReviewRecord["trigger"],
  command: CodexReviewCommand,
  error: unknown,
  at = Date.now(),
): ReviewRecord {
  return {
    at,
    reviewer: "codex",
    trigger,
    model: command.model,
    succeeded: false,
    output: "",
    error: error instanceof Error ? error.message : String(error),
  }
}
