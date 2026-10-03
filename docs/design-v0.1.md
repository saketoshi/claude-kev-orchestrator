# claude-kev-orchestrator Design v0.1

## 1. Goal

Use Claude Code Mods as a runtime interception layer and Kev (Qwen-backed decision engine) as a lightweight model-fit classifier.

The first target is not a generic multi-agent framework. It is a measurable coding optimization:

1. A strong Claude model designs/decomposes work.
2. Claude Code spawns subagents for concrete work packages.
3. The mod intercepts `agent.spawn` before the model is resolved.
4. Kev classifies the work package as Haiku-, Sonnet-, or Opus-suitable.
5. The mod returns the selected Claude model alias.
6. The result is recorded in shared session state for later evaluation/escalation.

## 2. Why Mods

Classic hooks can observe and react, but Mods can rewrite runtime events. Claude Code's `agent.spawn` event fires after the subagent task is decided and before its model is resolved, which is the exact decision point needed by this project.

The orchestration core is intentionally isolated from Claude Code APIs because Mods are early access and may change.

## 3. Scope

### v0.1

- Intercept `agent.spawn`.
- Ask Kev which model should execute the work package.
- Support `haiku | sonnet | opus | inherit`.
- Fall back safely when Kev is unavailable.
- Keep in-memory per-session decision state.
- Optional prompt opt-in marker (`[kev]`) that adds decomposition guidance.
- Never block a subagent because Kev failed.

### Not v0.1

- Starting new agents independently of Claude.
- Automatic recursive task decomposition.
- Shared state across multiple Claude Code processes.
- Cost/token telemetry.
- Automatic retry/escalation after failed implementation.
- Cross-vendor worker models.

These are later phases.

## 4. Architecture

```text
User task
   |
   v
Claude main agent
   |
   | Agent tool: prompt + description + subagent type
   v
Claude Code agent.spawn
   |
   v
claude-kev-orchestrator Mod
   |
   +----> WorkPackage normalizer
   |          |
   |          v
   |      Shared Session State
   |
   +----> Kev Client ----> Kev/Qwen
   |                        |
   |                        v
   |                 model-fit decision
   |                  haiku/sonnet/opus
   |
   v
agent.spawn { model }
   |
   v
Claude subagent
```

## 5. Work Package model

The mod must not ask Kev to understand the entire repository. It sends the already-decomposed unit that Claude is about to delegate.

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

Kev returns:

```ts
type ModelDecision = {
  model: "haiku" | "sonnet" | "opus" | "inherit"
  confidence: number
  reason?: string
  shouldSplit?: boolean
}
```

`shouldSplit` is recorded in v0.1 but not acted on yet. In v0.2 it can trigger a prompt correction that asks the parent to split a package further.

## 6. Model-fit policy

The important distinction is not LOC or number of functions. A Haiku-suitable unit is a **closed work package**.

### Haiku

Prefer when:

- acceptance criteria are explicit;
- implementation is local;
- required context is small;
- interfaces/contracts are already decided;
- no architectural choice is required;
- the output can be independently verified.

### Sonnet

Prefer when:

- multiple files/modules must be coordinated;
- local exploration is required;
- there are implementation choices;
- integration work is involved;
- the package is not cleanly closed.

### Opus

Prefer when:

- architecture or public contracts change;
- requirements are ambiguous;
- cross-cutting design decisions are required;
- failures indicate the package was decomposed at the wrong abstraction level.

## 7. Kev API contract

v0.1 uses a small HTTP contract so Kev can be implemented independently with Qwen.

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
  "reason": "Closed local implementation with explicit output",
  "shouldSplit": false
}
```

Malformed/timeout responses are ignored and Claude Code continues with its original model resolution.

## 8. Prompt mode

Prefixing a user prompt with `[kev]` enables an experimental decomposition hint.

The mod removes the marker and appends a small instruction telling the parent model to:

- separate architecture decisions from implementation;
- create closed work packages where possible;
- delegate packages independently;
- avoid forcing a package to Haiku if it still needs design decisions.

This is intentionally opt-in because prompt rewriting is more invasive than model selection.

## 9. State

v0.1 keeps state only in the mod process:

```ts
type SessionState = {
  decisions: DecisionRecord[]
}
```

A later version can persist/shared-sync:

- package graph;
- ownership;
- attempts;
- test outcomes;
- escalation history;
- cost and latency;
- package split lineage.

That state is where Kev can evolve from a static classifier into a learned execution policy.

## 10. Evaluation

Compare at least:

- all-Sonnet baseline;
- fixed heuristic routing;
- Kev routing.

Measure:

- wall-clock duration;
- estimated model cost;
- first-pass test success;
- retry count;
- escalation count;
- human correction count.

The primary research question is:

> Can we transform/decompose work into closed packages such that weaker models execute a large share of implementation without reducing final quality?

## 11. Roadmap

### v0.1 — Model-fit routing
Intercept agent.spawn and choose model.

### v0.2 — Split feedback
If Kev returns shouldSplit, inject a corrective instruction before delegation rather than escalating immediately.

### v0.3 — Outcome-aware escalation
Track test/tool outcomes; Haiku -> Sonnet -> Opus only when evidence warrants it.

### v0.4 — Shared work graph
Persist package graph and allow parallel agents to coordinate through shared state.

### v0.5 — Adaptive policy
Train/tune Kev using observed package features and outcomes instead of hand-authored thresholds.
