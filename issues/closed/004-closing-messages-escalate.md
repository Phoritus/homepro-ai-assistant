# 004: "Thanks" and "bye" trigger a re-greeting or a staff handoff

- **Status:** Closed 2026-11-22 on branch `feat/intent-routing`, not yet merged to main (`6b14573`). New `closing` intent and route reply "You're welcome!" with no handoff and no packet. Live: `thank you!` with Groq on.
- **Severity:** Medium
- **Spec:** §4.2.3 (handoff is for queries outside the data, and a sign-off is not a query). Also affects the pilot KPI, because every sign-off is counted as a handoff
- **Path:** LLM

## Reproduce

| Input | Observed |
| :-- | :-- |
| `thanks, that's all` | Full SUP-02 handoff (`out_of_scope`), and a Handoff Packet is sent to staff |
| `ok bye` | Same |
| `thank you!` | Greeting again: "Hi! I'm the Demo Store assistant … What size is your room …" |

## Expected

A short closing reply ("You're welcome! Message any time.") with no handoff and no packet.

## Cause

There is no closing intent. The LLM labels sign-offs `other` (which leads to a handoff) or `greeting` (which leads to the opening prompt).

## Suggested fix

Add an intent `closing` to `INTENTS`, the prompt, the keyword rules (`thanks`, `thank you`, `bye`, `ขอบคุณ`, `บาย`) and the templates (TH and EN). The engine should keep the session's known context and reply without a handoff.
