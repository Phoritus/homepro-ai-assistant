# HomePro AI Assistant

A demo omnichannel assistant (Web Chat and LINE OA) that recommends fans from a fictional catalog and answers post-purchase questions from fixed policy records, handing off to staff when it can't.

## Language

### Sales

**Shopper**:
A person talking to the assistant on either channel, whether they're buying or asking for support.
_Avoid_: User, customer, client

**Room Size Band**:
One of Small (≤ 15 m²), Medium (16–25 m²) or Large (> 25 m²). Every product fits exactly one band, and every shopper's room resolves to one.
_Avoid_: Room type, fan size

**Budget**:
The maximum price in THB that a shopper says they are willing to pay. It is a hard limit: nothing priced above it is ever recommended.
_Avoid_: Price range, spend

**Valid Match**:
An in-stock product whose Room Size Band equals the shopper's band and whose price is at or below Budget.
_Avoid_: Suggestion, result

**Alternative**:
An in-stock product within Budget from the closest other Room Size Band (the larger neighbour first, then the smaller), offered only when no Valid Match exists. The size mismatch is always stated.
_Avoid_: Upsell, substitute

**No-Match**:
The outcome when there is neither a Valid Match nor an Alternative.

### Service

**Policy Record**:
One of the fixed support rules (`SUP-01`, `SUP-02`) that is the only allowed source for support answers.
_Avoid_: FAQ, rule

**Handoff**:
Escalating a conversation to human staff. In this demo it produces a Handoff Packet and creates no real ticket.
_Avoid_: Ticket, transfer

**Handoff Packet**:
The structured summary of a conversation that a human agent receives when a Handoff occurs.
_Avoid_: Ticket, case
