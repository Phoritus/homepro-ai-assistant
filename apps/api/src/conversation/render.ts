import type { HandoffReason, KnownContext, Language, ReplyAction, RoomSizeBand } from "@homepro/shared";
import { CATALOG, STORE_NAME, type Product } from "../domain/catalog.ts";
import type { BandShortfall, MatchOutcome, SkuOutcome } from "../domain/matching.ts";
import { POLICIES } from "../domain/policies.ts";

/** What the engine decided for this turn. Rendering turns it into words; it adds no facts of its own. */
export type Decision =
  | { kind: "greet" }
  | { kind: "ask"; missing: "room_size" | "budget" | "both"; known: KnownContext }
  | { kind: "match"; outcome: MatchOutcome }
  | { kind: "sku"; outcome: SkuOutcome }
  | { kind: "policy"; policyId: "SUP-01" }
  | { kind: "handoff"; reason: HandoffReason }
  | { kind: "fallback" };

export interface Rendered {
  text: string;
  actions: ReplyAction[];
}

const thb = (n: number) => `฿${n.toLocaleString("en-US")}`;

interface Phrases {
  band: Record<RoomSizeBand, string>;
  bandShort: Record<RoomSizeBand, string>;
  sep: string;
  reason: Record<HandoffReason, string>;
  greet: string;
  askBoth: string;
  askRoom: (budget: number) => string;
  askBudget: (band: RoomSizeBand) => string;
  item: (p: Product) => string;
  fits: (p: Product, budget: number) => string;
  stock: (p: Product) => string;
  intro: (count: number) => string;
  shortfall: (s: BandShortfall, band: RoomSizeBand, budget: number) => string;
  alternative: (p: Product, requested: RoomSizeBand, budget: number) => string;
  noMatch: (band: RoomSizeBand, budget: number) => string;
  floor: (p: Product) => string;
  noMatchNext: string;
  unknownSku: (asked: string, skus: string) => string;
  skuAvailable: (p: Product) => string;
  skuOutOfStock: (p: Product) => string;
  skuOverBudget: (p: Product, budget: number) => string;
  askBudgetForAlternative: string;
  returns: (policyText: string) => string;
  handoff: (reason: HandoffReason, policyText: string) => string;
  fallback: string;
  view: (sku: string) => string;
  checkout: string;
}

const EN: Phrases = {
  band: { small: "small room (up to 15 m²)", medium: "medium room (16–25 m²)", large: "large room (over 25 m²)" },
  bandShort: { small: "small-room", medium: "medium-room", large: "large-room" },
  sep: ". ",
  reason: {
    order_status: "order status",
    damaged_delivery: "damaged delivery",
    uncovered_warranty: "warranty question",
    shopper_request: "you asked for staff",
    out_of_scope: "question outside what I can answer",
  },
  greet: `Hi! I'm the ${STORE_NAME} assistant. I can recommend a fan, explain returns, or pass you to staff. What size is your room (m²) and what's your budget (THB)?`,
  askBoth: "To recommend a fan, I need two things: your room size in m² and your budget in THB.",
  askRoom: (budget) => `Got it, your budget is ${thb(budget)}. What size is your room in m²?`,
  askBudget: (band) => `Got it, a ${EN.band[band]}. What's your budget in THB?`,
  item: (p) => `${p.sku} ${p.name.en}, ${thb(p.priceThb)}`,
  fits: (p, budget) => `Reason: sized for a ${EN.band[p.band]} and within your ${thb(budget)} budget.`,
  stock: (p) => `${p.stock} in stock at ${STORE_NAME}.`,
  intro: (n) => (n === 1 ? "Here's a fan that fits:" : `Here are ${n} fans that fit, cheapest first:`),
  shortfall: (s, band, budget) => {
    if (s.kind === "over_budget") return `Our ${EN.bandShort[band]} fan ${s.cheapestInBand.sku} costs ${thb(s.cheapestInBand.priceThb)}, above your ${thb(budget)} budget.`;
    if (s.kind === "out_of_stock") return `Our ${EN.bandShort[band]} fan ${s.productsInBand.map((p) => p.sku).join(", ")} is out of stock.`;
    return `We don't carry a fan for a ${EN.band[band]}.`;
  },
  alternative: (p, requested, budget) =>
    `In-stock alternative within your ${thb(budget)} budget: ${EN.item(p)}. Note: it's sized for a ${EN.band[p.band]}, not a ${EN.band[requested]}.`,
  noMatch: (band, budget) => `No in-stock fan for a ${EN.band[band]} fits within ${thb(budget)}.`,
  floor: (p) => `Our lowest-priced fan in stock is ${p.sku} at ${thb(p.priceThb)} (a ${EN.bandShort[p.band]} fan).`,
  noMatchNext: "You can tell me a different budget, or type \"staff\" to talk to a person.",
  unknownSku: (asked, skus) => `I couldn't find SKU "${asked}". We carry ${skus}.`,
  skuAvailable: (p) => `${EN.item(p)}, for a ${EN.band[p.band]}. ${EN.stock(p)}`,
  skuOutOfStock: (p) => `${EN.item(p)} is out of stock.`,
  skuOverBudget: (p, budget) => `${EN.item(p)} is above your ${thb(budget)} budget.`,
  askBudgetForAlternative: "What's your budget in THB? I'll look for an in-stock alternative within it.",
  returns: (text) => `Returns (policy SUP-01): ${text} If you'd like, type "staff" and I'll pass your request on.`,
  handoff: (reason, text) =>
    `I'm passing this to our staff (policy SUP-02, reason: ${EN.reason[reason]}). ${text} ` +
    "So I can't check an order or give you a ticket number. Staff will receive a summary with: the channel, " +
    "the reason, your language, any room size, budget and SKUs you mentioned, and your last few messages.",
  fallback:
    "Sorry, I can't process that right now. I can recommend a fan if you tell me your room size (m²) and budget (THB), " +
    "explain our returns policy, or pass you to staff. Just type \"staff\".",
  view: (sku) => `View ${sku}`,
  checkout: "Demo checkout",
};

const TH: Phrases = {
  band: { small: "ห้องขนาดเล็ก (ไม่เกิน 15 ตร.ม.)", medium: "ห้องขนาดกลาง (16–25 ตร.ม.)", large: "ห้องขนาดใหญ่ (มากกว่า 25 ตร.ม.)" },
  bandShort: { small: "ห้องขนาดเล็ก", medium: "ห้องขนาดกลาง", large: "ห้องขนาดใหญ่" },
  sep: " ",
  reason: {
    order_status: "สถานะคำสั่งซื้อ",
    damaged_delivery: "สินค้าเสียหายระหว่างจัดส่ง",
    uncovered_warranty: "คำถามเรื่องการรับประกัน",
    shopper_request: "คุณขอคุยกับเจ้าหน้าที่",
    out_of_scope: "คำถามที่อยู่นอกข้อมูลที่ตอบได้",
  },
  greet: `สวัสดีค่ะ ผู้ช่วยของ ${STORE_NAME} ยินดีให้บริการ แนะนำพัดลม อธิบายนโยบายคืนสินค้า หรือส่งต่อเจ้าหน้าที่ได้ค่ะ ห้องของคุณขนาดกี่ตารางเมตร และงบประมาณเท่าไรคะ`,
  askBoth: "เพื่อแนะนำพัดลม ขอทราบขนาดห้อง (ตร.ม.) และงบประมาณ (บาท) ค่ะ",
  askRoom: (budget) => `รับทราบค่ะ งบประมาณ ${thb(budget)} ห้องของคุณขนาดกี่ตารางเมตรคะ`,
  askBudget: (band) => `รับทราบค่ะ ${TH.band[band]} งบประมาณเท่าไรคะ`,
  item: (p) => `${p.sku} ${p.name.th} ราคา ${thb(p.priceThb)}`,
  fits: (p, budget) => `เหตุผล: เหมาะกับ${TH.band[p.band]} และอยู่ในงบ ${thb(budget)} ของคุณ`,
  stock: (p) => `มีสินค้า ${p.stock} ชิ้นที่ ${STORE_NAME}`,
  intro: (n) => (n === 1 ? "พัดลมที่เหมาะกับคุณ:" : `พัดลม ${n} รุ่นที่เหมาะกับคุณ เรียงจากราคาต่ำสุด:`),
  shortfall: (s, band, budget) => {
    if (s.kind === "over_budget") return `พัดลมสำหรับ${TH.bandShort[band]} ${s.cheapestInBand.sku} ราคา ${thb(s.cheapestInBand.priceThb)} เกินงบ ${thb(budget)} ของคุณ`;
    if (s.kind === "out_of_stock") return `พัดลมสำหรับ${TH.bandShort[band]} ${s.productsInBand.map((p) => p.sku).join(", ")} สินค้าหมด`;
    return `เราไม่มีพัดลมสำหรับ${TH.band[band]}`;
  },
  alternative: (p, requested, budget) =>
    `ทางเลือกที่มีสินค้าและอยู่ในงบ ${thb(budget)}: ${TH.item(p)} หมายเหตุ: รุ่นนี้เหมาะกับ${TH.band[p.band]} ไม่ใช่${TH.band[requested]}`,
  noMatch: (band, budget) => `ไม่มีพัดลมที่มีสินค้าสำหรับ${TH.band[band]}ในงบ ${thb(budget)}`,
  floor: (p) => `พัดลมราคาต่ำสุดที่มีสินค้าคือ ${p.sku} ราคา ${thb(p.priceThb)} (สำหรับ${TH.bandShort[p.band]})`,
  noMatchNext: "คุณสามารถแจ้งงบประมาณใหม่ หรือพิมพ์ \"เจ้าหน้าที่\" เพื่อคุยกับพนักงานค่ะ",
  unknownSku: (asked, skus) => `ไม่พบสินค้ารหัส "${asked}" ค่ะ สินค้าที่มีคือ ${skus}`,
  skuAvailable: (p) => `${TH.item(p)} เหมาะกับ${TH.band[p.band]} ${TH.stock(p)}`,
  skuOutOfStock: (p) => `${TH.item(p)} สินค้าหมดค่ะ`,
  skuOverBudget: (p, budget) => `${TH.item(p)} เกินงบ ${thb(budget)} ของคุณค่ะ`,
  askBudgetForAlternative: "งบประมาณเท่าไรคะ จะหาทางเลือกที่มีสินค้าภายในงบให้ค่ะ",
  returns: (text) => `การคืนสินค้า (นโยบาย SUP-01): ${text} หากต้องการ พิมพ์ "เจ้าหน้าที่" เพื่อส่งคำขอต่อได้ค่ะ`,
  handoff: (reason, text) =>
    `ขอส่งต่อเรื่องนี้ให้เจ้าหน้าที่ค่ะ (นโยบาย SUP-02 เหตุผล: ${TH.reason[reason]}) ${text} ` +
    "จึงไม่สามารถตรวจสอบคำสั่งซื้อหรือออกหมายเลขเรื่องได้ เจ้าหน้าที่จะได้รับสรุปที่มี: ช่องทาง เหตุผล ภาษาของคุณ " +
    "ขนาดห้อง งบประมาณ และรหัสสินค้าที่คุณกล่าวถึง และข้อความล่าสุดของคุณ",
  fallback:
    "ขออภัยค่ะ ขณะนี้ไม่สามารถประมวลผลข้อความได้ หากแจ้งขนาดห้อง (ตร.ม.) และงบประมาณ (บาท) จะแนะนำพัดลมให้ได้ " +
    "หรือสอบถามนโยบายคืนสินค้า หรือพิมพ์ \"เจ้าหน้าที่\" เพื่อคุยกับพนักงานค่ะ",
  view: (sku) => `ดู ${sku}`,
  checkout: "สั่งซื้อ (เดโม)",
};

const PHRASES: Record<Language, Phrases> = { en: EN, th: TH };

export function render(decision: Decision, language: Language, baseUrl: string): Rendered {
  const t = PHRASES[language];
  const view = (sku: string): ReplyAction => ({ kind: "view_product", sku, url: `${baseUrl}/demo/products/${sku}` });
  const checkout = (sku: string): ReplyAction => ({ kind: "demo_checkout", sku, url: `${baseUrl}/demo/checkout?sku=${sku}` });
  const offer = (p: Product) => [view(p.sku), checkout(p.sku)];

  const matchText = (o: MatchOutcome, includeShortfall: boolean): Rendered => {
    if (o.kind === "valid_match") {
      const lines = o.matches.map((p) => `${t.item(p)}${t.sep}${t.fits(p, o.budgetThb)} ${t.stock(p)}`);
      return { text: [t.intro(o.matches.length), ...lines].join("\n"), actions: [...o.matches.map((p) => view(p.sku)), checkout(o.matches[0].sku)] };
    }
    const shortfall = includeShortfall ? [t.shortfall(o.shortfall, o.requestedBand, o.budgetThb)] : [];
    if (o.kind === "alternative") {
      return {
        text: [...shortfall, `${t.alternative(o.alternative, o.requestedBand, o.budgetThb)} ${t.stock(o.alternative)}`].join(" "),
        actions: offer(o.alternative),
      };
    }
    const alreadyNamed = o.shortfall.kind === "over_budget" && o.shortfall.cheapestInBand.sku === o.cheapestInStock?.sku;
    const floor = o.cheapestInStock && !alreadyNamed ? [t.floor(o.cheapestInStock)] : [];
    return { text: [...shortfall, t.noMatch(o.requestedBand, o.budgetThb), ...floor, t.noMatchNext].join(" "), actions: [] };
  };

  const prefixed = (prefix: string, r: Rendered): Rendered => ({ text: `${prefix} ${r.text}`, actions: r.actions });

  switch (decision.kind) {
    case "greet":
      return { text: t.greet, actions: [] };
    case "ask": {
      const { missing, known } = decision;
      if (missing === "room_size" && known.budgetThb !== undefined) return { text: t.askRoom(known.budgetThb), actions: [] };
      if (missing === "budget" && known.roomSizeBand !== undefined) return { text: t.askBudget(known.roomSizeBand), actions: [] };
      return { text: t.askBoth, actions: [] };
    }
    case "match":
      return matchText(decision.outcome, true);
    case "sku": {
      const o = decision.outcome;
      if (o.kind === "unknown_sku") return { text: t.unknownSku(o.asked, CATALOG.map((p) => p.sku).join(", ")), actions: [] };
      if (o.kind === "available") return { text: t.skuAvailable(o.product), actions: offer(o.product) };
      if (o.kind === "over_budget") return prefixed(t.skuOverBudget(o.product, o.budgetThb), matchText(o.followUp, false));
      if (o.followUp === null) return { text: `${t.skuOutOfStock(o.product)} ${t.askBudgetForAlternative}`, actions: [] };
      return prefixed(t.skuOutOfStock(o.product), matchText(o.followUp, false));
    }
    case "policy":
      return { text: t.returns(POLICIES[decision.policyId].text[language]), actions: [] };
    case "handoff": {
      const { scope, disclosure } = POLICIES["SUP-02"];
      const inScope = decision.reason === "order_status" || decision.reason === "damaged_delivery";
      return { text: t.handoff(decision.reason, inScope ? `${scope[language]} ${disclosure[language]}` : disclosure[language]), actions: [] };
    }
    case "fallback":
      return { text: t.fallback, actions: [] };
  }
}
