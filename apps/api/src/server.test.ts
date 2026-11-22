import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createAssistant, MAX_MESSAGE_CHARS } from "./assistant.ts";
import type { LineMessage, LineReplyClient } from "./channels/line.ts";
import { createMemorySessionStore } from "./conversation/session.ts";
import type { Understander } from "./conversation/understanding.ts";
import type { Logger } from "./log.ts";
import { createHttpServer } from "./server.ts";

const SECRET = "test-secret";

function recordingLogger() {
  const lines: { level: string; event: string; fields: Record<string, unknown> }[] = [];
  const at = (level: string) => (event: string, fields: Record<string, unknown> = {}) => void lines.push({ level, event, fields });
  const log: Logger = { info: at("info"), warn: at("warn"), error: at("error") };
  return { log, lines };
}

const textEvent = (replyToken: string, userId: string, text: string) =>
  ({ type: "message", replyToken, source: { type: "user", userId }, message: { type: "text", text } });

let close: (() => void) | undefined;
afterEach(() => close?.());

async function start(client: LineReplyClient, log: Logger, llm: Understander | null = null) {
  const assistant = createAssistant({ sessions: createMemorySessionStore(60_000), llm, log, baseUrl: "http://demo.test" });
  const server = createHttpServer({ assistant, log, line: { channelSecret: SECRET, client } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  close = () => server.close();
  const { port } = server.address() as AddressInfo;
  return async (events: unknown[]) => {
    const body = JSON.stringify({ events });
    return fetch(`http://127.0.0.1:${port}/webhooks/line`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-line-signature": createHmac("sha256", SECRET).update(body).digest("base64") },
      body,
    });
  };
}

describe("LINE webhook", () => {
  it("answers 200 and still replies to later events when one reply fails", async () => {
    const delivered: { replyToken: string; messages: LineMessage[] }[] = [];
    const client: LineReplyClient = {
      async reply(replyToken, messages) {
        if (replyToken === "expired") throw new Error('line reply http 400: {"message":"Invalid reply token"}');
        delivered.push({ replyToken, messages });
      },
    };
    const { log, lines } = recordingLogger();
    const post = await start(client, log);

    const res = await post([textEvent("expired", "U1", "hi"), textEvent("fresh", "U2", "Can I return my fan?")]);

    expect(res.status).toBe(200);
    expect(delivered.map((d) => d.replyToken)).toEqual(["fresh"]);
    expect(lines).toContainEqual(expect.objectContaining({ level: "warn", event: "line_reply_failed", fields: expect.objectContaining({ error: expect.stringContaining("Invalid reply token") }) }));
    expect(lines.some((l) => l.event === "request_failed")).toBe(false);
  });

  it("applies the same message length limit as Web Chat before the LLM sees the text", async () => {
    const seen: string[] = [];
    const llm: Understander = async (text) => {
      seen.push(text);
      return { intents: ["greeting"], asks: null, language: "en", roomAreaSqm: null, roomSizeBand: null, budgetThb: null, skus: [], opener: null };
    };
    const delivered: string[] = [];
    const { log, lines } = recordingLogger();
    const post = await start({ async reply(token) { delivered.push(token); } }, log, llm);

    const res = await post([textEvent("r1", "U1", "a".repeat(5000))]);

    expect(res.status).toBe(200);
    expect(MAX_MESSAGE_CHARS).toBe(1000);
    expect(seen).toEqual(["a".repeat(MAX_MESSAGE_CHARS)]);
    expect(delivered).toEqual(["r1"]);
    expect(lines).toContainEqual(expect.objectContaining({ event: "message_truncated", fields: expect.objectContaining({ length: 5000 }) }));
  });
});

describe("Web Chat history", () => {
  it("returns the session's turns so a reloaded page can show them, and nothing for an unknown or invalid id", async () => {
    const { log } = recordingLogger();
    const assistant = createAssistant({ sessions: createMemorySessionStore(60_000), llm: null, log, baseUrl: "http://demo.test" });
    const server = createHttpServer({ assistant, log, line: null });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    close = () => server.close();
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const history = (id: string) => fetch(`${base}/api/chat/history?sessionId=${id}`);

    const chat = (message: string) => fetch(`${base}/api/chat`, { method: "POST", body: JSON.stringify({ sessionId: "web-reload-1", message }) });
    await chat("I need a fan for my 12 m² bedroom");
    await chat("My budget is 1,000 baht");
    await chat("Where is my order?");

    const res = await history("web-reload-1");
    expect(res.status).toBe(200);
    const { turns } = (await res.json()) as { turns: unknown[] };
    expect(turns).toEqual([
      { role: "shopper", text: "I need a fan for my 12 m² bedroom" },
      { role: "assistant", text: expect.stringContaining("budget"), language: "en", actions: [], handedOff: false },
      { role: "shopper", text: "My budget is 1,000 baht" },
      {
        role: "assistant",
        text: expect.stringContaining("HP-F01"),
        language: "en",
        actions: [
          { kind: "view_product", sku: "HP-F01", url: "http://demo.test/demo/products/HP-F01" },
          { kind: "demo_checkout", sku: "HP-F01", url: "http://demo.test/demo/checkout?sku=HP-F01" },
        ],
        handedOff: false,
      },
      { role: "shopper", text: "Where is my order?" },
      { role: "assistant", text: expect.stringContaining("staff"), language: "en", actions: [], handedOff: true },
    ]);
    expect(await (await history("web-other-1")).json()).toEqual({ turns: [] });
    expect((await history("no")).status).toBe(400);
  });
});
