# claude-kev-orchestrator

Kev-powered adaptive execution orchestration for Claude Code.

This is a **Claude Code Plugin implemented with Mods hooks**. It is not an MCP server, Skill, or Agent definition.

The project explores a concrete coding workflow:

> Use stronger Claude models for architecture and decomposition, enforce delegation at runtime, then use Kev (Qwen-backed) to choose the least-expensive Claude model that is suitable for each closed work package.

## What it does now

When a prompt starts with `[kev]`:

1. the parent Claude becomes the architect/orchestrator;
2. the runtime enters a decomposition state;
3. if the parent tries to `Edit`, `Write`, or `NotebookEdit` before delegation, the Mod denies the action;
4. the parent must delegate implementation through the Agent tool;
5. `agent.spawn` is intercepted before its model is resolved;
6. Kev selects `haiku | sonnet | opus | inherit`;
7. worker execution proceeds normally;
8. when delegated Agent work returns, the parent enters integration and may edit directly;
9. the Kev Orchestrator Pane shows live phase/routing/outcome state;
10. a human can override the next worker model;
11. Codex can optionally review the current uncommitted changes.

So this is intentionally more than a model router: it also protects the execution strategy from being forgotten by the parent model.

See [docs/design-v0.4.md](docs/design-v0.4.md) for the detailed design.

## Runtime flow

```text
[kev] user task
      |
      v
Parent Claude
architect / decompose
      |
      | direct Edit/Write?
      |----> denied until delegation
      |
      | Agent tool
      v
agent.spawn
      |
      v
Kev / Qwen
      |
      v
haiku | sonnet | opus | inherit
      |
      v
Worker Claude
      |
      v
Parent integration / verification
```

## Setup

### Prerequisites

You need:

- a recent Claude Code version that supports Mods/plugins;
- Node.js 20+ (for the included mock Kev server);
- a local or reachable Kev/Qwen decision service for real routing.

Claude Code Mods are early access, so the exact Plugin/Mods API can change.

### 1. Clone the repository

```bash
git clone https://github.com/saketoshi/claude-kev-orchestrator.git
cd claude-kev-orchestrator
```

If testing the current development branch before it is merged:

```bash
git checkout feat/kev-orchestrator-poc
```

### 2. Configure Kev

The Mod expects a small HTTP decision endpoint.

```bash
export KEV_ENDPOINT=http://127.0.0.1:8787/decide
export KEV_TIMEOUT_MS=1500
```

On PowerShell:

```powershell
$env:KEV_ENDPOINT = "http://127.0.0.1:8787/decide"
$env:KEV_TIMEOUT_MS = "1500"
```

Kev receives a work package and returns a model-fit decision:

```json
{
  "model": "haiku",
  "confidence": 0.91,
  "reason": "Closed local implementation with explicit acceptance criteria",
  "shouldSplit": false
}
```

Allowed model values:

- `haiku`
- `sonnet`
- `opus`
- `inherit`

If Kev is unavailable or returns an invalid response, model routing falls back conservatively. The execution-state rule itself remains active.

### 3. Smoke-test without Qwen/Kev

A mock Kev server is included:

```bash
node examples/mock-kev-server.mjs
```

It listens on:

```text
http://127.0.0.1:8787/decide
```

Use this first to verify the Claude Code interception flow before connecting the real Kev implementation.

### 4. Install development dependencies

```bash
npm install
```

Claude Code Mod TypeScript imports its runtime declarations from the generated `claude-code` types. For local type-checking, generate/update plugin types with Claude Code's `/plugin-types` workflow for your installed version, then run:

```bash
npm run check
```

You can also use Claude Code's plugin test runner as tests are added:

```bash
claude plugin test .
```

### 5. Start Claude Code with the Plugin

From this repository:

```bash
claude --plugin-dir .
```

Claude Code loads:

```text
.claude-plugin/plugin.json
hooks/hooks.json
hooks/register.ts
```

### 6. Enable orchestration for a task

Prefix the task with `[kev]`:

```text
[kev] Implement the user profile feature. Decide the architecture first, split implementation into closed work packages, delegate them, then integrate and verify.
```

The marker is removed before Claude sees the final user prompt. The Mod adds the execution contract automatically.

A prompt without `[kev]` runs normally and disables this orchestration state for that turn.

### 7. What to observe

Run Claude Code with debug output available and verify:

- the parent does not implement immediately;
- an attempted parent `Edit/Write/NotebookEdit` before delegation is denied;
- the parent invokes the Agent tool;
- each `agent.spawn` gets a Kev model decision;
- worker edits are not blocked;
- parent edits are allowed after delegated work returns.


## Kev Orchestrator Pane

The Plugin provides a Mods Pane for supported terminal/desktop surfaces.

It opens automatically when a `[kev]` task starts. Toggle it manually with:

```text
/kev
```

The pane shows:

- current execution phase and run ID;
- recent Work Packages;
- routed model and confidence;
- human override as `recommended→selected`;
- observed outcome/test counts;
- delegated package count;
- execution-contract violations;
- latest Codex review status.

### Human model override

The pane exposes:

```text
[Auto] [Haiku] [Sonnet] [Opus]
```

This is a **one-shot override** for the next worker spawn.

Example:

```text
Kev recommends: Haiku
Human selects: Sonnet
Actual worker: Sonnet
Next worker: Auto
```

The report preserves both the Kev recommendation and human-selected model with:

```text
source = human_override
recommendedDecision = ...
decision = ...
```

This makes human corrections usable as future routing feedback instead of silently replacing the Kev decision.

## Optional Codex review

The Plugin can call the official Codex CLI review flow as an external reviewer.

Prerequisites:

- `codex` CLI installed and authenticated;
- the current working directory is a Git repository;
- the user accepts that the repository diff/code required for review is sent to the configured OpenAI/Codex service.

Run manually from Claude Code:

```text
/kev-review
```

or press:

```text
[Codex Review]
```

in the Kev Orchestrator Pane.

The bridge runs the equivalent of:

```bash
codex exec --ephemeral --color never review --uncommitted
```

The review result is recorded in:

```text
reviews.jsonl
run.json
report.md
```

Optional settings:

```bash
export KEV_CODEX_MODEL=<codex-model>
export KEV_CODEX_TIMEOUT_MS=120000
```

PowerShell:

```powershell
$env:KEV_CODEX_MODEL = "<codex-model>"
$env:KEV_CODEX_TIMEOUT_MS = "120000"
```

Automatic review is **off by default** because it invokes an external model and may add latency/cost.

To explicitly enable automatic review at run completion:

```bash
export KEV_CODEX_AUTO_REVIEW=1
```

PowerShell:

```powershell
$env:KEV_CODEX_AUTO_REVIEW = "1"
```

If the Codex executable is missing, authentication fails, the review times out, or Codex exits non-zero, the failure is recorded but the Kev orchestration flow is not blocked.


## Run reports and feedback

Each `[kev]` orchestration turn gets a run ID. At turn completion (and as a fallback on session end), the Plugin writes:

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

The default report root is `.kev/runs` under the Claude Code working directory.

Override it with:

```bash
export KEV_REPORT_DIR=/path/to/kev-reports
```

PowerShell:

```powershell
$env:KEV_REPORT_DIR = "C:\path\to\kev-reports"
```

### What is recorded

The report currently captures:

- the original `[kev]` task;
- execution phase;
- each Work Package;
- selected model;
- Kev recommendation separately when a human overrides it;
- decision source (`kev`, `fallback`, or `human_override`);
- Kev confidence/reason;
- whether `shouldSplit` was returned;
- Kev vs fallback decision source;
- spawned agent ID when available;
- parent `Edit/Write/NotebookEdit` violations;
- Agent tool start/completion;
- worker Edit/Write/NotebookEdit counts;
- recognized worker test commands and pass/fail;
- non-test worker tool failures;
- whether delegated execution succeeded at the orchestration boundary;
- retry lineage inferred from repeated Work Package descriptions;
- inferred Haiku -> Sonnet -> Opus escalation;
- optional Codex review results;
- final phase and run timing.

`report.md` is the human-readable review artifact.

`run.json`, `events.jsonl`, `decisions.jsonl`, `outcomes.jsonl`, and `reviews.jsonl` are intended for later analysis and Kev policy training/evaluation.

A Work Package ID is carried from `agent.spawn` to the spawned `agentId`, then used to attribute worker edits, tests and failures back to that package. Retries across newly spawned agents are grouped heuristically by normalized Work Package description into a lineage. This is useful evidence, but is explicitly an inference until a later version introduces parent-issued stable lineage IDs.

### Human feedback

`feedback.json` is created as:

```json
{
  "runId": "<run-id>",
  "overall": null,
  "problematicWorkPackages": [],
  "comments": "",
  "suggestedPolicyChanges": []
}
```

After reviewing `report.md`, edit this file to capture where routing or orchestration felt wrong.

The important learning unit is:

```text
Kev prediction
+ runtime execution events
+ actual outcome
+ human feedback
```

This is intentionally collected before adding more adaptive policy so future changes can be evaluated against real run history.


## Kev HTTP contract

Request:

```json
{
  "kind": "claude.model_fit",
  "workPackage": {
    "id": "agent-tool-use-id",
    "prompt": "...",
    "description": "...",
    "subagentType": "general-purpose",
    "parentModel": "opus",
    "background": false,
    "fork": false
  },
  "allowedModels": ["haiku", "sonnet", "opus", "inherit"]
}
```

Response:

```json
{
  "model": "haiku",
  "confidence": 0.91,
  "reason": "Closed local implementation with explicit acceptance criteria",
  "shouldSplit": false
}
```

## Project structure

```text
.claude-plugin/plugin.json   Claude Code Plugin metadata
hooks/hooks.json             Mods hook-module registration
hooks/register.ts            Claude Code runtime interception
hooks/state-machine.ts       execution-state enforcement
hooks/domain.ts              Work Package / Decision / State types
hooks/kev.ts                 Kev HTTP client
hooks/policy.ts              conservative fallback model policy
hooks/prompt.ts              [kev] opt-in + parent execution contract
hooks/pane.tsx                live Mods pane + human override controls
hooks/reviewer.ts             optional Codex CLI review bridge
examples/mock-kev-server.mjs mock decision service
docs/design-v0.4.md          architecture and roadmap
docs/router-research-v0.1.md routing/evaluation research
```

## Current safety/flexibility boundary

The parent restriction intentionally applies only when:

- the user explicitly enabled `[kev]`;
- the tool call comes from the main parent loop;
- the runtime is still in decomposition/delegation/worker execution;
- the tool is `Edit`, `Write`, or `NotebookEdit`.

Subagent editing is allowed.

After Agent work returns, the parent enters integration and may edit.

Arbitrary file mutation through `Bash` is not blocked in the current PoC; that is a known next-step if stricter enforcement proves useful.

## Why Kev

Kev does not need to be better than Opus/Sonnet at coding.

Its job is execution policy:

- Is this work package closed enough for Haiku?
- Does it need Sonnet integration ability?
- Is this actually an architecture problem for Opus?
- Should this package be split further?
- Later: should a failure retry, split, escalate, or return to the parent?

Clear deterministic rules remain in the state machine; ambiguous decisions are where Kev should add value.

## Next experiments

The next implementation steps are:

1. wire `shouldSplit` back into parent decomposition;
2. enter an explicit verification phase from observed tests/tool outcomes;
3. use the newly captured outcome data for outcome-aware routing/escalation;
4. add token/cost capture when Claude Code exposes stable accounting fields;
5. build a controlled Haiku/Sonnet/Opus evaluation matrix using fixed Work Packages;
6. later add a shared work graph for parallel agents.

See [docs/router-research-v0.1.md](docs/router-research-v0.1.md) for analysis of HarnessRouter, Autohand Routes, and vLLM Semantic Router.

Key metrics:

- wall-clock time;
- token/model cost;
- Haiku execution share;
- first-pass test success;
- retries/escalations;
- parent direct-implementation violations;
- human corrections;
- final quality.
