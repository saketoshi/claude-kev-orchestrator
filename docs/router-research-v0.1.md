# Router Research v0.1

## Purpose

Identify routing ideas worth borrowing for `claude-kev-orchestrator`.

The target here is not generic request routing. The target is a coding execution policy that decides:

- whether work should stay with the parent or be delegated;
- whether a Work Package is closed enough;
- whether it should be split;
- which Claude model should execute it;
- when failure evidence warrants retry or escalation.

## 1. HarnessRouter/harnessrouter

Repository: https://github.com/HarnessRouter/harnessrouter

### What it actually is

HarnessRouter Community Edition is primarily a unified execution layer for agent harnesses such as Claude Code, Codex and Hermes through the Unified Harness Protocol.

It exposes harness/model configuration as a reversible choice and records task/session execution. It is not, in the open-source Community Edition, a learned difficulty classifier comparable to Kev.

Therefore we should **not copy a hidden "HarnessRouter routing algorithm"** because the repository does not expose one of that form.

### What is useful for Kev

Its benchmark methodology is directly useful.

HarnessRouter's published controlled benchmark:

- holds dataset, task, Skill, schema and output contract constant;
- changes harness/model configuration;
- keeps multiple observed runs per configuration;
- measures cost and end-to-end latency;
- applies objective validators to quality dimensions;
- keeps quality dimensions separate rather than collapsing all quality into one opaque score;
- warns that one workload is not a universal ranking.

This maps well to Kev.

### Kev adaptation

For representative Closed Work Packages, execute the same package across:

- Haiku
- Sonnet
- Opus

Keep fixed:

- repository snapshot;
- package prompt;
- acceptance criteria;
- tests;
- environment.

Measure:

- acceptance-test pass/fail;
- first-pass success;
- retries;
- elapsed time;
- token/provider cost when available;
- parent/integrator corrections;
- human quality flags.

Then derive a training label such as:

> cheapest model that clears the package's required quality gate

Do not label "best model" globally.

The same model can be appropriate for one Work Package type and wasteful for another.

## 2. Autohand Routes

Repository: https://github.com/autohandai/routes

This is closer to a conventional model router.

Useful ideas:

1. **Capability gates before scoring**
   - eliminate candidates that cannot satisfy hard requirements;
   - only rank eligible models.

2. **Explicit objectives/policies**
   - lowest-cost acceptable;
   - fastest healthy;
   - highest quality;
   - balanced.

3. **Decision traces**
   - selected candidate;
   - rejected candidates;
   - reason;
   - scores;
   - confidence.

4. **Eval gates before changing routing policy**
   - routing changes should be tested against a representative corpus.

### Kev adaptation

For coding Work Packages, hard gates could include:

- architecture decision required;
- public contract/schema change;
- broad repository context required;
- closed acceptance criteria available;
- expected tool capability;
- context size.

Only after gating should Kev optimize cost/latency.

This suggests changing Kev from:

```text
classify task -> choose model
```

to:

```text
extract package signals
  -> apply hard capability/complexity gates
  -> predict success probability per eligible model
  -> choose cheapest model above quality threshold
  -> emit decision trace
```

## 3. vLLM Semantic Router

Repository: https://github.com/vllm-project/semantic-router

Useful ideas:

- keep routing decision matching separate from model selection;
- support static/baseline algorithms before learned selectors;
- learned selectors use representative query-to-model outcome data;
- supported learned methods include kNN, k-means, SVM and MLP;
- project work also includes Elo, RouterDC, AutoMix, hybrid and RL-oriented approaches.

### Kev adaptation

Do not start by training a complex router.

Our report pipeline should first create the exact dataset needed:

```text
Work Package features
+ chosen model
+ tests/outcome
+ retry/escalation
+ latency/cost
+ human feedback
```

Then compare progressively:

1. static rules;
2. Qwen/Kev classifier;
3. simple learned classifier on observed outcomes;
4. cost-quality policy using predicted success probability;
5. only later contextual bandit/RL if exploration provides measurable value.

## 4. Recommended routing target

The useful objective is not:

> Which model is smartest for this prompt?

It is:

> What is the cheapest/fastest eligible model whose probability of completing this Closed Work Package above the required quality threshold is high enough?

Conceptually:

```text
eligible(m, wp)
  = hard_gates(m, wp)

success_prob(m, wp)
  = Kev / learned outcome model

choose m*
  = argmin cost_latency_objective(m)
    subject to eligible(m, wp)
    and success_prob(m, wp) >= required_quality(wp)
```

If no cheaper model clears the threshold:

- Sonnet/Opus;
- or return `shouldSplit=true` if decomposition is more efficient than escalation.

## 5. Features worth collecting now

The current report pipeline should evolve toward these features.

### Work Package shape

- prompt/description embedding or semantic label;
- estimated context breadth;
- files/modules touched;
- dependency count;
- acceptance criteria present;
- test specification present;
- public API/schema change;
- architecture/design signal;
- integration/cross-cutting signal;
- expected output type.

### Runtime outcome

- selected model;
- test runs/pass/fail;
- edit count;
- tool failures;
- completion duration;
- retry attempt;
- escalation;
- parent correction;
- final acceptance.

### Cost/operations

- input/output tokens when exposed;
- model cost snapshot;
- queue/inference latency when exposed.

## 6. Immediate conclusion

HarnessRouter is valuable mainly as an **evaluation methodology reference**, not as a model-routing algorithm implementation.

For actual decision-policy mechanics, Autohand Routes and vLLM Semantic Router provide more directly reusable ideas:

- capability gates;
- decision traces;
- representative eval corpus;
- model-specific measured quality;
- cheapest acceptable candidate;
- learned selection only after enough outcome data exists.

The current Kev architecture is compatible with this direction because it is already recording prediction and runtime outcome separately.
