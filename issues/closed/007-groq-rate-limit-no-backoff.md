# 007: Groq rate limits (429) after about 19 quick requests, with no retry

- **Status:** Closed 2026-11-22 in merge `4283a5c`. A 429 is retried once after `retry-after` within `LLM_TIMEOUT_MS`; otherwise the turn falls back and logs `llm_rate_limited`. README documents the free-tier limit.
- **Severity:** Medium
- **Spec:** §5 is met (the fallback worked), but understanding quality drops silently under load
- **Path:** LLM

## Reproduce

Send about 20 Web Chat messages within a few seconds (the audit batch did this). From the 20th call onward:

```
{"event":"llm_failed","ms":135,"error":"Error: groq http 429"}
{"event":"turn","source":"rules",...}
```

Those turns were answered by keyword rules. One of them produced the issue-003 behavior ("HP-F01 or HP-F02" became HP-F01) that the LLM had answered correctly.

## Expected

Short bursts should not drop to keyword quality. When the limit is truly reached, the fallback is correct, but it should be visible.

## Suggested fix

- On 429, honour `retry-after` (or wait about 1 s) and retry once, if that still fits inside `LLM_TIMEOUT_MS`.
- Log `retryAfter` and add an `llm_rate_limited` event, so the pilot can count fallback turns.
- Document the free-tier limits in the README's known limits, and point to a paid key for the pilot.
