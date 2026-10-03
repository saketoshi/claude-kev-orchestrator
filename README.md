# claude-kev-orchestrator

Kev-powered adaptive model orchestration for Claude Code.

This project explores one concrete idea:

> Let stronger Claude models decide/decompose the work, then use Kev (Qwen-backed) at runtime to decide which Claude model should execute each closed work package.

## Current PoC

v0.1 intercepts Claude Code's `agent.spawn` Mod event, calls Kev, and rewrites the subagent model to one of:

- `haiku`
- `sonnet`
- `opus`
- `inherit`

The key point is that Kev does **not** need to be smarter than Claude at coding. Kev only learns the execution policy: which model is sufficient for a given already-decomposed work package.

For design details, see [docs/design-v0.1.md](docs/design-v0.1.md).

## Flow

```text
strong Claude model
  -> design / decomposition
  -> Agent tool
  -> Claude Code agent.spawn
  -> claude-kev-orchestrator Mod
  -> Kev / Qwen model-fit decision
  -> haiku | sonnet | opus | inherit
  -> subagent execution
```

## Kev contract

Set:

```bash
export KEV_ENDPOINT=http://127.0.0.1:8787/decide
export KEV_TIMEOUT_MS=1500
```

Kev receives a JSON request containing the work package and returns:

```json
{
  "model": "haiku",
  "confidence": 0.91,
  "reason": "Closed local implementation with explicit acceptance criteria",
  "shouldSplit": false
}
```

If Kev times out, is unavailable, or returns invalid JSON, the Mod falls back conservatively and never blocks the subagent.

## Smoke test with the mock Kev server

Run:

```bash
node examples/mock-kev-server.mjs
```

Then start Claude Code with the plugin directory:

```bash
claude --plugin-dir .
```

Use an opt-in prompt:

```text
[kev] Implement this feature. Keep architecture decisions explicit and delegate closed implementation units.
```

The `[kev]` marker is removed before the prompt reaches Claude and a small decomposition instruction is appended. Every subagent spawn is then classified by Kev.

## Development notes

Claude Code Mods are early access. The project therefore keeps:

- Claude-specific interception in `hooks/register.ts`;
- model-fit domain types in `hooks/domain.ts`;
- Kev HTTP integration in `hooks/kev.ts`;
- fallback execution policy in `hooks/policy.ts`;
- prompt opt-in behavior in `hooks/prompt.ts`.

This separation is intentional so the orchestration policy can survive Mods API changes.

## Next

The next useful experiment is not more infrastructure. It is measurement:

1. run the same feature with all-Sonnet;
2. run with fixed routing;
3. run with Kev routing;
4. compare wall-clock time, cost, test success, retries, and escalation.

After that, v0.2 can use Kev's `shouldSplit` decision to ask the parent model to split a package further instead of immediately escalating it.
