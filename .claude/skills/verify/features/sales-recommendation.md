# Fan recommendation

A shopper tells the assistant their room size and budget, in any order and across turns. The assistant asks only for what is missing, then recommends in-stock fans within budget, naming the SKU, price and reason, with demo product and checkout links. When nothing fits, it says why and offers the closest-size alternative or a clear no-match.

## Sub-features

- `sales-ask` asks only for the missing slot (room size or budget).
- `sales-memory` remembers slots across turns in one session.
- `sales-valid` returns a Valid Match with SKU, price, reason, stock and two links.
- `sales-alternative` states why the shopper's size doesn't fit and offers the neighbouring size, naming the mismatch.
- `sales-nomatch` states the constraint, offers no product, and suggests changing budget or calling staff.
- `sales-sku` answers a question about one SKU (stock and budget), then offers an alternative if needed.
- `sales-sku-size` states the mismatch when a SKU is sized for another band than the shopper's known room, and offers no checkout for it (`20 sqm room. Is HP-F01 good for me?`).
- `sales-sku-unheld` hands off as `out_of_scope` when the shopper asks about an attribute the catalog doesn't hold (`What is the wattage of HP-F01?`).
- `sales-thai` replies in Thai to Thai messages.

## How to get to it (user POV)

- Web Chat: type into the box on `/`, or press a sample chip.
- LINE: send a text message to the OA (see [LINE channel](./line-channel.md)).

## Driving it with verify.mjs

Preconditions:

- Baseline instance, keyword mode.

- **Ask then remember.** Run `verify.mjs chat web-verify-sales-1 "I need a fan for my 12 m2 bedroom"`. The reply asks for the budget only and has `actions: []`. Then run `verify.mjs chat web-verify-sales-1 "My budget is 1,000 baht"`. The reply names `HP-F01`, `฿890` and `Reason:` with `small room` and `฿1,000 budget`. `actions` holds `view_product` and `demo_checkout` for HP-F01.
- **Alternative.** Run `verify.mjs chat web-verify-sales-2 "Large living room, 30 m2, budget 2,000 baht"`. The reply says `HP-F03 is out of stock` and offers `HP-F02` with `sized for a medium room ... not a large room`. HP-F01 is never mentioned.
- **No-Match.** Run `verify.mjs chat web-verify-sales-3 "12 m2 room, budget 500 baht"`. The reply says `costs ฿890, above your ฿500 budget`, and `actions` is `[]`.
- **SKU question.** Run `verify.mjs chat web-verify-sales-4 "Do you have HP-F03?"`. The reply says it is out of stock and asks for a budget. Then run `verify.mjs chat web-verify-sales-4 "2000"`. The reply offers HP-F02.
- **Thai.** Run `verify.mjs chat web-verify-sales-5 "ห้อง 20 ตร.ม. งบ 1500 บาท"`. The reply has `language: "th"`, contains `HP-F02` and `เหตุผล`.
- **Proof.** In `server.log`, the `turn` lines for these sessions show `decision` values `ask`, `match`, `match`, `match`, `sku`, `match`, `match`.

## Gotchas

- Budget is a hard limit. `"budget 1,389 baht"` with a medium room must not return HP-F02 (฿1,390).
- A bare number is only read as a budget when the assistant just asked for one. In a fresh session, `"1000"` gets the fallback.
- Room size boundaries: 15 m² is small, 15.5 and 16 are medium, 25 is medium, and 25.1 is large.
