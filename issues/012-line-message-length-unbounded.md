# 012: LINE text has no length limit (Web caps at 1,000 characters)

- **Severity:** Low
- **Spec:** §5 (robustness), §1 (identical rules on both channels)

## Observed

`server.ts` validates Web input with `z.string().trim().min(1).max(1000)`. LINE input in `channels/line.ts` is `text: z.string()` with no limit, so a long LINE message is sent to Groq whole. LINE allows up to 5,000 characters. That costs tokens and adds rate-limit pressure, and it means the two channels apply different input rules.

## Expected

The same limit on both channels, enforced in one place.

## Suggested fix

Move the limit into `assistant.respond` (or a shared `MAX_MESSAGE_CHARS`). Either truncate with a note, or reply with a short "message too long" template. Use the same behavior for both channels.
