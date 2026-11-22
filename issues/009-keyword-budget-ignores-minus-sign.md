# 009: The keyword fallback reads "budget -500" as ฿500

- **Severity:** Low (fallback path only. The LLM path correctly ignored -500 and asked for a budget)
- **Spec:** §4.1.1, ask clarifying questions when constraints are missing or invalid

## Reproduce

When the keyword rules answer (no key, or Groq returns 429): `12 sqm room, budget -500 baht`.

Observed: `Our small-room fan HP-F01 costs ฿890, above your ฿500 budget …`

## Expected

Treat the budget as invalid and ask for it, as the LLM path does: `Got it, a small room (up to 15 m²). What's your budget in THB?`

## Cause

The `NUMBER` pattern in `understanding.ts` has no sign, so the regex matches `500` inside `-500`. `isValidBudget` never sees a negative number.

## Suggested fix

Capture an optional leading `-` (or `−`) in the budget patterns, so a negative value reaches `isValidBudget` and is rejected. Add a keyword-understander test case.
