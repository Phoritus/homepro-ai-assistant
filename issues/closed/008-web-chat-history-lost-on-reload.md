# 008: Web Chat loses the visible history on reload while the server keeps the context

- **Status:** Closed 2026-11-22 on branch `fix/issues-008-015`. `GET /api/chat/history?sessionId=…` returns the live session's turns (role and text). The page renders them on load, and a "New chat" button rotates the `sessionId`. Checked in headless Chrome: the turns survive a reload, and New chat stays empty after another reload.
- **Severity:** Medium
- **Spec:** §3.1, "Build a lightweight browser-based chat interface displaying conversation history". §1, session memory
- **Path:** Web Chat page

## Reproduce

1. Open `/` and send `I need a fan for my 12 m² bedroom`. The bot asks for the budget.
2. Reload the page. The chat area is empty again, showing only the static welcome bubble.
3. Send `1000`. The bot answers with HP-F01, using the room size from step 1 that the shopper can no longer see.

## Expected

After a reload the page shows the earlier turns of the same session, because the server still holds them for 30 minutes.

## Cause

`public/index.html` keeps `sessionId` in `localStorage` but has no way to load past turns, and the server has no route that returns them (routes are `/`, `/health`, `/api/chat`, `/webhooks/line`, `/demo/*`).

## Suggested fix

Add `GET /api/chat/history?sessionId=…`, which returns `session.history` (text and role only, validated like `/api/chat`). Render it on page load. Add a "New chat" button that rotates the `sessionId`.
