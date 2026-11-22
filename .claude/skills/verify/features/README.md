# HomePro assistant verification map

This directory is the maintained source for verifying the user-facing behavior of the HomePro AI Assistant. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- An instance started by `node .claude/skills/verify/scripts/verify.mjs start` (port 3299 unless `--port` is given).
- `verify.mjs doctor` exits 0 and reports `line: stub (replies captured, not delivered)`.
- LLM mode is `off (keyword rules only)` unless the feature says `--llm`.
- Fixtures are compiled in: HP-F01 ฿890 small room, 3 in stock. HP-F02 ฿1,390 medium room, 2 in stock. HP-F03 ฿1,790 large room, out of stock.
- Never drive an instance this run did not start.

## Driving conventions

- Use a new sessionId (Web) or userId (LINE) per journey, such as `web-verify-<feature>-<n>`.
- Treat the quoted messages as literal. The keyword rules depend on the wording.
- Use `verify.mjs` for every call, never raw curl. See the Git Bash and Thai gotchas in SKILL.md.

## Proof and skip reporting

- Proof is the `transcript.jsonl` lines for the journey plus the matching `server.log` events (`turn`, `handoff_packet`, `line_reply_stubbed`).
- Record the feature ID and entry point (Web or LINE) with every claim.
- A journey that can't run (for example, `--llm` with no `GROQ_API_KEY`) is reported as skipped, with the unmet precondition. Never report it as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then has four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify.mjs`, and `Gotchas`.

## Features

- [Fan recommendation](./sales-recommendation.md) covers multi-turn discovery, Valid Match, Alternative, No-Match and SKU questions.
- [Support and handoff](./support-handoff.md) covers SUP-01 returns and SUP-02 handoffs with the staff packet.
- [LINE channel](./line-channel.md) covers the signed webhook, the reply payload, and parity with Web Chat.
- [Demo product and checkout pages](./demo-pages.md) covers the links the assistant sends.
- [LLM failure fallback](./llm-fallback.md) covers the behavior when Groq is missing, down or returns bad output.
