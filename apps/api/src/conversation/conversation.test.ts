import { describe, expect, it } from "vitest";
import { handleTurn } from "./engine.ts";
import { createMemorySessionStore, newSession, type Session } from "./session.ts";
import { understandByKeywords, type Understanding } from "./understanding.ts";

const BASE = "http://demo.test";
const NOW = new Date("2026-11-22T10:00:00Z");

const reading = (partial: Partial<Understanding>): Understanding => ({
  intents: ["unclear"], asks: null, language: "en", roomAreaSqm: null, roomSizeBand: null, budgetThb: null, skus: [], opener: null, ...partial,
});

function chat() {
  let session: Session = newSession("web", "u1", NOW);
  return (text: string, injected?: Understanding) => {
    const understanding = injected ?? understandByKeywords(text, { awaiting: session.awaiting, recentShopperMessages: [] });
    const result = handleTurn({ session, text, understanding, now: NOW, newHandoffId: () => "H-1", baseUrl: BASE });
    session = result.session;
    return result;
  };
}

describe("keyword understander", () => {
  it.each([
    ["My bedroom is 12 sqm", { intents: ["recommend"], roomAreaSqm: 12 }],
    ["budget 1,500 baht", { intents: ["recommend"], budgetThb: 1500 }],
    ["ห้องนอน 20 ตร.ม. งบ 1500 บาท", { intents: ["recommend"], language: "th", roomAreaSqm: 20, budgetThb: 1500 }],
    ["Is hp-f03 available?", { intents: ["product_info"], asks: "stock", skus: ["hp-f03"] }],
    ["Can I return a fan I bought?", { intents: ["return_policy"] }],
    ["Where is my order?", { intents: ["order_status"] }],
    ["The fan arrived damaged", { intents: ["damaged_delivery"] }],
    ["Does it have a 5 year warranty?", { intents: ["warranty"] }],
    ["What's the weather tomorrow?", { intents: ["off_topic"] }],
    ["What is the capital of France?", { intents: ["unclear"] }],
    ["12 sqm room, budget -500 baht", { intents: ["recommend"], roomAreaSqm: 12, budgetThb: -500 }],
    ["budget −500", { intents: ["recommend"], budgetThb: -500 }],
    ["budget 1000-1500 baht", { intents: ["recommend"], budgetThb: 1500 }],
  ] as const)("%s", (text, expected) => {
    expect(understandByKeywords(text, { awaiting: null, recentShopperMessages: [] })).toMatchObject(expected);
  });

  it("reads a bare number as whatever the assistant is waiting for", () => {
    expect(understandByKeywords("1500", { awaiting: "budget", recentShopperMessages: [] })).toMatchObject({ intents: ["recommend"], budgetThb: 1500 });
    expect(understandByKeywords("18", { awaiting: "room_size", recentShopperMessages: [] }).roomAreaSqm).toBe(18);
    expect(understandByKeywords("1500", { awaiting: null, recentShopperMessages: [] })).toMatchObject({ intents: ["unclear"], budgetThb: null });
  });
});

describe("sales flow", () => {
  it("remembers room size across turns and recommends the exact SKU once Budget arrives", () => {
    const say = chat();
    const first = say("I need a fan for my 12 sqm bedroom");
    expect(first.decisions).toMatchObject([{ kind: "ask", missing: "budget" }]);
    expect(first.reply.text).not.toMatch(/What size/);

    const second = say("1000");
    expect(second.reply.text).toContain("HP-F01");
    expect(second.reply.text).toContain("฿890");
    expect(second.reply.text).toMatch(/Reason: .*small room.*฿1,000 budget/);
    expect(second.reply.actions).toEqual([
      { kind: "view_product", sku: "HP-F01", url: `${BASE}/demo/products/HP-F01` },
      { kind: "demo_checkout", sku: "HP-F01", url: `${BASE}/demo/checkout?sku=HP-F01` },
    ]);
  });

  it("never re-asks a slot it already knows", () => {
    const say = chat();
    say("budget 2000 baht");
    expect(say("my room is 30 m2").decisions).toMatchObject([{ kind: "match" }]);
  });

  it("large room: says HP-F03 is out of stock and names the size mismatch of HP-F02", () => {
    const { reply } = chat()("Large living room, 30 sqm, budget 2000 baht");
    expect(reply.text).toMatch(/HP-F03 is out of stock/);
    expect(reply.text).toMatch(/HP-F02.*sized for a medium room.*not a large room/);
    expect(reply.text).not.toContain("HP-F01");
  });

  it("asking for HP-F03 without a Budget states the stock fact and asks for Budget, then offers HP-F02", () => {
    const say = chat();
    const first = say("Do you have HP-F03?");
    expect(first.reply.text).toMatch(/HP-F03 .*out of stock\. What's your budget/);
    expect(first.reply.actions).toEqual([]);
    expect(say("2000").reply.text).toMatch(/HP-F02/);
  });

  it("a negative budget is invalid: it asks for the budget instead of reading ฿500", () => {
    const { reply, decisions } = chat()("12 sqm room, budget -500 baht");
    expect(decisions).toMatchObject([{ kind: "ask", missing: "budget" }]);
    expect(reply.text).not.toContain("฿500");
  });

  it("No-Match states the floor price and recommends nothing", () => {
    const { reply } = chat()("12 sqm room, budget 500 baht");
    expect(reply.text).toMatch(/costs ฿890, above your ฿500 budget/);
    expect(reply.actions).toEqual([]);
  });

  it("answers in Thai when the shopper writes Thai", () => {
    const { reply } = chat()("ห้อง 20 ตร.ม. งบ 1500 บาท");
    expect(reply.language).toBe("th");
    expect(reply.text).toContain("HP-F02");
    expect(reply.text).toContain("เหตุผล");
  });
});

describe("service flow", () => {
  it("returns cite SUP-01 rules and never promise approval", () => {
    const { reply, decisions } = chat()("Can I return my fan?");
    expect(decisions).toEqual([{ kind: "policy", policyId: "SUP-01" }]);
    expect(reply.text).toMatch(/SUP-01.*14 days.*proof of purchase/);
    expect(reply.text).toMatch(/not guaranteed/);
    expect(reply.text).not.toMatch(/\bwill be (approved|refunded)\b/i);
    expect(reply.handoff).toBeNull();
  });

  it.each([
    ["Where is my order #12345?", "order_status"],
    ["My fan arrived broken", "damaged_delivery"],
    ["Is there a 3-year warranty?", "uncovered_warranty"],
    ["I want to talk to staff", "shopper_request"],
  ] as const)("%s hands off (%s) without inventing a status or ticket", (text, reason) => {
    const { reply } = chat()(text);
    expect(reply.text).toMatch(/no order lookup or real ticketing/);
    expect(reply.text).not.toMatch(/H-1|shipped|in transit|delivered on|ticket (#|number:)/i);
    expect(reply.handoff).toMatchObject({ handoffId: "H-1", reason, policyRef: "SUP-02", channel: "web" });
    expect(reply.handoff?.lastMessages.at(-1)).toMatchObject({ role: "shopper", text });
  });

  it.each([
    ["Where is my order?", true],
    ["My fan arrived broken", true],
    ["Is there a 3-year warranty?", false],
    ["I want to talk to staff", false],
  ] as const)("%s: the order/damaged sentence appears only for those reasons", (text, quoted) => {
    const { reply } = chat()(text);
    expect(reply.text.includes("For order status or damaged deliveries")).toBe(quoted);
  });

  it("an out-of-scope handoff keeps the disclosure without the order sentence, in both languages", () => {
    const en = chat()("Do you sell air conditioners?", reading({ intents: ["out_of_scope"] })).reply.text;
    expect(en).toMatch(/no order lookup or real ticketing/);
    expect(en).not.toMatch(/For order status or damaged deliveries/);
    const th = chat()("ขายแอร์ไหม", reading({ intents: ["out_of_scope"], language: "th" })).reply.text;
    expect(th).toContain("ระบบเดโมนี้ไม่มีการค้นหาคำสั่งซื้อหรือระบบเปิดเรื่องจริง");
    expect(th).not.toContain("สำหรับการติดตามสถานะคำสั่งซื้อ");
  });

  it("the handoff packet carries what the shopper already told us", () => {
    const say = chat();
    say("12 sqm room, budget 1000 baht");
    const { reply } = say("where is my order");
    expect(reply.handoff?.knownContext).toMatchObject({ roomSizeBand: "small", budgetThb: 1000 });
  });

  it("out_of_scope hands off from either understander; an unclear keyword reading falls back instead", () => {
    expect(chat()("Do you sell air conditioners?", reading({ intents: ["out_of_scope"] })).reply.handoff).toMatchObject({ reason: "out_of_scope" });
    const unclear = chat()("What is the capital of France?");
    expect(unclear.decisions).toEqual([{ kind: "fallback" }]);
    expect(unclear.reply.handoff).toBeNull();
    expect(unclear.reply.text).toMatch(/room size.*budget.*returns.*staff/);
  });
});

describe("session store", () => {
  it("expires idle sessions and keeps channels apart", () => {
    const store = createMemorySessionStore(60_000);
    store.put(newSession("web", "same-id", NOW));
    expect(store.get("web:same-id", new Date(NOW.getTime() + 59_000))).toBeDefined();
    expect(store.get("line:same-id", NOW)).toBeUndefined();
    expect(store.get("web:same-id", new Date(NOW.getTime() + 61_000))).toBeUndefined();
  });
});
