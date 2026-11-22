import { describe, expect, it } from "vitest";
import { handleTurn } from "./engine.ts";
import { newSession, type Session } from "./session.ts";
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

const kinds = (r: { decisions: { kind: string }[] }) => r.decisions.map((d) => d.kind);
const offered = (r: { reply: { actions: { sku: string; kind: string }[] } }, kind: string) =>
  r.reply.actions.filter((a) => a.kind === kind).map((a) => a.sku);

describe("keyword intents", () => {
  it.each([
    ["Where is my order? Do you deliver to Phuket?", ["order_status"]],
    ["Thanks! Can I return an opened fan?", ["return_policy"]],
    ["ok bye", ["closing"]],
    ["Hello", ["greeting"]],
    ["What is the delivery fee?", ["out_of_scope"]],
    ["ผ่อนชำระได้ไหมครับ", ["out_of_scope"]],
    ["Which is better for a 20 sqm room, HP-F01 or HP-F02? budget 2000", ["recommend"]],
    ["Hi, what's the price of HP-F01 and do you deliver?", ["product_info", "out_of_scope"]],
    ["Where is my order? Also recommend a fan for 12 sqm under 1000", ["order_status", "recommend"]],
    ["What's the weather tomorrow?", ["off_topic"]],
  ] as const)("%s", (text, intents) => {
    expect(understandByKeywords(text, { awaiting: null, recentShopperMessages: [] }).intents).toEqual(intents);
  });

  it.each([
    ["How much is HP-F02?", "price"],
    ["Is HP-F03 in stock?", "stock"],
    ["I have a 20 sqm room. Is HP-F01 good for me?", "fit"],
    ["How loud is HP-F02 in decibels?", "unheld"],
    ["Does HP-F02 come with a remote control?", "unheld"],
  ] as const)("%s asks about %s", (text, asks) => {
    expect(understandByKeywords(text, { awaiting: null, recentShopperMessages: [] })).toMatchObject({ intents: ["product_info"], asks });
  });
});

describe("similarity routing: wordings that are not in the example table", () => {
  it.each([
    ["Give me all your policies", "return_policy"],
    ["Give me all your product that have now so far", "browse_catalog"],
    ["ขอดูนโยบายทั้งหมดของร้าน", "return_policy"],
    ["I want to speak with someone from the shop", "staff_request"],
    ["Can I talk to an admin?", "staff_request"],
    ["The fan I got is all cracked", "damaged_delivery"],
    ["Does it come with a guarantee?", "warranty"],
    ["Is a refund possible?", "return_policy"],
    ["มีของอะไรขายบ้างตอนนี้", "browse_catalog"],
    ["Can you show me what fans you have?", "browse_catalog"],
    ["Has my parcel been sent yet?", "order_status"],
    ["ขอบคุณมากค่ะ", "closing"],
  ] as const)("%s is read as %s", (text, intent) => {
    expect(understandByKeywords(text, { awaiting: null, recentShopperMessages: [] }).intents).toEqual([intent]);
  });

  it("gibberish matches no example and falls back", () => {
    expect(understandByKeywords("asdkjh qwe", { awaiting: null, recentShopperMessages: [] }).intents).toEqual(["unclear"]);
  });
});

describe("issue 001: attributes the fixture does not hold", () => {
  it.each([
    ["What is the wattage of HP-F01?", reading({ intents: ["product_info"], asks: "unheld", skus: ["HP-F01"] })],
    ["Does HP-F02 come with a remote control?", reading({ intents: ["product_info"], asks: "unheld", skus: ["HP-F02"] })],
    ["What is the wattage of HP-F01?", undefined],
    ["Does HP-F02 come with a remote control?", undefined],
  ] as const)("%s hands off as out_of_scope without product facts or checkout", (text, injected) => {
    const r = chat()(text, injected);
    expect(kinds(r)).toEqual(["handoff"]);
    expect(r.reply.handoff).toMatchObject({ reason: "out_of_scope" });
    expect(r.reply.actions).toEqual([]);
    expect(r.reply.text).not.toMatch(/in stock|฿890|฿1,390/);
  });

  it("a held attribute (price) is still answered from the fixture", () => {
    const r = chat()("How much is HP-F02?");
    expect(r.reply.text).toContain("฿1,390");
    expect(r.reply.handoff).toBeNull();
  });
});

describe("issue 002: services we do not hold", () => {
  it.each([
    ["Do you deliver to Chiang Mai?", reading({ intents: ["out_of_scope"] })],
    ["Can I pay for a fan in installments?", reading({ intents: ["out_of_scope"] })],
    ["Do you deliver to Chiang Mai?", undefined],
    ["Can I pay for a fan in installments?", undefined],
  ] as const)("%s hands off with the SUP-02 notice and never starts a sales flow", (text, injected) => {
    const r = chat()(text, injected);
    expect(kinds(r)).toEqual(["handoff"]);
    expect(r.reply.handoff).toMatchObject({ reason: "out_of_scope", policyRef: "SUP-02" });
    expect(r.reply.text).not.toMatch(/What size|budget in THB/);
    expect(r.session.awaiting).toBeNull();
  });

  it("a delivery-status question is still an order_status handoff", () => {
    expect(chat()("What is the delivery status of my order?").reply.handoff).toMatchObject({ reason: "order_status" });
  });
});

describe("issue 003: a SKU question respects the stated room size", () => {
  it("20 sqm + HP-F01 says it is sized for small rooms, asks for budget, and offers no checkout", () => {
    const r = chat()("I have a 20 sqm room. Is HP-F01 good for me?");
    expect(kinds(r)).toEqual(["sku"]);
    expect(r.decisions[0]).toMatchObject({ outcome: { kind: "wrong_size", requestedBand: "medium", followUp: null } });
    expect(r.reply.text).toMatch(/HP-F01 12-inch desk fan, ฿890 is sized for a small room.*not your medium room/);
    expect(r.reply.text).toMatch(/budget/i);
    expect(r.reply.actions).toEqual([]);
    expect(r.session.awaiting).toBe("budget");
  });

  it("the budget that follows gets the Valid Match for the shopper's room", () => {
    const say = chat();
    say("I have a 20 sqm room. Is HP-F01 good for me?");
    const next = say("2000");
    expect(next.reply.text).toContain("HP-F02");
    expect(offered(next, "demo_checkout")).toEqual(["HP-F02"]);
  });

  it("30 sqm + HP-F01 + budget names the mismatch and offers the in-stock alternative, never HP-F01", () => {
    const r = chat()("30 sqm room, is HP-F01 ok? budget 2000 baht");
    expect(r.reply.text).toMatch(/HP-F01 12-inch desk fan, ฿890 is sized for a small room.*not your large room/);
    expect(offered(r, "demo_checkout")).toEqual(["HP-F02"]);
    expect(offered(r, "view_product")).not.toContain("HP-F01");
  });

  it("comparing two SKUs for a room is a recommendation, not a single-SKU answer", () => {
    const r = chat()("Which is better for a 20 sqm room, HP-F01 or HP-F02? budget 2000");
    expect(kinds(r)).toEqual(["match"]);
    expect(offered(r, "demo_checkout")).toEqual(["HP-F02"]);
  });

  it("the same SKU in its own band is answered as before", () => {
    const r = chat()("I have a 12 sqm room. Is HP-F01 good for me?");
    expect(r.reply.text).toContain("HP-F01 12-inch desk fan");
    expect(offered(r, "demo_checkout")).toEqual(["HP-F01"]);
  });

  it("a Thai wrong-size answer is rendered in Thai", () => {
    const r = chat()("ห้อง 20 ตร.ม. HP-F01 เหมาะไหม");
    expect(r.reply.language).toBe("th");
    expect(r.reply.text).toMatch(/HP-F01 .*฿890 เหมาะกับห้องขนาดเล็ก/);
    expect(r.reply.actions).toEqual([]);
  });
});

describe("issue 004: sign-offs", () => {
  it.each(["thanks, that's all", "ok bye", "thank you!"])("%s gets a short close with no handoff", (text) => {
    for (const r of [chat()(text), chat()(text, reading({ intents: ["closing"] }))]) {
      expect(kinds(r)).toEqual(["close"]);
      expect(r.reply.handoff).toBeNull();
      expect(r.reply.text).toBe("You're welcome! Message any time if you need a fan.");
    }
  });

  it("a Thai thanks closes in Thai", () => {
    const r = chat()("ขอบคุณครับ");
    expect(r.reply.language).toBe("th");
    expect(r.reply.text).toContain("ยินดีค่ะ");
    expect(r.reply.handoff).toBeNull();
  });

  it("closing keeps what the shopper told us and what we were waiting for", () => {
    const say = chat();
    say("12 sqm bedroom");
    const r = say("thanks");
    expect(r.session.known.roomSizeBand).toBe("small");
    expect(r.session.awaiting).toBe("budget");
  });
});

describe("issue 011: a message with two requests answers both", () => {
  const both = reading({ intents: ["order_status", "recommend"], roomAreaSqm: 12, budgetThb: 1000 });
  const text = "Where is my order? Also recommend a fan for 12 sqm under 1000";

  it.each([
    ["injected reading", both],
    ["keyword rules", undefined],
  ] as const)("order status plus a recommendation (%s) gives the handoff notice and HP-F01", (_label, injected) => {
    const r = chat()(text, injected);
    expect(kinds(r)).toEqual(["handoff", "match"]);
    expect(r.reply.handoff).toMatchObject({ reason: "order_status", knownContext: { roomSizeBand: "small", budgetThb: 1000 } });
    expect(r.reply.text).toMatch(/passing this to our staff[\s\S]*\n\nHere's a fan that fits[\s\S]*HP-F01/);
    expect(offered(r, "demo_checkout")).toEqual(["HP-F01"]);
  });

  it("no questions are asked while handing off", () => {
    const r = chat()("Where is my order? And recommend a fan", reading({ intents: ["order_status", "recommend"] }));
    expect(kinds(r)).toEqual(["handoff"]);
    expect(r.reply.text).not.toMatch(/What size|budget in THB/);
  });

  it("only the first handoff is made", () => {
    const r = chat()("x", reading({ intents: ["damaged_delivery", "order_status", "staff_request"] }));
    expect(kinds(r)).toEqual(["handoff"]);
    expect(r.reply.handoff?.reason).toBe("damaged_delivery");
  });

  it("greeting and closing are dropped when a real request comes with them", () => {
    expect(kinds(chat()("x", reading({ intents: ["closing", "return_policy"] })))).toEqual(["policy"]);
    expect(kinds(chat()("x", reading({ intents: ["greeting", "product_info", "out_of_scope"], asks: "price", skus: ["HP-F01"] })))).toEqual(["sku", "handoff"]);
  });

  it("the price of a SKU plus a delivery question answers the price and hands off the rest", () => {
    const r = chat()("Hi, what's the price of HP-F01 and do you deliver?");
    expect(kinds(r)).toEqual(["sku", "handoff"]);
    expect(r.reply.text).toContain("฿890");
    expect(r.reply.handoff).toMatchObject({ reason: "out_of_scope" });
  });

  it("awaiting comes from the last kept decision that sets it", () => {
    const r = chat()("x", reading({ intents: ["return_policy", "recommend"], roomAreaSqm: 12 }));
    expect(kinds(r)).toEqual(["policy", "ask"]);
    expect(r.session.awaiting).toBe("budget");
  });
});

describe("issue 014: browsing the catalog", () => {
  it.each([
    ["ตอนนี้มีอะไรเหลือบ้าง", "th"],
    ["What fans do you sell?", "en"],
    ["What do you have in stock?", "en"],
    ["มีพัดลมรุ่นไหนบ้าง", "th"],
  ] as const)("%s is read as browse_catalog", (text, language) => {
    expect(understandByKeywords(text, { awaiting: null, recentShopperMessages: [] })).toMatchObject({ intents: ["browse_catalog"], language });
  });

  it.each([
    ["Is HP-F03 in stock?", ["product_info"]],
    ["What fans do you have for a 12 sqm room?", ["recommend"]],
  ] as const)("%s keeps its narrower intent", (text, intents) => {
    expect(understandByKeywords(text, { awaiting: null, recentShopperMessages: [] }).intents).toEqual(intents);
  });

  it.each([
    ["injected reading", reading({ intents: ["browse_catalog"], language: "th" })],
    ["keyword rules", undefined],
  ] as const)("lists the in-stock fans with price and room size, then asks for both slots (%s)", (_label, injected) => {
    const say = chat();
    say("Where is my order?");
    const r = say("ตอนนี้มีอะไรเหลือบ้าง", injected);
    expect(kinds(r)).toEqual(["browse", "ask"]);
    expect(r.reply.handoff).toBeNull();
    expect(r.reply.text).toMatch(/HP-F01 .*฿890.*ห้องขนาดเล็ก[\s\S]*HP-F02 .*฿1,390.*ห้องขนาดกลาง/);
    expect(r.reply.text).not.toContain("HP-F03");
    expect(r.reply.text).toContain("ขนาดห้อง");
    expect(offered(r, "view_product")).toEqual(["HP-F01", "HP-F02"]);
    expect(offered(r, "demo_checkout")).toEqual([]);
  });

  it("asks only for the slot still missing and waits for it", () => {
    const say = chat();
    say("12 sqm bedroom");
    const r = say("What do you have in stock?");
    expect(kinds(r)).toEqual(["browse", "ask"]);
    expect(r.reply.text).toMatch(/budget in THB/);
    expect(r.session.awaiting).toBe("budget");
  });

  it("with room size and budget known it lists the stock without asking again", () => {
    const say = chat();
    say("12 sqm bedroom, budget 1000 baht");
    expect(kinds(say("What fans do you sell?"))).toEqual(["browse"]);
  });
});

describe("issue 015: off-topic chit-chat", () => {
  it.each([
    ["How about weather today", "en"],
    ["Tell me a joke", "en"],
    ["วันนี้อากาศเป็นยังไง", "th"],
    ["เล่าเรื่องตลกให้ฟังหน่อย", "th"],
  ] as const)("%s is read as off_topic", (text, language) => {
    expect(understandByKeywords(text, { awaiting: null, recentShopperMessages: [] })).toMatchObject({ intents: ["off_topic"], language });
  });

  it.each([
    ["อากาศร้อนมาก อยากได้พัดลม", ["recommend"]],
    ["It's hot weather, I need a fan for 12 sqm", ["recommend"]],
    ["ขายเครื่องฟอกอากาศไหม", ["unclear"]],
  ] as const)("%s is not off_topic", (text, intents) => {
    expect(understandByKeywords(text, { awaiting: null, recentShopperMessages: [] }).intents).toEqual(intents);
  });

  it.each([
    ["injected reading", reading({ intents: ["off_topic"] })],
    ["keyword rules", undefined],
  ] as const)("redirects without a handoff and asks for the sale's missing slots (%s)", (_label, injected) => {
    const r = chat()("How about weather today", injected);
    expect(kinds(r)).toEqual(["redirect", "ask"]);
    expect(r.reply.handoff).toBeNull();
    expect(r.reply.text).toMatch(/only help with fans, returns and orders[\s\S]*room size in m² and your budget in THB/);
    expect(r.reply.text).not.toMatch(/SUP-02|staff|order lookup/);
  });

  it("keeps the known context and the pending question", () => {
    const say = chat();
    say("I need a fan for my 12 m² bedroom");
    const r = say("ตลกดี เล่ามุกให้ฟังหน่อย");
    expect(kinds(r)).toEqual(["redirect", "ask"]);
    expect(r.reply.text).toContain("งบประมาณเท่าไร");
    expect(r.session.awaiting).toBe("budget");
    expect(kinds(say("1000"))).toEqual(["match"]);
  });

  it("only redirects when the sale has nothing to ask", () => {
    const say = chat();
    say("12 sqm room, budget 1000 baht");
    const r = say("Tell me a joke");
    expect(kinds(r)).toEqual(["redirect"]);
    expect(r.session.known).toMatchObject({ roomSizeBand: "small", budgetThb: 1000 });
  });

  it("a real request in the same message is still answered, and a shop question still hands off", () => {
    expect(kinds(chat()("x", reading({ intents: ["off_topic", "recommend"], roomAreaSqm: 12, budgetThb: 1000 })))).toEqual(["redirect", "match"]);
    expect(kinds(chat()("x", reading({ intents: ["off_topic", "order_status"] })))).toEqual(["redirect", "handoff"]);
    expect(kinds(chat()("x", reading({ intents: ["greeting", "off_topic"] })))).toEqual(["redirect", "ask"]);
  });
});

describe("issue 005: LLM opener", () => {
  it("opens the reply with the LLM's sentence and leaves the facts to the templates", () => {
    const r = chat()("x", reading({ intents: ["damaged_delivery"], opener: "So sorry your fan arrived like that." }));
    expect(r.reply.text).toMatch(/^So sorry your fan arrived like that\. I'm passing this to our staff \(policy SUP-02/);
    expect(r.session.history.at(-1)?.text).toBe(r.reply.text);
  });

  it("keyword readings carry no opener", () => {
    expect(understandByKeywords("The fan arrived damaged", { awaiting: null, recentShopperMessages: [] }).opener).toBeNull();
  });
});
