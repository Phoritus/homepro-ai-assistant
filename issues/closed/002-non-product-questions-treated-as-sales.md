# 002: Delivery and payment questions are treated as sales, and the bot asks for room size and budget

- **Status:** Closed 2026-11-22 on branch `feat/intent-routing`, not yet merged to main (`6b14573`, `abe9893`). `sales` is split into `recommend` and `product_info`; delivery, payment and installation questions are `out_of_scope` in the prompt and the keyword rules. Live: `Can I pay for a fan in installments?` handed off with Groq on.
- **Severity:** High
- **Spec:** §4.2.3, "any query outside the available fixture data" must hand off
- **Path:** LLM (reproduced with `llm_ok`, `intent: "sales"`)

## Reproduce

| Input | Observed |
| :-- | :-- |
| `Do you deliver to Chiang Mai?` | `To recommend a fan, I need two things: your room size in m² and your budget in THB.` No handoff |
| `Can I pay for a fan in installments?` | Same reply. No handoff |

## Expected

Neither question can be answered from the fixtures. The assistant should hand off (`out_of_scope`) with the SUP-02 transparency notice, not ignore the question and start a sales flow.

## Cause

The system prompt defines `sales` broadly ("wants a fan … asks about a product's price or stock"). The model treats any shopping-related message as sales. The engine's sales branch then asks for the missing slots.

## Suggested fix

Narrow `sales` in the prompt to "wants a recommendation, or gives room size, budget or a SKU". State explicitly that delivery, payment, installation, store hours, promotions and other services are `other`. Add these inputs as LLM regression probes. The keyword rules also match `fan` and `buy` as sales, so give them the same exclusion words (`deliver`, `install`, `installment`, `pay`, `ผ่อน`, `จัดส่ง`).
