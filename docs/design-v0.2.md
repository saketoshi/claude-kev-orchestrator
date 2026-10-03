# claude-kev-orchestrator Design v0.3

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
Persist run decisions, execution events, violations, and human feedback artifacts for measurable policy improvement. **Current.**

### v0.4 — Split feedback
Use `shouldSplit` to return oversized packages to the parent for further decomposition.

### v0.5 — Outcome-aware escalation
Use test/tool outcomes to retry, split, or escalate Haiku -> Sonnet -> Opus.

### v0.6 — Shared work graph
Coordinate parallel workers through shared facts, ownership, dependencies, and checkpoint state.

### v0.7 — Adaptive execution policy
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
