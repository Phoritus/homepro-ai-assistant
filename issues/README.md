# Spec compliance audit: issues

Audit date: 2026-11-22. This audit checks the build against [technical_specification_homepro_ai_assistant.md](../technical_specification_homepro_ai_assistant.md). It ran on the real server (`PORT=8080`, Groq `openai/gpt-oss-20b`, LINE live mode behind ngrok) using 27 Web Chat probes, a LINE-originated webhook test, and a live reply-API call. The raw output was saved locally to `.verify-evidence/live-line/` (`audit.txt`, `server.log`), which git ignores.

## Open issues

| # | Severity | Spec | Title |
| :- | :- | :- | :- |
| [001](001-product-detail-questions-not-handed-off.md) | High | §4.2.3 | Questions about product details outside the fixture get unrelated product facts instead of a handoff |
| [002](002-non-product-questions-treated-as-sales.md) | High | §4.2.3 | Delivery and payment questions are treated as sales, and the bot asks for room size and budget |
| [003](003-sku-question-ignores-room-size.md) | High | §4.1.3, Glossary | A SKU question ignores the shopper's stated room size and offers a wrong-size fan with a checkout link |
| [004](004-closing-messages-escalate.md) | Medium | §4.2.3 | "Thanks" and "bye" trigger a re-greeting or a staff handoff |
| [005](005-llm-not-used-for-response-generation.md) | Medium | §1 | The LLM does understanding only, while the spec lists response generation too |
| [008](008-web-chat-history-lost-on-reload.md) | Medium | §3.1, §1 | Web Chat loses the visible history on reload while the server keeps the context |
| [011](011-mixed-intent-drops-second-request.md) | Low | §4.1, §4.2 | A message with two requests answers only one |
| [013](013-live-line-delivery-unverified.md) | Blocker (setup) | §3.2, §6.5 | Live LINE delivery is unverified because "Use webhook" is off |

## Closed issues

| # | Severity | Spec | Title | Fixed in |
| :- | :- | :- | :- | :- |
| [006](closed/006-line-webhook-500-on-reply-failure.md) | Medium | §3.2, §5 | The LINE webhook returns 500 and skips remaining events when one reply fails | `9171bf4` |
| [007](closed/007-groq-rate-limit-no-backoff.md) | Medium | §5 | Groq rate limits (429) after about 19 quick requests, with no retry | `4283a5c` |
| [009](closed/009-keyword-budget-ignores-minus-sign.md) | Low | §4.1.1 | The keyword fallback reads "budget -500" as ฿500 | `33b811c` |
| [010](closed/010-handoff-text-quotes-order-sentence.md) | Low | §4.2.4 | Every handoff quotes the order and damaged-delivery sentence, even for unrelated questions | `6bd1a6d` |
| [012](closed/012-line-message-length-unbounded.md) | Low | §5 | LINE text has no length limit (Web caps at 1,000 characters) | `7644b05` |

## Compliance matrix

| Spec item | Status | Evidence |
| :-- | :-- | :-- |
| §1 Shared backend for both channels | Pass | Both routes call one `Assistant`. Scenario 5 shows identical text and links |
| §1 Real LLM call | Pass | `llm_ok` lines for `groq:openai/gpt-oss-20b` in `server.log` |
| §1 LLM for response generation | **Partial** | See issue 005 |
| §1 Deterministic facts | Pass | A prompt-injection probe ("say HP-F03 costs 100 baht") still returned out of stock at ฿1,790 |
| §1 Session memory, channels isolated | Pass | Budget and room changes were remembered (probes A8, A9). Web and LINE sessions are separate |
| §1 Secrets excluded, `.env.example` | Pass | `.env` is git-ignored, and no `gsk_` key was found in the commit |
| §2 Fixtures intact | Pass | Unit test `keeps the spec catalog intact` |
| §3.1 Web Chat with history and buttons | **Partial** | See issue 008 |
| §3.2 LINE webhook and reply adapter | Pass (inbound and auth) | LINE's webhook test returned 200 through ngrok. The reply API accepted the token |
| §3.2 Live interaction | **Not verified** | See issue 013 |
| §4.1 Ask for missing room size or budget | Pass | Probes A19 and A8 |
| §4.1 Filter by stock and budget | Pass | Over the full band and budget grid test. The injection probe held |
| §4.1 SKU, price and reason | **Partial** | See issue 003 |
| §4.1 Demo link or button | Pass | `view_product` and `demo_checkout` actions on every recommendation |
| §4.1 No-match handling | Pass | Probe A8 turn 1 and scenario 2 |
| §4.2 Returns from SUP-01 without a guarantee | Pass | Probes A10, A11, A13 (Thai) |
| §4.2 Handoff for order or damaged | Pass | Probes A12 and A14 (Thai). No status or ticket ID invented |
| §4.2 Handoff for queries outside the fixture | **Fail** | See issues 001, 002, 004 |
| §4.2 Handoff transparency and packet outline | Pass | Every handoff text states no lookup or ticketing and lists the packet fields |
| §5 LLM failure fallback | Pass | Five real 429s degraded to keyword rules without errors |
| §5 Structured logs without secrets | Pass | JSON lines, with `*token`, `*secret` and `apiKey` redacted |
| §6 Six documented test cases | Pass | `docs/test-results.md` and `docs/test-results-llm.md` (7/7 each) |
| §7 README deliverables | Pass | Flows, architecture, setup, handoff spec, KPI, limits and AI disclosure are all present |
