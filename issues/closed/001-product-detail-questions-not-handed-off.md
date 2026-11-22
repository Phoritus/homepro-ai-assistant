# 001: Questions about product details outside the fixture get unrelated product facts instead of a handoff

- **Severity:** High
- **Spec:** §4.2.3, "Trigger a staff handoff … any query outside the available fixture data"
- **Path:** LLM (reproduced with `llm_ok`)

## Reproduce

Web Chat, new session:

| Input | Observed |
| :-- | :-- |
| `What is the wattage of HP-F01?` | `HP-F01 12-inch desk fan, ฿890, for a small room (up to 15 m²). 3 in stock at Demo Store.` plus view and checkout buttons. No handoff |
| `Does HP-F02 come with a remote control?` | `HP-F02 16-inch pedestal fan, ฿1,390, for a medium room …` plus buttons. No handoff |

## Expected

The fixture has no wattage or remote-control data, so the assistant should say it doesn't have that information and hand off with reason `out_of_scope`. It may still state the facts it does have.

## Cause

The LLM classifies any message containing a SKU as `sales`. The engine then sees a SKU and runs `checkSku`, which answers stock and price no matter what was actually asked. Neither the `Understanding` schema nor the system prompt has a way to say "asks about an attribute we don't hold".

## Suggested fix

Add a field such as `asksUnknownAttribute: boolean` (or an intent `product_detail_unknown`) to the schema and prompt, with examples of what the fixture holds (price, stock, room size, name). When it is set, hand off as `out_of_scope`. Add regression probes using the two inputs above.
