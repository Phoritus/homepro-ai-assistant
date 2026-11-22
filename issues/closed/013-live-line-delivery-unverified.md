# 013: Live LINE delivery is unverified because "Use webhook" is off

- **Status:** Closed 2026-11-22. The owner sent real messages from the LINE app to **Test Assistant** and the server's reply arrived. Remaining setup: turn off LINE's built-in Greeting and Auto-response in LINE Official Account Manager so only the bot replies.
- **Severity:** Blocker for §3.2 "live interaction" and §6.5 parity on real LINE (setup, not code)
- **Owner:** Project owner (needs the LINE console and a phone)

## Verified on 2026-11-22

| Check | Result |
| :-- | :-- |
| Access token valid | `GET /v2/bot/info` returned 200, bot "Test Assistant", `chatMode: bot` |
| Webhook URL registered | Set through the API to `https://nonaccented-centered-janis.ngrok-free.dev/webhooks/line` |
| Inbound path (LINE → ngrok → server, real signature) | `POST /v2/bot/channel/webhook/test` returned `success: true, statusCode: 200`. The server logged `POST /webhooks/line 200` |
| Outbound auth (server → LINE reply API) | Real token accepted. LINE answered `Invalid reply token` for the synthetic token, which means auth passed |

## Not verified

- **"Use webhook" is OFF.** `GET /v2/bot/channel/webhook/endpoint` returns `"active": false`, so LINE won't forward real chats. LINE's API can't turn this on.
- No real user message has been sent from the LINE app.

## Setup mismatch found

The ngrok tunnel forwards to `http://localhost:8080`, but `.env` has no `PORT`, so `npm start` listens on 3000 and the tunnel reaches nothing. Either add `PORT=8080` to `.env`, or restart ngrok with `ngrok http 3000`.

## To close

1. In the LINE Developers console, open the channel's **Messaging API** tab and turn **Use webhook** ON.
2. Run the server on the port ngrok forwards to (see above).
3. Scan the channel's QR code with your phone and add the bot as a friend.
4. Send `I need a fan for my 12 m² bedroom`, then `1000 baht`. Expect HP-F01 with two buttons. Send `Where is my order?` and expect the SUP-02 notice.
5. Confirm that `server.log` shows `turn` lines with `"channel":"line"` and no `request_failed` lines.
6. Update the README's "live LINE delivery is unverified" line and the scenario-5 note.
