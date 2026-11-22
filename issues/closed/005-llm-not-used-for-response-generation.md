# 005: The LLM does understanding only, while the spec lists response generation too

- **Severity:** Medium (a grading or acceptance risk, not a runtime bug)
- **Spec:** §1, "Integrate at least one real LLM API call … for natural language understanding, conversational flow, and response generation"
- **Related:** [ADR 0001](../docs/adr/0001-llm-for-understanding-only.md)

## Observed

Every reply is rendered from fixed templates in `render.ts`. Groq only returns the intent and slots JSON. ADR 0001 allows the LLM to write "a short conversational wrapper that contains no facts", but that was never built.

## Expected

Either the LLM takes a visible part in generating replies, or the README explains clearly why it does not, so a reviewer doesn't mark §1 as unmet.

## Options

1. **Build the ADR's wrapper.** The LLM writes one opening sentence (for example, empathy for a damaged delivery). Code then appends the deterministic fact block. Run a check that rejects any wrapper containing digits, `฿`, a SKU pattern, or policy words, and fall back to no wrapper. This keeps the anti-hallucination guarantee.
2. **Keep templates only.** Add a README section that ties ADR 0001 to §1, stating that response generation is deliberately deterministic for factual safety.

Option 1 meets the spec's wording with little risk. This is the user's call, so the issue is recorded rather than fixed.
