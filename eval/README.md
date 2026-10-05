# Kev routing evaluation

This folder is a regression harness for routing-policy changes.

## Corpus

- `developmentCases`: 32 cases — Haiku 10 / Sonnet 10 / Opus 10 / mixed-split 2
- `holdoutCases`: 12 cases — Haiku 4 / Sonnet 4 / Opus 4

The initial upstream corpus was reconstructed from the categories and named failure modes in the 2026-10-05 user feedback. The exact original raw 44 case texts were not included in that report, so these labels are a regression baseline rather than authoritative ground truth.

## Run

```bash
node --experimental-strip-types eval/run-eval.mjs 2
```

Legacy criteria:

```bash
EVAL_VARIANT=legacy node --experimental-strip-types eval/run-eval.mjs 2
```

Holdout:

```bash
EVAL_CASES=holdout node --experimental-strip-types eval/run-eval.mjs 2
```

The runner records raw/accepted decisions, confidence, latency, request ID, expected-model agreement, cheaper-than-expected misses and more-expensive-than-expected misses.

## Policy

Treat the corpus as a gate when changing:

- choice criteria;
- `KEV_MIN_CONFIDENCE`;
- Ribbon model version;
- request state formatting.

Do not optimize only for exact hand-label agreement. The longer-term target is the cheapest model that actually completes a Closed Work Package without retry, escalation or integrator repair. Join these evals with real `outcomes.jsonl` evidence before promoting a learned/adaptive policy.
