# 010: Every handoff quotes the order and damaged-delivery sentence, even for unrelated questions

- **Severity:** Low
- **Spec:** §4.2.4, "Clearly inform the user …"

## Reproduce

`Do you sell air conditioners?` (LLM, `out_of_scope`) gives:

> I'm passing this to our staff (policy SUP-02, reason: question outside what I can answer). **For order status or damaged deliveries, we pass you to staff.** This demo has no order lookup or real ticketing system. So I can't check an order …

The same happens for warranty and "talk to staff" handoffs.

## Expected

The notice should match the reason. The required transparency sentence ("This demo has no order lookup or real ticketing system") stays in every handoff.

## Cause

`render.ts` always inserts the full `POLICIES["SUP-02"].text`, which opens with the order and damaged-delivery sentence.

## Suggested fix

Split the SUP-02 record into `scope` (the order and damaged sentence) and `disclosure` (no lookup or ticketing). Render `scope` only for the `order_status` and `damaged_delivery` reasons, and `disclosure` always. Update the SUP-02 fixture test to assert on `disclosure`.
