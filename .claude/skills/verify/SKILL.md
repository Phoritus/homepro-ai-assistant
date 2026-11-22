---
name: verify
description: Launch and drive the HomePro AI Assistant (fan-shop chat backend serving Web Chat and a LINE webhook) over its real HTTP surface and capture evidence. Use after any code change in apps/api or packages/shared, before reporting it done, or to prove a sales, support, handoff, LINE or LLM-fallback behavior actually works.
---

# Verify the HomePro AI Assistant

The app is one Node HTTP server (`apps/api/src/main.ts`). Users reach it in two ways. Web Chat is the page at `/`, which calls `POST /api/chat`. LINE calls `POST /webhooks/line`. Both go through the same assistant, so driving the HTTP endpoints exercises the same code a user's message hits. Everything goes through one helper:

```sh
node .claude/skills/verify/scripts/verify.mjs <command> [--port N]
```

Run it from the repo root. The default port is `3299`. Every command accepts `--port N`, so two runs can work side by side on different ports. Each port has its own state file at `.verify-run/<port>.json`.

## Launch

```sh
node .claude/skills/verify/scripts/verify.mjs start          # keyword rules, LINE stub
node .claude/skills/verify/scripts/verify.mjs start --llm    # also use Groq from .env (needs GROQ_API_KEY)
```

`start` runs `node apps/api/src/main.ts` detached, with `PORT`, `PUBLIC_BASE_URL=http://127.0.0.1:<port>`, `LINE_CHANNEL_SECRET=verify-line-secret` and `LINE_MODE=stub`. Without `--llm` it blanks `GROQ_API_KEY`, so results are deterministic. The instance is ready when the server log contains the `server_started` JSON line. `start` waits up to 10 s for it and prints `"ready": true` along with the `llm` and `line` modes. There is no database or seed step. The catalog and policies are compiled-in fixtures, and sessions start empty in memory.

`start` refuses to launch if a verify instance is already on that port, or if anything else answers on the port. Don't drive the user's own `npm start` instance on port 3000.

## Doctor

```sh
node .claude/skills/verify/scripts/verify.mjs doctor
```

This check is read-only. It requires that the PID this run started is alive, that `GET /health` returns `{"ok":true,"line":true}`, and that the `server_started` line reports this port. It prints the LLM mode (`off (keyword rules only)` or `groq:<model>`) and exits 1 if anything is off. Run it first whenever a result looks wrong.

## Drive

| Command | What it does | Prints |
| :-- | :-- | :-- |
| `chat <sessionId> <text>` | `POST /api/chat` the way the Web Chat page does. Reusing a sessionId continues that conversation | HTTP status and the `AssistantReply` (`language`, `text`, `actions`, `handoff`) |
| `line <userId> <text>` | Posts an HMAC-signed LINE text-message event to `/webhooks/line` | HTTP status and the LINE reply payload captured from the server log (`line_reply_stubbed`) |
| `get <path>` | GET a page, such as `demo/products/HP-F01` or `"demo/checkout?sku=HP-F01"` | Status and the page's visible text |

The sessionId must match `^[\w-]{8,100}$`, or the server answers 400. Use a fresh sessionId or userId per journey, because sessions remember room size and budget.

Web Chat page handles, for a browser harness when one is available: input `#input`, send button `#send`, assistant bubbles `.msg.assistant`, link buttons `.actions a` (checkout has class `primary`), handoff note `.handoff`, sample chips `#chips button`. The HTTP drive proves the reply. Only a browser run proves the page renders it.

## Evidence

Each `start` creates `.verify-evidence/<timestamp>-<port>/` with these files:

- `server.log` is the server's JSON log: `http`, `turn` (intent, source, decision), `llm_ok` / `llm_failed`, `handoff_packet`, and `line_reply_stubbed` with the full payload.
- `transcript.jsonl` has one line per `chat`, `line` or `get` call, holding what was sent and what came back.

Proof standards:

- Drive the public endpoints only. Don't import modules or call internals to "prove" a journey.
- Capture both the action and the result. For multi-turn journeys, show every turn in `transcript.jsonl`.
- Check side effects alongside replies. A handoff must produce a `handoff_packet` log line, and a LINE message must produce a `line_reply_stubbed` payload.
- The LINE stub is the production boundary to LINE's servers. It proves the payload, not delivery. Never report live LINE delivery as verified from a stub run.
- Without `--llm` the understanding comes from keyword rules. A claim about LLM behavior needs a `start --llm` run whose `doctor` shows `groq:<model>`, plus `llm_ok` lines in `server.log`.

## Cleanup

```sh
node .claude/skills/verify/scripts/verify.mjs stop
```

This kills only the PID recorded in `.verify-run/<port>.json`, then deletes that state file. The evidence directory is kept. Never kill `node` by name, because the user may have their own server running. If a failed run left a state file whose PID is dead, `stop` still removes the file.

## Gotchas

- **Git Bash path rewriting.** Git Bash on Windows turns arguments that start with `/` into Windows paths (`/demo/x` becomes `C:/Program Files/Git/demo/x`). Pass page paths without the leading slash. `get` adds it.
- **curl and Thai text.** On Windows, curl's command-line arguments can garble Thai text. The helper sends UTF-8 correctly, so use it (or `--data-binary @file.json`) for Thai messages.
- **Restarts forget sessions.** Sessions are in-memory, so a restart forgets every conversation. Multi-turn journeys must run against one instance.
- **Unknown messages and the LLM.** In keyword mode, an unrecognised message gets the fallback text, not a handoff. With the LLM, the same message is handed off as `out_of_scope`. Assert per mode.

## Feature map

See [features/README.md](features/README.md) for the journeys to drive per feature.
