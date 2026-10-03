# claude-kev-orchestrator Design v0.4

## 1. Goal

Use Claude Code Mods as a runtime execution orchestrator, with Kev (Qwen-backed) making lightweight adaptive decisions.

The project is intentionally broader than a model router.

It addresses two failure modes:

1. **model-fit failure** — expensive/strong models execute work that could be delegated to cheaper models;
2. **execution-discipline failure** — the parent model is told to decompose/delegate work but forgets the instruction and starts implementing directly.

The runtime therefore owns both:

- **who should execute a work package**; and
- **what the parent is allowed to do at the current execution phase**.

## 2. Why Mods

Skills and prompts can tell Claude how to behave, but Claude can still choose another action.

MCP adds capabilities, but Claude must choose to call them.

Agent definitions define workers, but the parent can still skip delegation.

Mods operate at the Claude Code runtime boundary. Two events are especially useful:

- `agent.spawn`: fires after a subagent task is decided and before its model is resolved;
- `tool.call`: fires immediately before a tool executes and can return `{ deny: reason }`.

This lets the orchestrator enforce an execution contract rather than merely suggest one.

## 3. Current execution model

An opt-in `[kev]` user prompt enables orchestration for that turn.

```text
IDLE
  |
  | [kev] prompt
  v
DECOMPOSE
  |
  | parent invokes Agent
  v
DELEGATE
  |
  | agent.spawn
  v
WORKERS_RUNNING
  |
  | Agent tool returns
  v
INTEGRATE
  |
  v
VERIFY
```

v0.2 currently implements the path through `INTEGRATE`. Explicit verification-state transitions are a later step.

## 4. Parent execution contract

While orchestration is active:

### DECOMPOSE / DELEGATE / WORKERS_RUNNING

The main parent may:

- inspect/read/search;
- reason about architecture and contracts;
- create work-package instructions;
- invoke the Agent tool.

The main parent may not directly use:

- `Edit`
- `Write`
- `NotebookEdit`

If it tries, the Mod denies the tool call and returns a reason instructing the parent to create closed work packages and delegate them.

Subagents are not restricted by this parent rule because their tool calls have an `agentId`.

### INTEGRATE

After delegated Agent work returns successfully, direct parent edits are permitted for integration.

This first rule is deliberately deterministic. Kev is not asked to decide something that the execution contract already knows.

## 5. Architecture

```text
User [kev] task
      |
      v
Parent Claude
(architect/orchestrator)
      |
      | tries Edit/Write too early
      +------------------------------+
      |                              |
      v                              v
 tool.call                       Runtime State
      |                              |
      +---- DENY if phase requires delegation
      |
      | Agent tool
      v
 agent.spawn
      |
      v
Kev / Qwen
      |
      | model-fit decision
      v
haiku | sonnet | opus | inherit
      |
      v
Worker Claude
      |
      v
Agent tool returns
      |
      v
Parent enters INTEGRATE
```

## 6. Closed Work Package

The important unit is not "one function". It is an independently verifiable semantic unit.

A Haiku-suitable package should normally have:

- explicit boundaries;
- explicit acceptance criteria;
- small/local required context;
- already-decided interfaces and contracts;
- no architectural decision;
- an independently testable result.

A single function can still require Sonnet/Opus if it spans transactions, authorization, cache consistency, compatibility, or other cross-cutting semantics.

## 7. Work Package model

```ts
type WorkPackage = {
  id: string
  prompt: string
  description: string
  subagentType: string
  parentModel: string
  background: boolean
  fork: boolean
}
```

Kev currently returns:

```ts
type ModelDecision = {
  model: "haiku" | "sonnet" | "opus" | "inherit"
  confidence: number
  reason?: string
  shouldSplit?: boolean
}
```

The broader target contract is:

```ts
type ExecutionDecision = {
  actor: "parent" | "worker"
  action: "execute" | "delegate" | "split" | "integrate" | "verify"
  model?: "haiku" | "sonnet" | "opus" | "inherit"
  confidence: number
  reason?: string
}
```

The broader decision is not wired into every action yet. It is the target for ambiguous execution choices where a deterministic state rule is insufficient.

## 8. Kev responsibility

Kev should not try to out-code Claude.

Kev's useful responsibilities are:

- model-fit classification;
- whether a package is sufficiently closed;
- whether further splitting is worthwhile;
- whether a failed package should retry or escalate;
- which exploration/work stream should receive resources;
- later, whether the current execution should return to delegation or integration.

Deterministic policy stays in the runtime state machine.

## 9. Kev API contract

Environment:

```text
KEV_ENDPOINT=http://127.0.0.1:8787/decide
KEV_TIMEOUT_MS=1500
```

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

Kev failures are fail-open for model routing: malformed responses, timeouts, or unavailable endpoints fall back conservatively.

Execution-contract enforcement is local and does not depend on Kev availability.

## 10. Prompt mode

Prefix a user prompt with `[kev]`.

The marker is removed and the runtime adds an orchestration instruction telling the parent to:

- act as architect/orchestrator first;
- make architecture/contract decisions;
- create closed work packages;
- delegate implementation through Agent;
- integrate and verify worker results.

Unlike prompt-only orchestration, the runtime also enforces the first delegation boundary through `tool.call`.

A normal prompt without `[kev]` resets orchestration to `idle`.

## 11. State

Current per-session state:

```ts
type SessionState = {
  active: boolean
  phase:
    | "idle"
    | "decompose"
    | "delegate"
    | "workers_running"
    | "integrate"
    | "verify"
  delegatedPackages: number
  decisions: DecisionRecord[]
}
```

Later shared state can add:

- package graph;
- dependencies;
- owners;
- attempts;
- test outcomes;
- package split lineage;
- escalation history;
- cost/latency;
- exploration hypotheses/evidence.

This can become a coordination substrate for parallel agents rather than only a model router.

## 12. Known v0.2 limitations

- Parent mutation through arbitrary `Bash` commands is not blocked yet.
- The state machine only enforces the initial delegation boundary.
- `verify` is modeled but not automatically entered.
- `shouldSplit` is recorded but not yet used to send the parent back to decomposition.
- State is local to one Claude Code process/session.
- Kev still makes only the model-fit decision.

These limits are intentional to keep the first experiment observable.

## 13. Evaluation

Compare:

1. all-Sonnet baseline;
2. fixed model routing;
3. Kev model routing;
4. Kev routing + execution-state enforcement.

Measure:

- wall-clock duration;
- model/token cost;
- percentage of implementation delegated;
- percentage executed by Haiku;
- first-pass test success;
- retry/escalation count;
- parent execution-contract violations;
- human corrections;
- final quality.

Primary research questions:

> Can stronger models transform work into closed packages so weaker models execute a large share of implementation without reducing final quality?

and:

> Can runtime enforcement prevent orchestration instructions from being forgotten without making Claude Code materially less flexible?

## 14. Roadmap

### v0.1 — Model-fit routing
Intercept `agent.spawn` and choose the worker model.

### v0.2 — Execution state machine
Enforce parent architect/delegation behavior before implementation. **Current.**

### v0.3 — Observability and evaluation reports
Persist run decisions, execution events, violations, and human feedback artifacts for measurable policy improvement.

### v0.4 — Interactive control plane
Add a Mods Pane, one-shot human model override, and optional Codex external review. **Current.**

### v0.5 — Split feedback
Use `shouldSplit` to return oversized packages to the parent for further decomposition.

### v0.6 — Outcome-aware escalation
Use test/tool outcomes to retry, split, or escalate Haiku -> Sonnet -> Opus.

### v0.7 — Shared work graph
Coordinate parallel workers through shared facts, ownership, dependencies, and checkpoint state.

### v0.8 — Adaptive execution policy
Let Kev learn actor/action/model decisions from package features and observed outcomes.


## 15. Observability and feedback artifacts

Every orchestration turn is treated as one evaluation run.

Default output:

```text
.kev/runs/<run-id>/
  run.json
  events.jsonl
  decisions.jsonl
  report.md
  outcomes.jsonl
  reviews.jsonl
  feedback.json
```

The output root can be overridden by `KEV_REPORT_DIR`.

### Machine-readable data

`run.json` contains the complete current run snapshot.

`events.jsonl` records runtime observations such as:

- run start/completion;
- parent execution-contract violations;
- Agent invocation;
- subagent spawn;
- Agent completion.

`decisions.jsonl` records the prediction side:

- Work Package;
- selected model;
- confidence;
- reason;
- `shouldSplit`;
- Kev/fallback source;
- spawned agent ID when available.

### Human-readable report

`report.md` summarizes:

- model distribution;
- routing decisions;
- confidence;
- violations;
- failed Agent boundaries;
- review questions.

### Human feedback

`feedback.json` is intentionally separate from generated observations so a reviewer can mark:

- problematic Work Packages;
- overall assessment;
- free-form comments;
- suggested policy changes.

Future Kev training/evaluation should join prediction, runtime outcome, and human feedback by run/work-package identity rather than learning from model choice alone.


## 16. Work Package outcome correlation

The observability layer now correlates runtime evidence back to the Work Package that caused it.

```text
Work Package ID
  -> agent.spawn
  -> agentId
  -> worker tool calls
  -> edits
  -> recognized test commands
  -> tool/test failures
  -> Agent boundary completion
  -> final observed outcome
```

`outcomes.jsonl` stores one record per Work Package with:

- selected model;
- agent ID;
- edit count;
- test runs/pass/fail;
- other tool failures;
- final observed outcome;
- evidence timestamps.

Retries are also grouped into a `lineageId` derived from the normalized Work Package description. Later attempts receive an incrementing `attempt` and a stronger selected model is marked as `escalatedFrom`.

This retry/escalation grouping is intentionally labeled heuristic. A later protocol should let the parent assign a stable lineage ID when it explicitly retries or re-splits a package.

## 17. Routing research implication

See `docs/router-research-v0.1.md`.

The current direction is to avoid training Kev on subjective model labels. Instead, collect controlled outcome data and learn a model-specific probability of successful completion.

The target policy is:

```text
hard eligibility gates
  -> predict success probability per model
  -> choose cheapest/fastest model above required quality threshold
  -> split instead of escalating where decomposition has higher expected value
```

HarnessRouter's public repository is primarily a unified harness execution layer, but its benchmark methodology is useful: keep task/input/contracts fixed, repeat configurations, retain raw observations, and validate quality with explicit criteria. Autohand Routes and vLLM Semantic Router are more directly relevant to model-selection mechanics such as capability gates, decision traces, eval gates, and learned selectors.


## 18. Interactive control plane

v0.4 adds a Claude Mods Pane as the runtime control surface.

The pane is deliberately a projection of Core State rather than a separate source of truth.

It exposes:

- current execution phase;
- current run;
- recent Work Packages;
- recommended/selected model;
- confidence;
- outcome/test state;
- violation count;
- Codex review status.

The `/kev` command toggles the pane. A `[kev]` task attempts to open it automatically on a supported surface.

### Human override

A person can set the next worker to:

- Auto;
- Haiku;
- Sonnet;
- Opus.

The override is consumed by exactly one subsequent `agent.spawn` and then resets to Auto.

When a human override exists, the original Kev/fallback result remains in `recommendedDecision`, while the executed choice is stored in `decision` with `source=human_override`.

This provides direct preference/correction data without destroying the router's original prediction.

## 19. Optional external reviewer

v0.4 adds an optional bridge to the official Codex CLI review command:

```text
codex exec --ephemeral --color never review --uncommitted
```

The bridge can be triggered:

- manually through `/kev-review`;
- manually from the Pane;
- automatically at run completion only when `KEV_CODEX_AUTO_REVIEW=1`.

Automatic review is disabled by default.

The reviewer is intentionally outside the critical execution path. Missing CLI, authentication failure, timeout, or non-zero exit is captured as a failed review record but does not block Claude/Kev execution.

Review records are persisted to `reviews.jsonl`, `run.json`, and the human-readable report.

This is the first cross-vendor extension point. The orchestration core remains Claude-oriented today, while review can be delegated to an external OpenAI/Codex runtime.
