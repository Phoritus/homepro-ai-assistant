import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseLineWebhook, toLineMessages, verifyLineSignature } from "./channels/line.ts";
import { loadConfig } from "./config.ts";
import { RateLimitedError } from "./conversation/understanding.ts";
import { createGroqUnderstander } from "./llm/groq.ts";
import { createJsonLogger, redact } from "./log.ts";

describe("LINE adapter", () => {
  const body = Buffer.from('{"events":[]}');
  const sign = (secret: string) => createHmac("sha256", secret).update(body).digest("base64");

  it("accepts only a signature made with the channel secret", () => {
    expect(verifyLineSignature(body, sign("s3cret"), "s3cret")).toBe(true);
    expect(verifyLineSignature(body, sign("other"), "s3cret")).toBe(false);
    expect(verifyLineSignature(body, "short", "s3cret")).toBe(false);
    expect(verifyLineSignature(body, undefined, "s3cret")).toBe(false);
  });

  it("keeps user text messages and ignores every other event", () => {
    expect(parseLineWebhook({
      events: [
        { type: "message", replyToken: "r1", source: { type: "user", userId: "U1" }, message: { type: "text", text: "hi" } },
        { type: "message", replyToken: "r2", source: { type: "user", userId: "U1" }, message: { type: "sticker", packageId: "1" } },
        { type: "follow", replyToken: "r3", source: { type: "user", userId: "U2" } },
      ],
    })).toEqual([{ replyToken: "r1", userId: "U1", text: "hi" }]);
    expect(parseLineWebhook({ events: [] })).toEqual([]);
    expect(parseLineWebhook({ nope: 1 })).toBeNull();
  });

  it("sends the reply text unchanged and the same links as buttons within LINE limits", () => {
    const messages = toLineMessages({
      language: "th",
      text: "ข้อความ",
      handoff: null,
      actions: [
        { kind: "view_product", sku: "HP-F01", url: "http://x/demo/products/HP-F01" },
        { kind: "demo_checkout", sku: "HP-F01", url: "http://x/demo/checkout?sku=HP-F01" },
      ],
    });
    expect(messages[0]).toEqual({ type: "text", text: "ข้อความ" });
    const template = messages[1];
    if (template?.type !== "template") throw new Error("expected buttons template");
    expect(template.template.actions.map((a) => a.uri)).toEqual(["http://x/demo/products/HP-F01", "http://x/demo/checkout?sku=HP-F01"]);
    expect(template.template.actions.every((a) => a.label.length <= 20)).toBe(true);
  });

  it("a reply with no actions is a single text message", () => {
    expect(toLineMessages({ language: "en", text: "t", actions: [], handoff: null })).toHaveLength(1);
  });
});

describe("logging", () => {
  it("redacts credential-looking fields at any depth but keeps session keys", () => {
    expect(redact({ apiKey: "a", replyToken: "b", nested: [{ authorization: "c" }], sessionKey: "web:1" })).toEqual({
      apiKey: "[redacted]", replyToken: "[redacted]", nested: [{ authorization: "[redacted]" }], sessionKey: "web:1",
    });
  });

  it("writes one JSON object per line", () => {
    const lines: string[] = [];
    createJsonLogger((l) => lines.push(l)).info("turn", { channelSecret: "x", n: 1 });
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ level: "info", event: "turn", channelSecret: "[redacted]", n: 1 });
  });
});

describe("config", () => {
  it("runs without any secrets: no LLM, no LINE", () => {
    expect(loadConfig({})).toMatchObject({ port: 3000, publicBaseUrl: "http://localhost:3000", groq: null, line: null });
  });

  it("LINE_MODE=stub keeps the webhook but never uses the access token", () => {
    const c = loadConfig({ LINE_CHANNEL_SECRET: "s", LINE_CHANNEL_ACCESS_TOKEN: "t", LINE_MODE: "stub", PUBLIC_BASE_URL: "https://x.dev/" });
    expect(c.line).toEqual({ channelSecret: "s", accessToken: null });
    expect(c.publicBaseUrl).toBe("https://x.dev");
  });
});

describe("Groq understander", () => {
  const reading = { intents: ["recommend"], asks: null, language: "en", roomAreaSqm: 12, roomSizeBand: null, budgetThb: 1000, skus: [] };
  const groq = (respond: () => Response | Promise<Response>, seen: { init?: RequestInit | undefined } = {}) =>
    createGroqUnderstander({
      apiKey: "k", model: "m", timeoutMs: 1000,
      fetch: async (_url, init) => { seen.init = init; return respond(); },
    });
  const ok = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));

  it("sends the message with the awaiting hint and returns the validated reading", async () => {
    const seen: { init?: RequestInit | undefined } = {};
    const out = await groq(() => ok(reading), seen)("12 sqm, 1000 baht", { awaiting: "budget", recentShopperMessages: ["hi"] });
    expect(out).toEqual(reading);
    const sent = JSON.parse(String(seen.init?.body));
    expect(sent).toMatchObject({ model: "m", temperature: 0, response_format: { type: "json_schema", json_schema: { name: "reading", strict: true } } });
    expect(sent.response_format.json_schema.schema.properties.intents).toMatchObject({ minItems: 1 });
    expect(sent).not.toHaveProperty("reasoning_effort");
    expect(JSON.parse(sent.messages[1].content)).toEqual({ awaiting: "budget", earlierMessages: ["hi"], message: "12 sqm, 1000 baht" });
  });

  it.each([
    ["openai/gpt-oss-20b", "medium"],
    ["openai/gpt-oss-120b", "medium"],
    ["qwen/qwen3.8-27b", "none"],
  ])("sets reasoning_effort for %s to %s", async (model, effort) => {
    const seen: { init?: RequestInit | undefined } = {};
    const understand = createGroqUnderstander({
      apiKey: "k", model, timeoutMs: 1000,
      fetch: async (_url, init) => { seen.init = init; return ok(reading); },
    });
    await understand("x", { awaiting: null, recentShopperMessages: [] });
    expect(JSON.parse(String(seen.init?.body))).toMatchObject({ model, reasoning_effort: effort });
  });

  it.each([
    ["HTTP error", () => new Response("server error", { status: 500 })],
    ["non-JSON content", () => new Response(JSON.stringify({ choices: [{ message: { content: "sure! {" } }] }))],
    ["schema mismatch", () => ok({ ...reading, intents: ["buy_now"] })],
    ["no choices", () => new Response("{}")],
    ["empty intents", () => ok({ ...reading, intents: [] })],
  ] as const)("throws on %s so the caller falls back", async (_label, respond) => {
    await expect(groq(respond)("x", { awaiting: null, recentShopperMessages: [] })).rejects.toThrow();
  });

  describe("on 429", () => {
    const limited = (retryAfter?: string) =>
      new Response("rate limited", { status: 429, headers: retryAfter === undefined ? {} : { "retry-after": retryAfter } });
    const sequence = (responses: (() => Response)[], timeoutMs = 1000) => {
      let calls = 0;
      const understand = createGroqUnderstander({
        apiKey: "k", model: "m", timeoutMs,
        fetch: async () => (responses[calls++] ?? responses.at(-1)!)(),
      });
      return { understand, calls: () => calls };
    };
    const ctx = { awaiting: null, recentShopperMessages: [] };

    it("retries once after retry-after and returns the reading", async () => {
      const g = sequence([() => limited("0"), () => ok(reading)]);
      await expect(g.understand("x", ctx)).resolves.toEqual(reading);
      expect(g.calls()).toBe(2);
    });

    it("throws RateLimitedError with the wait when the retry is limited too", async () => {
      const g = sequence([() => limited("0"), () => limited("7")]);
      const err = await g.understand("x", ctx).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RateLimitedError);
      expect(err).toMatchObject({ retryAfterMs: 7000 });
      expect(g.calls()).toBe(2);
    });

    it("does not retry when the wait would not fit inside the timeout", async () => {
      const g = sequence([() => limited("5"), () => ok(reading)], 1000);
      await expect(g.understand("x", ctx)).rejects.toBeInstanceOf(RateLimitedError);
      expect(g.calls()).toBe(1);
    });
  });
});
