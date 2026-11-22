# 015: Off-topic chit-chat ("how about the weather") creates a staff handoff

- **Status:** Closed 2026-11-22 on branch `fix/issues-008-015`. New `off_topic` intent routes to a `redirect` decision: no handoff, no packet, known context and the pending question kept. `out_of_scope` keeps shop questions staff can answer. Live with Groq `openai/gpt-oss-20b`: `How about weather today` and `เล่าเรื่องตลกให้ฟังหน่อย` read as `off_topic`, and `อากาศร้อนมาก อยากได้พัดลมสำหรับห้อง 12 ตร.ม.` stays `recommend`.
- **Severity:** Medium
- **Spec:** §4.2.3 (handoff is for shop queries the fixtures can't answer). Also affects the pilot KPI, because each chit-chat message counts as a handoff and sends staff a Handoff Packet
- **Path:** LLM (`openai/gpt-oss-120b`, branch `feat/intent-routing`)

## Reproduce

| Input | Observed |
| :-- | :-- |
| `How about weather today` | Full SUP-02 handoff, reason `out_of_scope`, "This demo has no order lookup … So I can't check an order …". `server.log` shows `"intents":["out_of_scope"],"decisions":["handoff"]` |
| `Tell me a joke` | Same (from the eval probe set, where `out_of_scope` is the expected label) |

## Expected

A short redirect with no handoff and no packet, in the shopper's language, for example: "I can only help with fans, returns and orders. Tell me your room size and budget and I'll recommend a fan." Shop questions the fixtures can't answer (delivery areas, installments, store hours, unheld product attributes) still hand off, because staff can answer them.

## Cause

One intent, `out_of_scope`, covers two different things: shop questions that need a person, and messages that aren't about the shop at all. The route table maps it to a handoff, so both get one.

## Suggested fix

Split the intent. Keep `out_of_scope` (renamed `needs_staff` if clearer) for shop questions outside the fixtures, and add `off_topic` for anything not about the shop. Route `off_topic` to a new `redirect` decision with EN and TH phrases that keep the session's known context and `awaiting`. Update the prompt definitions, the keyword rules (`weather`, `joke`, `อากาศ`, `เล่า…ตลก`), the eval labels (`002h` becomes `off_topic`) and add the input above as a probe. Note that the keyword rules already reply with the fallback text, not a handoff, when nothing matches, so the gap is on the LLM path.
