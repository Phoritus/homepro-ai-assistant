# Groq models and intent routing: research notes

Researched 2026-11-22 against primary sources. Every claim cites its page. "Unconfirmed" means no primary source settled it. Groq pages change without notice, so re-check the models and deprecations pages before you pin a model ID.

Context: issues 001, 002, 004 and 011 are routing errors. Today `apps/api/src/llm/groq.ts` makes one call with `response_format: { type: "json_object" }` at `temperature: 0` and sets no reasoning parameters. ADR 0001 says the LLM never states facts.

## 1. Models available on Groq today

Source for the table: https://console.groq.com/docs/models (speed, price and limits as listed there; prices are per 1M tokens).

| Model ID | Status | Context / max out | Speed (t/s) | Price in / out |
|---|---|---|---|---|
| `openai/gpt-oss-20b` | Production | 131,072 / 65,536 | 1000 | $0.075 / $0.30 |
| `openai/gpt-oss-120b` | Production | 131,072 / 65,536 | 500 | $0.15 / $0.60 |
| `llama-3.1-8b-instant` | Production table, but see deprecation | 131,072 / 131,072 | 560 | "ContactSales" |
| `llama-3.3-70b-versatile` | Production table, but see deprecation | 131,072 / 32,768 | 280 | "ContactSales" |
| `qwen/qwen3.8-27b` | Preview | 131,072 / 16,384 | 450 | $0.80 / $4.00 |
| `meta-models/muse-spark-open` | Preview | 131,072 / 131,072 | 350 | "ContactSales" |
| `minimaxai/minimax-m2.7` | Preview, Enterprise only | 196,608 / 131,072 | 260 | "ContactSales" |
| `openai/gpt-oss-safeguard-20b` | Preview | 131,072 / 65,536 | 1000 | $0.075 / $0.30 |
| `meta-llama/llama-prompt-guard-2-86m` | Preview | 512 / 512 | n/a | $0.04 / $0.04 |
| `meta-llama/llama-prompt-guard-2-22m` | Preview | 512 / 512 | n/a | $0.03 / $0.03 |

- Preview models "are intended for evaluation purposes only and should not be used in production environments as they may be discontinued at short notice" (https://console.groq.com/docs/models).
- The gpt-oss-20b card lists cached input at $0.037 per 1M (https://console.groq.com/docs/model/openai/gpt-oss-20b). The card also shows a "13M / $1" figure. Its unit is unclear, so treat the cached price as unconfirmed until you see it on a bill.
- MiniMax M2.7 is "available only to Enterprise customers" through sales (https://console.groq.com/docs/model/minimaxai/minimax-m2.7). Muse Spark Open is in "limited preview" (https://console.groq.com/docs/model/meta-models/muse-spark-open). Neither is a candidate for a free or Developer key.
- https://groq.com/pricing returned only marketing text when fetched, so no price on this page comes from it.

### Deprecations that matter here

Source: https://console.groq.com/docs/deprecations. That page says "Requests to deprecated model IDs will return errors" and "enterprise customers with a committed-spend contract are not affected."

| Model ID | Shutdown | Replacement Groq names |
|---|---|---|
| `llama-3.1-8b-instant` | 2026-08-16 | `openai/gpt-oss-20b` |
| `llama-3.3-70b-versatile` | 2026-08-16 | `openai/gpt-oss-120b` or `qwen/qwen3.6-27b` |
| `qwen/qwen3.6-27b` | 2026-09-14 | `qwen/qwen3.8-27b` |
| `qwen/qwen3-32b` | 2026-07-17 | `openai/gpt-oss-120b` |
| `meta-llama/llama-4-scout-17b-16e-instruct` | 2026-07-17 | `openai/gpt-oss-120b` or `qwen/qwen3.6-27b` |
| `meta-llama/llama-4-maverick-17b-128e-instruct` | 2026-03-09 | `openai/gpt-oss-120b` |
| `moonshotai/kimi-k2-instruct-0905` | 2026-04-15 | `openai/gpt-oss-120b` |
| `meta-llama/llama-guard-4-12b` | 2026-03-05 | `openai/gpt-oss-safeguard-20b` |
| `groq/compound`, `groq/compound-mini` | 2026-09-21 | none listed |

The two Llama models conflict. The models page still lists them as Production, but their shutdown dates have passed and their price is "ContactSales". My reading is that they survive only for committed-spend enterprise contracts. That reading is inferred, not confirmed. Also, the llama-3.1-8b-instant card shows no deprecation notice and lists "JSON Object Mode" but not JSON Schema mode (https://console.groq.com/docs/model/llama-3.1-8b-instant).

## 2. Structured Outputs: strict vs best-effort vs json_object

Source: https://console.groq.com/docs/structured-outputs.

- **Strict mode** (`json_schema` with `strict: true`) uses constrained decoding. The page says it "Never errors or produces invalid JSON" and gives "100% schema adherence." Supported models: `openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`, `meta-models/muse-spark-open`.
- Strict-mode schema rules: every field must be in `required`, objects need `additionalProperties: false`, and an optional field takes a `null` union type.
- **Best-effort mode** (`strict: false`, the default) gives "Valid JSON, but schema adherence not guaranteed" and can return HTTP 400 when the output fails validation. It supports the four strict models plus `openai/gpt-oss-safeguard-20b`.
- **JSON Object Mode** (`{ "type": "json_object" }`) is "available on all models." It enforces no schema, and "Outputs are syntactically valid JSON but may not match your intended schema." This is the mode the app uses today.
- Limitation: "Streaming and tool use are not currently supported with Structured Outputs."
- Supported schema types: primitives, objects, arrays, enums, `anyOf`, plus `$defs`/`$ref`, recursion included.
- Caveat on the same page: outputs are designed for "schema compliance but not semantic accuracy." A strict enum stops invented intent labels. It does not stop the model from picking the wrong label.
- OpenAI's own guide gives the same advice: "only Structured Outputs ensure schema adherence. We recommend always using Structured Outputs instead of JSON mode when possible" (https://developers.openai.com/api/docs/guides/structured-outputs). Its moderation example classifies with `z.enum([...]).nullable()`, a nullable enum that maps onto an intent field with a "none" case.

Implication, inferred: switching `groq.ts` to strict `json_schema` on gpt-oss-20b lets the schema allow only valid intents. An array of intents becomes possible for issue 011. The app's own schema check could then be reduced to a boundary guard.

## 3. Rate limits

Source: https://console.groq.com/docs/rate-limits. The page says "the limits shown below are the base limits for the Developer plan." It has a "Free Plan Limits" tab, but the fetched text held no separate Free-plan values. **Free-tier numbers are unconfirmed.** Read your organization's limits page in the console for the exact values. The page also says limits apply "at the organization level, not individual users" and that the table is a "high level summary" with possible exceptions.

| Model ID | RPM | RPD | TPM | TPD |
|---|---|---|---|---|
| `openai/gpt-oss-20b` | 30 | 1K | 8K | 200K |
| `openai/gpt-oss-120b` | 30 | 1K | 8K | 200K |
| `qwen/qwen3.8-27b` | 30 | 1K | 8K | 200K |
| `openai/gpt-oss-safeguard-20b` | 3 | 1K | 2K | 200K |
| `meta-llama/llama-prompt-guard-2-86m` / `-22m` | 30 | 14.4K | 15K | 500K |

The Llama, Muse Spark and MiniMax models have no rows. On overflow the API returns "429 Too Many Requests", and "`retry-after` is only set if you hit the rate limit and status code 429 is returned" (same page). The app already retries once on 429 (`groq.ts`).

Implication, inferred: a two-call design (a classifier and then a second model) spends two requests per message against 30 RPM and 1K RPD. The gpt-oss-20b and gpt-oss-120b limits are separate per-model buckets, so a split can spread load. Whether limits are per model or pooled is unconfirmed beyond the per-model rows in the table.

## 4. Reasoning parameters

Source: https://console.groq.com/docs/reasoning unless noted.

| Model | `reasoning_effort` | Can reasoning be turned off? | `reasoning_format` |
|---|---|---|---|
| gpt-oss-20b / 120b | `low`, `medium`, `high` | No `none` value | "not supported" on gpt-oss |
| qwen3.8-27b | `none`, `default`, `low`, `medium`, `high` | Yes. `none` is instruct mode. At `default`, Groq "does not return reasoning tokens" | `parsed`, `hidden` |
| muse-spark-open | `low`, `medium`, `high`, `xhigh` (default `xhigh`) | No. It "always reasons, so `none` is not supported" | n/a |

- `include_reasoning: false` drops reasoning from the response. It "cannot be used together with `reasoning_format`. These parameters are mutually exclusive."
- With JSON mode, `reasoning_format` "Must be set to either `parsed` or `hidden`". Explicit `raw` with JSON mode or tool use returns 400.
- The reasoning page does not mention `json_schema`. Whether reasoning tokens interfere with strict decoding is **unconfirmed**. Test it.
- Latency: the gpt-oss model card says "Increasing the reasoning level will cause the model's average CoT length to increase" and "longer CoTs provide higher accuracy at a relatively large increase in final response latency and cost" (https://arxiv.org/abs/2508.10925, Section on reasoning levels).
- The Groq gpt-oss-safeguard card says "Use low reasoning effort for simple classifications and high effort for complex, nuanced decisions" (https://console.groq.com/docs/model/openai/gpt-oss-safeguard-20b). This is Groq's only direct guidance on effort for classification.
- The reasoning page says the default `max_completion_tokens` of 1024 "may be too low for complex reasoning." A classifier on gpt-oss that sets a tight max token cap could be cut off mid-reasoning. That is inferred, so a benchmark should check `finish_reason`.
- The gpt-oss default effort on Groq is **unconfirmed** from the fetched pages. `groq.ts` sets none today, so set `reasoning_effort: "low"` explicitly when benchmarking.

## 5. Thai-language evidence

| Model | Evidence | Thai? |
|---|---|---|
| gpt-oss-20b / 120b | MMMLU in 14 languages: Arabic, Bengali, Chinese, French, German, Hindi, Indonesian, Italian, Japanese, Korean, Portuguese, Spanish, Swahili, Yoruba. 20b average 67.0 (low) / 73.5 (medium) / 75.7 (high) (https://arxiv.org/html/2508.10925, Table 2) | **Not evaluated.** No Thai row |
| qwen3.8-27b | Groq card says "strong multilingual support" with no list (https://console.groq.com/docs/model/qwen/qwen3.8-27b). The Qwen3 family blog says "119 languages and dialects" and lists Thai under Tai-Kadai (https://qwenlm.github.io/blog/qwen3/) | Yes for Qwen3. Carry-over to 3.8 is **unconfirmed** |
| muse-spark-open, minimax-m2.7, llama-3.1-8b-instant | Cards list no languages | **Unconfirmed** |
| llama-prompt-guard-2-86m | "evaluated for attack detection in English, French, German, Hindi, Italian, Portuguese, Spanish, and Thai" (https://huggingface.co/meta-llama/Llama-Prompt-Guard-2-86M) | Yes, for attack detection only |

No primary source gives a Thai score for gpt-oss, the model the app uses today. Thai accuracy has to come from this repo's own labelled test set.

## 6. Routing patterns from primary sources

**Anthropic, "Building effective agents"** (https://www.anthropic.com/engineering/building-effective-agents).
- "Routing classifies an input and directs it to a specialized followup task." It "works well for complex tasks where there are distinct categories that are better handled separately." The classifier can be an LLM or "a traditional classification model/algorithm."
- Model split example: route "easy/common questions to smaller, cost-efficient models" and "hard/unusual questions to more capable models." The other example routes customer-service query types "into different downstream processes, prompts, and tools."
- Multi-intent: the article has no routing guidance for it. Its "sectioning" pattern ("Breaking a task into independent subtasks run in parallel") is the closest fit.
- Restraint: find "the simplest solution possible, and only increasing complexity when needed." "Optimizing single LLM calls with retrieval and in-context examples is usually enough."

**aurelio-labs semantic-router README** (https://github.com/aurelio-labs/semantic-router).
- Routes are `Route(name=..., utterances=[...])`. It "embeds every utterance once and matches each query against them" in vector space. By default "the best route always wins."
- Out-of-scope: a `confidence_threshold` makes the router "act only when it's more likely right than wrong." When nothing clears it, "the router returned `None`." Calibrating with `None` labels lets it "say 'none of these'."
- Multi-intent: the README names no multi-route API. `DecisionRouter` "can answer several yes/no, choice and score questions about one message in a single call."
- Thai: the README names no multilingual encoder. Thai suitability depends on the encoder you choose and is **unconfirmed**.

**OpenAI Structured Outputs guide** (https://developers.openai.com/api/docs/guides/structured-outputs). "You can classify inputs on multiple categories, which is a common way of doing moderation." The example uses a nullable enum. This is the one-classifier pattern with a schema-enforced label set and an explicit null for "none of these."

**Groq.**
- Compound (`groq/compound`, `groq/compound-mini`) shuts down 2026-09-21 with no replacement (https://console.groq.com/docs/deprecations). It is not an option.
- No Groq doc page on intent routing was found. That is **unconfirmed absence**: I searched the docs I fetched and found none.
- `gpt-oss-safeguard-20b` classifies against "your written policies," with policies of "400-600 tokens" and output that names a `category` with a `rationale` (https://console.groq.com/docs/model/openai/gpt-oss-safeguard-20b). It is built for safety policy. Its card does not mention routing or off-topic detection, and it is capped at 3 RPM. That makes it a poor fit for per-message routing (inferred).
- Prompt Guard 2 labels only "benign" or "malicious," and "considers only the intent to supersede developer or user instructions" (https://huggingface.co/meta-llama/Llama-Prompt-Guard-2-86M). It does **not** detect off-topic or out-of-scope requests. It cannot handle issue 002.

## 7. What this means for the HomePro routing design (inferred)

These are my conclusions from the sources above, not claims from them.

1. **One classifier call, strict schema.** The sources back routing by category (Anthropic), with an enum and a null "other" (OpenAI), and a threshold that falls back to `None` (semantic-router). Issues 001, 002 and 004 are wrong labels, not wrong models. They need more intent values (`product_detail_unknown`, `delivery`, `payment`, `closing`) and labelled Thai and English examples. A second model would not fix them.
2. **Multi-intent (011).** None of the sources gives a routing pattern for it. The cheapest option the strict schema supports is `intents: [...]`, an array of enums the engine handles in order. Anthropic's sectioning pattern is the precedent.
3. **"Product talk to one model, small talk to another"** fits Anthropic's easy-to-small, hard-to-large example only if the second stage *generates* text. ADR 0001 forbids LLM facts, so the second stage is a template or catalog lookup, and a second model adds a request against 30 RPM without a clear gain. Keep one understanding model. Revisit only if response generation (issue 005) lands.
4. **Model choice to benchmark.** gpt-oss-20b at `reasoning_effort: "low"` is cheapest and fastest with strict support, but it has no Thai evidence. gpt-oss-120b has the same limits and costs twice as much. qwen3.8-27b with `reasoning_effort: "none"` has family-level Thai evidence and strict support. It costs about 10x gpt-oss-20b on input and 13x on output, and it is Preview.
5. **Out-of-scope.** Use an explicit `other`/`handoff` enum value. Prompt Guard does not cover it. A confidence field from the LLM is not calibrated. That is **unconfirmed**, as no source here claims calibration for LLM self-reported confidence.

## Sources fetched

- https://console.groq.com/docs/models
- https://console.groq.com/docs/deprecations
- https://console.groq.com/docs/structured-outputs
- https://console.groq.com/docs/rate-limits
- https://console.groq.com/docs/reasoning
- https://console.groq.com/docs/model/openai/gpt-oss-20b
- https://console.groq.com/docs/model/qwen/qwen3.8-27b
- https://console.groq.com/docs/model/meta-models/muse-spark-open
- https://console.groq.com/docs/model/minimaxai/minimax-m2.7
- https://console.groq.com/docs/model/llama-3.1-8b-instant
- https://console.groq.com/docs/model/openai/gpt-oss-safeguard-20b
- https://console.groq.com/docs/model/meta-llama/llama-prompt-guard-2-86m
- https://huggingface.co/meta-llama/Llama-Prompt-Guard-2-86M
- https://arxiv.org/abs/2508.10925 (gpt-oss model card, HTML at https://arxiv.org/html/2508.10925)
- https://qwenlm.github.io/blog/qwen3/
- https://www.anthropic.com/engineering/building-effective-agents
- https://github.com/aurelio-labs/semantic-router
- https://developers.openai.com/api/docs/guides/structured-outputs
