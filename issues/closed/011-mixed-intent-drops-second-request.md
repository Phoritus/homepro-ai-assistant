# 011: A message with two requests answers only one

- **Status:** Closed 2026-11-22 on branch `feat/intent-routing`, not yet merged to main (`6b14573`). Understandings carry an ordered `intents` list and each intent runs its route; a handoff keeps a match from the same message. Live: the reproduce input returned the order handoff plus HP-F01.
- **Severity:** Low
- **Spec:** §4.1 and §4.2 (each request type should be served)

## Reproduce

`Where is my order? Also recommend a fan for 12 sqm under 1000` gives an order-status handoff only. The fan request is dropped. The slots are kept in the Handoff Packet (`roomSizeBand: small`, `budgetThb: 1000`), but the shopper gets no recommendation and isn't told it was skipped.

## Expected

Either answer both (the handoff notice plus the HP-F01 recommendation), or answer one and say the other will be handled next.

## Suggested fix

Simplest: after a handoff, if the turn also carries a complete sales request (room size and budget known), append the match block to the reply. Otherwise list this in the README's known limits.
