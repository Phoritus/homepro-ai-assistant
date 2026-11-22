# 014: "What do you have in stock?" is handed off to staff although the catalog answers it

- **Status:** Closed 2026-11-22 in `1243215`. New `browse_catalog` intent lists the in-stock fans with price and room size, then asks for the missing slots. Probe `4.1-browse` in `eval-llm.ts`.
- **Severity:** High
- **Spec:** §4.1 (recommend from the fixture catalog), §4.2.3 (hand off only queries *outside* the fixture data)
- **Path:** LLM (`openai/gpt-oss-120b`, branch `feat/intent-routing`). The keyword rules also have no route for it

## Reproduce

Web Chat, after an earlier order-status turn in the same session:

| Input | Observed |
| :-- | :-- |
| `ตอนนี้มีอะไรเหลือบ้าง` ("What do you have left right now?") | Full SUP-02 handoff, reason `out_of_scope`. `server.log` shows `"intents":["out_of_scope"],"decisions":["handoff"]` |

## Expected

The catalog holds every in-stock product with its name, price and room size. The assistant should list the in-stock fans (today HP-F01 and HP-F02) with price and room size, then ask for room size and budget to narrow the choice. No handoff.

## Cause

The routing taxonomy has no route for browsing the catalog. `recommend` needs a room size or budget, and `product_info` needs one named SKU. A general "what do you sell / what's in stock / what's left" question matches neither, so the model picks `out_of_scope`, which always hands off.

## Suggested fix

Add a `browse_catalog` intent to `LLM_INTENTS`, the Groq prompt ("asks what fans the shop has, what is in stock or what is left, without a room size, budget or SKU"), the keyword rules (`what do you have`, `in stock`, `what's left`, `มีอะไรบ้าง`, `เหลือ`, `มีขาย`) and the route table. Its route renders the in-stock list from `CATALOG` and asks for the missing slots. Add the input above and `What fans do you sell?` to `eval-llm.ts` and to `routing.test.ts`.
