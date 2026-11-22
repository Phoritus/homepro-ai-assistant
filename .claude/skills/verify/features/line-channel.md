# LINE channel

A LINE user messages the Official Account, and the assistant replies with the same text and the same next-step links as Web Chat. The links come as a buttons template. Requests without a valid LINE signature are rejected.

## Sub-features

- `line-reply` turns a text message into a reply payload: a text message, plus a buttons template when there are links.
- `line-parity` gives the same question the same text and links as Web Chat.
- `line-signature` rejects a bad or missing `X-Line-Signature` with 401.
- `line-session` keeps LINE sessions separate from Web sessions, even with the same id.

## How to get to it (user POV)

- Send a text message to the LINE OA. In verification, use a signed synthetic webhook event, because live delivery needs real credentials and a public HTTPS URL.

## Driving it with verify.mjs

Preconditions:

- Baseline instance (LINE stub with secret `verify-line-secret`).

- **Reply payload.** Run `verify.mjs line U-verify-line-1 "Large living room, 30 m2, budget 2,000 baht"`. The status is 200. `captured[0]` has a `text` message offering HP-F02 and a `template` whose `actions[].uri` are `/demo/products/HP-F02` and `/demo/checkout?sku=HP-F02`, each label 20 characters or fewer.
- **Parity.** Run `verify.mjs chat web-verify-line-1 "Large living room, 30 m2, budget 2,000 baht"`. `reply.text` equals the LINE text message exactly, and the `reply.actions[].url` values equal the LINE `uri` values in order.
- **Separate sessions.** Run `verify.mjs line U-verify-line-2 "12 m2 room"`, then `verify.mjs chat U-verify-line-2 "budget 1000 baht"`. Web asks for the room size, which shows it didn't inherit LINE's room size.
- **Proof.** `transcript.jsonl` shows both calls, and `server.log` has `line_reply_stubbed` with the payload and `turn` lines with `channel: "line"`.

## Gotchas

- Bad signatures can't be produced through `verify.mjs`, which always signs. Use the scenario test (`npm test`) or a raw POST with a wrong `x-line-signature` to see the 401.
- A stub run proves the payload only. Live delivery to the LINE app is unverified until the README's "Connecting LINE live" steps are run with real credentials.
