# 006: The LINE webhook returns 500 and skips remaining events when one reply fails

- **Severity:** Medium
- **Spec:** §3.2 (reply adapter), §5 ("gracefully degrade … rather than crashing")
- **Path:** Live LINE mode

## Reproduce

Post a correctly signed text event with an expired or invalid `replyToken` to `/webhooks/line` while `LINE_MODE=live`.

Observed in `server.log`:

```
{"event":"turn","channel":"line","session":"line:U-claude-live-test","source":"llm","decision":"match"}
{"event":"request_failed","path":"/webhooks/line","error":"Error: line reply http 400: {\"message\":\"Invalid reply token\"} …"}
{"event":"http","path":"/webhooks/line","status":500}
```

## Expected

Log the failed reply as a warning (`line_reply_failed`, with the LINE status and message), continue with the other events in the batch, and answer LINE with 200. A reply token is single-use and expires, so a retry by LINE can never succeed. A 500 only produces delivery-error noise in the LINE console and can trigger redelivery.

## Cause

`server.ts` awaits `line.client.reply` inside the event loop without a per-event `try/catch`. The first rejection exits the loop and reaches the generic 500 handler.

## Suggested fix

Wrap each event's `respond` and `reply` in its own `try/catch` that logs and continues, and always return 200 after the signature check passes. Add a test with a reply client that throws for the first event and records the second.
