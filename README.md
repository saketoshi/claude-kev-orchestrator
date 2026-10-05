# claude-kev-orchestrator

Kev-powered adaptive execution orchestration for Claude Code.

The repository name remains `claude-kev-orchestrator`; the Claude Code plugin name is **`kev-orchestrator`** because Claude Code 2.1.289 reserves plugin names beginning with `claude-`.

This is a **Claude Code Plugin implemented with Mods hooks**. It is not an MCP server, Skill, or Agent definition.

## What it does

For a prompt prefixed with `[kev]`:

1. the parent Claude acts as architect/orchestrator;
2. direct parent `Edit`, `Write`, and `NotebookEdit` are denied until delegation;
3. the parent creates Closed Work Packages and delegates through Agent;
4. `agent.spawn` is intercepted before the worker model resolves;
5. Kev recommends `haiku | sonnet | opus`;
6. low-confidence recommendations stay on `inherit`;
7. workers execute normally and their edits/tests/outcomes are correlated to the Work Package;
8. the parent integrates returned work;
9. the Kev Orchestrator Pane exposes live routing state and one-shot human override;
10. Codex can optionally review current uncommitted changes.

## Claude Code compatibility

v0.4.1 targets the Claude Mods runtime used by Claude Code 2.1.289.

Hook modules intentionally:

- import only relative plugin files and `claude-code` types;
- do not import Node built-ins;
- use `$.http.fetch` instead of global/Node `fetch`;
- use `$.fs` instead of Node filesystem APIs;
- keep `$`-using functions in `hooks/register.ts`;
- use generated plugin types from `.claude-plugin/types`.

## Setup

### Prerequisites

- Claude Code with Mods/plugin support;
- Node.js for development utilities and eval scripts;
- Ribbon access for native Kev routing, or a custom `KEV_ENDPOINT` `/decide` service.

### Install

```bash
git clone https://github.com/saketoshi/claude-kev-orchestrator.git
cd claude-kev-orchestrator
npm install
```

Load once so Claude Code generates `.claude-plugin/types/`, then validate/check:

```bash
claude --plugin-dir .
npm run validate
npm test
npm run check
```

Start normally:

```bash
claude --plugin-dir .
```

## Kev routing

Two transports are supported.

### 1. Native Ribbon / System One — default

No separate `/decide` server is required.

Defaults:

```text
KEV_BASE_URL=https://ai.shofr.wwws.nri.co.jp/api/user/typesafe-proxy/v1/systemone
KEV_MODEL=kev-qwen3.5-4b
KEV_TIMEOUT_MS=5000
KEV_MIN_CONFIDENCE=0.2
```

Authentication precedence:

1. `KEV_API_KEY`, when explicitly set;
2. `ANTHROPIC_AUTH_TOKEN`, but only when using the built-in default Ribbon URL.

The second rule is intentionally restricted: a Claude authentication token is never forwarded automatically to an arbitrary custom `KEV_BASE_URL`.

Optional PowerShell configuration:

```powershell
$env:KEV_MODEL = "kev-qwen3.5-4b"
$env:KEV_TIMEOUT_MS = "5000"
$env:KEV_MIN_CONFIDENCE = "0.2"
```

To use a separate key:

```powershell
$env:KEV_API_KEY = "..."
```

### Ribbon routing question

Kev receives the Work Package description, subagent type, parent model, and worker instructions. Worker instructions are capped at 6000 characters.

The model choice asks for:

> Which is the least expensive Claude model that can reliably complete this coding work package on the first attempt?

Current criteria:

- **Haiku** — small, closed, local change with explicit acceptance criteria;
- **Sonnet** — multi-file implementation where design is already decided and steps are clear;
- **Opus** — deep reasoning, architecture/design decisions, unclear root-cause investigation, concurrency/races, unexplained performance regressions, threat modelling, migrations, or cross-cutting changes.

Kev's per-model probabilities and split probability are preserved in the decision reason for later analysis.

When `confidence < KEV_MIN_CONFIDENCE`, the worker remains on `inherit` rather than forcing a low-confidence cheaper model.

### 2. Custom `/decide` endpoint

Set `KEV_ENDPOINT`; it takes precedence over Ribbon mode.

```bash
export KEV_ENDPOINT=http://127.0.0.1:8787/decide
```

PowerShell:

```powershell
$env:KEV_ENDPOINT = "http://127.0.0.1:8787/decide"
```

The existing mock server remains available:

```bash
node examples/mock-kev-server.mjs
```

## Timeout and fallback

Kev routing uses `$.http.fetch` with a Mods-clock timeout.

- timeout / network error / invalid response -> conservative local fallback policy;
- valid decision below `KEV_MIN_CONFIDENCE` -> `inherit`;
- Ribbon HTTP errors log `x-typesafe-request-id` when supplied.

The current default timeout is 5 seconds. Ribbon cold starts longer than this deliberately fall back rather than blocking the coding task.

## Kev Orchestrator Pane

A `[kev]` task attempts to open the Pane on a supported surface.

Toggle manually:

```text
/kev
```

It shows:

- phase and Run ID;
- recent Work Packages;
- routed model and confidence;
- observed test/outcome state;
- parent execution-contract violations;
- latest Codex review state.

### Human override

The Pane exposes:

```text
[Auto] [Haiku] [Sonnet] [Opus]
```

An override applies to the **next worker spawn only** and then returns to Auto.

The report retains both:

```text
recommendedDecision = Kev/fallback recommendation
decision            = actually selected model
source              = human_override
```

so human corrections become useful evaluation data.

## Optional Codex review

Requires the Codex CLI to be installed/authenticated on a CLI surface.

Manual:

```text
/kev-review
```

or the Pane's `[Codex Review]` button.

The bridge invokes:

```bash
codex exec --ephemeral --color never review --uncommitted
```

Optional settings:

```text
KEV_CODEX_MODEL
KEV_CODEX_TIMEOUT_MS=120000
KEV_CODEX_AUTO_REVIEW=1
```

Automatic review is off by default because it adds external model latency/cost. Review failure never blocks the Kev orchestration path.

## Reports

Each `[kev]` run writes:

```text
.kev/runs/<run-id>/
  run.json
  events.jsonl
  decisions.jsonl
  outcomes.jsonl
  reviews.jsonl
  report.md
  feedback.json
```

The report correlates:

```text
Work Package
 -> Kev recommendation
 -> actual selected model
 -> agentId
 -> worker edits/tools
 -> recognized test commands
 -> test pass/fail
 -> retry/escalation lineage
 -> final observed outcome
 -> optional human feedback/review
```

Override the report root with `KEV_REPORT_DIR`.

`feedback.json` is created once and is not overwritten when the generated report is refreshed.

## Ribbon smoke test

```bash
node --experimental-strip-types examples/kev-ribbon-smoke.mjs "Investigate an intermittent race condition"
```

The script prints elapsed time, request ID, parsed decision, and raw Ribbon response. It never prints the bearer token.

## Routing evaluation

The repository contains an initial upstream evaluation corpus under `eval/` with 32 development cases and 12 holdout cases reconstructed from the reported routing categories.

Run twice per case:

```bash
node --experimental-strip-types eval/run-eval.mjs 2
```

Compare the previous broad model descriptions:

```bash
EVAL_VARIANT=legacy node --experimental-strip-types eval/run-eval.mjs 2
```

Holdout set:

```bash
EVAL_CASES=holdout node --experimental-strip-types eval/run-eval.mjs 2
```

Results are saved to `eval/results/*.json` with model choice, confidence, acceptance at the configured threshold, latency, request ID, and raw response.

The reported external evaluation that motivated the defaults found that a confidence threshold of **0.2** gave the best observed tradeoff: high routing adoption while filtering the cheaper-than-expected misses in that sample. Treat this as a regression baseline, not universal ground truth.

Longer term, `outcomes.jsonl` should become more authoritative than hand-labelled expected models: the useful question is whether a cheaper worker actually completed the package successfully without retry/escalation or integrator repair.

## Project structure

```text
.claude-plugin/plugin.json   plugin metadata (`kev-orchestrator`)
hooks/register.ts            all Mods engine `$` interactions
hooks/kev.ts                 pure request/response routing logic
hooks/pane.tsx               live Pane + human override UI
hooks/reporter.ts            pure report artifact generation
hooks/reviewer.ts            pure Codex command/result helpers
hooks/observer.ts            Work Package outcome correlation
hooks/state-machine.ts       execution-state enforcement
examples/mock-kev-server.mjs custom endpoint mock
examples/kev-ribbon-smoke.mjs Ribbon smoke test
tests/kev.test.ts            routing unit tests
eval/                        routing regression corpus/runner
```

## Known limitations

- split probability is recorded but is not yet trusted enough to drive decomposition automatically;
- retry lineage is still inferred from normalized Work Package descriptions;
- parent mutation through arbitrary Bash commands is not blocked;
- Codex bridge uses `process.run`, which is CLI-only in the Mods API;
- parallel-worker state still needs deeper validation.

## Current direction

Kev is not intended to out-code Claude. Its target role is an execution-policy controller:

```text
hard eligibility / package-shape signals
 -> probability of success by model
 -> cheapest eligible model above quality threshold
 -> runtime outcome observation
 -> retry / split / escalation / human correction
```

See `docs/design-v0.4.md` and `docs/router-research-v0.1.md` for the broader architecture and comparison notes.
