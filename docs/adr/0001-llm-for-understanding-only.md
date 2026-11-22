# LLM for understanding only; code states every fact

The Groq LLM extracts intent, slots (Room Size Band, Budget, SKU, support topic) and language as structured JSON, and may write a short conversational wrapper that contains no facts. Every SKU, price, stock statement, policy wording and Handoff notice is rendered from deterministic templates by the shared backend. We chose this over letting the LLM write full replies for three reasons: prices and policy text can't drift or be hallucinated, Web and LINE get identical facts by construction, and an LLM failure degrades to the deterministic path with nothing to fabricate.

## Consequences

- Phrasing is less natural than with a fully generated reply.
- If the LLM output fails schema validation, the turn is treated as an LLM failure.
- The wrapper is the `opener` field of the same structured reading, so it costs no extra API call. It sees only the shopper's message, not the decision. `factFreeOpener` in `understanding.ts` drops any opener that could state a fact, and the engine puts a kept opener before the rendered reply.
