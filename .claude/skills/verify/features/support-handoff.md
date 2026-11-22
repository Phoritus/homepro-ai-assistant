# Support and handoff

A shopper asking about returns gets the SUP-01 policy, which never promises approval. A shopper asking about an order, a damaged delivery, a warranty, or for a person is handed to staff under SUP-02. They are told the demo has no order lookup or real ticketing, and staff get a structured handoff packet.

## Sub-features

- `support-returns` answers with SUP-01: 14 days, unopened, proof of purchase, approval not guaranteed.
- `handoff-order` hands off an order-status question with reason `order_status`.
- `handoff-damaged` hands off a damaged delivery with reason `damaged_delivery`.
- `handoff-warranty` hands off a warranty question with reason `uncovered_warranty`.
- `handoff-staff` hands off an explicit request for a person with reason `shopper_request`.
- `handoff-packet` gives staff the channel, reason, language, known room size, budget and SKUs, and the last messages.

## How to get to it (user POV)

- Web Chat: type a returns or order question, or press the `Can I return a fan?` or `Where is my order?` chips.
- LINE: send the same text to the OA.

## Driving it with verify.mjs

Preconditions:

- Baseline instance, keyword mode.

- **Returns.** Run `verify.mjs chat web-verify-support-1 "Can I return a fan I bought last week?"`. The reply contains `SUP-01`, `14 days`, `unopened`, `proof of purchase` and `not guaranteed`, and `handoff` is `null`.
- **Order handoff with context.** Run `verify.mjs chat web-verify-support-2 "12 m2 room, budget 1000 baht"`, then `verify.mjs chat web-verify-support-2 "Where is my order #A1234?"`. The reply contains `no order lookup or real ticketing`, invents no status, and doesn't contain the `handoffId`. `handoff.reason` is `order_status`, and `handoff.knownContext` has `roomSizeBand: "small"` and `budgetThb: 1000`.
- **Damaged, warranty, staff.** Run `verify.mjs chat web-verify-support-3 "My fan arrived damaged"`, `verify.mjs chat web-verify-support-4 "Is there a 3-year warranty?"` and `verify.mjs chat web-verify-support-5 "I want to talk to staff"`. Each has a non-null `handoff`, with reason `damaged_delivery`, `uncovered_warranty` and `shopper_request` respectively.
- **Proof.** `server.log` has one `handoff_packet` line per handoff, whose `packet.handoffId` matches the reply's `handoff.handoffId`.

## Gotchas

- The shopper-facing text must never include the `handoffId`. Check the text, not just the packet.
- An order number in the message (`#A1234`) must not be echoed back as if it had been looked up.
