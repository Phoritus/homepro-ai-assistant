# 003: A SKU question ignores the shopper's stated room size and offers a wrong-size fan with a checkout link

- **Status:** Closed 2026-11-22 on branch `feat/intent-routing`, not yet merged to main (`4258c8b`, `d4c41d9`). `checkSku` returns `wrong_size` when the known band differs from the product's; the reply states the mismatch and offers no checkout for that product. Two or more SKUs route to `recommend`.
- **Severity:** High
- **Spec:** §4.1.3, "Reason explaining why it fits the user's stated room size and budget". Glossary, "Alternative … The size mismatch is always stated"
- **Path:** Both LLM and keyword rules

## Reproduce

| Input | Path | Observed |
| :-- | :-- | :-- |
| `I have a 20 sqm room. Is HP-F01 good for me?` | LLM | `HP-F01 12-inch desk fan, ฿890, for a small room (up to 15 m²). 3 in stock at Demo Store.` plus **Demo checkout** |
| `Which is better for a 20 sqm room, HP-F01 or HP-F02? budget 2000` | Keyword (during Groq 429) | Same HP-F01 reply with checkout. HP-F02 is ignored |

With the LLM, the second input happened to go right (the model left `sku` empty, so matching recommended HP-F02).

## Expected

A 20 m² room is Medium. The assistant should answer that HP-F01 is sized for small rooms, not the shopper's medium room, and then offer the Valid Match (HP-F02, if within budget). It should not offer checkout for a fan that doesn't fit the stated room without saying so.

## Cause

In `decideSales`, a SKU in the message always takes the `checkSku` path. `checkSku` checks stock and budget but never compares `product.band` with the shopper's known `roomSizeBand`. The keyword rules also take only the first SKU from a message.

## Suggested fix

Pass the known band into `checkSku` and add an outcome `wrong_size { product, requestedBand, followUp: MatchOutcome | null }`. Render the mismatch, then the match result. Add unit tests for "20 m² + HP-F01" and "30 m² + HP-F01".
