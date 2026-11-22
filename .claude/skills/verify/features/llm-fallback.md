# LLM failure fallback

When the Groq LLM is not configured, fails, times out, or returns output that fails the schema, the assistant keeps answering from its keyword rules. Facts still come from the fixtures. A message the rules can't read gets a safe fallback message, not a crash and not a made-up answer.

## Sub-features

- `fallback-unknown` gives an unreadable message the fallback text listing what the assistant can do, with no handoff.
- `fallback-sales` still answers a clear sales message correctly without the LLM.
- `llm-live` reads messages with Groq when configured (`llm_ok` in the log).
- `llm-outage` falls back on a live instance when Groq is unreachable.

## How to get to it (user POV)

- Any chat message. The shopper never chooses the mode. It depends on server configuration and Groq's health.

## Driving it with verify.mjs

Preconditions:

- `fallback-*`: baseline instance (keyword mode, which is the same path as an LLM failure).
- `llm-live`: `GROQ_API_KEY` is set in `.env`. Start with `verify.mjs start --llm`, and `doctor` shows `groq:<model>`.
- `llm-outage`: as for `llm-live`, but set `GROQ_API_KEY=invalid` in the environment before `start --llm`.

- **Unknown message.** Run `verify.mjs chat web-verify-fb-1 "Tell me something interesting"`. The reply starts `Sorry, I can't process that right now`, with `handoff: null` and `actions: []`.
- **Sales without LLM.** Run `verify.mjs chat web-verify-fb-2 "12 m2 room, budget 1,000 baht"`. The reply recommends HP-F01.
- **LLM live.** On an `--llm` instance, run `verify.mjs chat web-verify-llm-1 "my bedroom is about twelve square metres and I can spend a thousand baht"`. `server.log` shows `llm_ok` and a `turn` with `source: "llm"`. The reply recommends HP-F01.
- **LLM outage.** On an `--llm` instance with an invalid key, run the same message as `fallback-sales`. `server.log` shows `llm_failed` (HTTP 401), then a `turn` with `source: "rules"`, and the reply still recommends HP-F01.

## Gotchas

- Off-topic messages (weather, jokes) get a `redirect` decision with no handoff, not a handoff. A message no keyword rule matches gets the fallback in keyword mode but may be read as `off_topic` by the LLM. Assert per mode.
- `npm test` covers outage and invalid output against a fake Groq API. Only an `--llm` run proves the real API and model name work.
- An `llm_failed` with `groq http 404` on every turn means the model was retired. `llama-3.1-8b-instant` was, which is why the default is now `openai/gpt-oss-20b`. List the models available to the key with `GET https://api.groq.com/openai/v1/models`.
- A passing `--llm` scenario run alone proves nothing, because the keyword fallback passes the same scenarios. `npm run scenarios -- --llm` now fails unless every real Groq call succeeded. In a live run, check for `llm_ok` lines.
