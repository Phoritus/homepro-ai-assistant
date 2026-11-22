import type { Language, RoomSizeBand } from "@homepro/shared";
import { z } from "zod";

export const LLM_INTENTS = [
  "recommend",
  "product_info",
  "return_policy",
  "order_status",
  "damaged_delivery",
  "warranty",
  "staff_request",
  "greeting",
  "closing",
  "out_of_scope",
] as const;
export type LlmIntent = (typeof LLM_INTENTS)[number];

/** "unclear" is produced only by the keyword rules when nothing matched: not understood, never a handoff. */
export type Intent = LlmIntent | "unclear";

/** What a shopper wants to know about one product. "unheld" is any attribute the fixture has no data for. */
export const PRODUCT_ASKS = ["price", "stock", "fit", "unheld"] as const;
export type ProductAsk = (typeof PRODUCT_ASKS)[number];

/** What the assistant is waiting for, passed to understanders so a bare "1500" can be read as a Budget. */
export type Awaiting = "room_size" | "budget" | null;

/**
 * Structured reading of one shopper message. Produced by the LLM or by the keyword rules;
 * it carries no facts about products or policies, only what the shopper said.
 * `intents` are in the order the shopper raised them; `skus` are every product code mentioned, in order.
 */
export interface Understanding {
  intents: [Intent, ...Intent[]];
  asks: ProductAsk | null;
  language: Language;
  roomAreaSqm: number | null;
  roomSizeBand: RoomSizeBand | null;
  budgetThb: number | null;
  skus: string[];
}

const llmIntent = z.enum(LLM_INTENTS);

export const understandingSchema = z.object({
  intents: z.tuple([llmIntent], llmIntent),
  asks: z.enum(PRODUCT_ASKS).nullable(),
  language: z.enum(["th", "en"]),
  roomAreaSqm: z.number().nullable(),
  roomSizeBand: z.enum(["small", "medium", "large"]).nullable(),
  budgetThb: z.number().nullable(),
  skus: z.array(z.string()),
}) satisfies z.ZodType<Understanding>;

export interface UnderstandContext {
  awaiting: Awaiting;
  recentShopperMessages: string[];
}

export type Understander = (text: string, ctx: UnderstandContext) => Promise<Understanding>;

/** The LLM provider refused the call for rate limiting; the turn falls back to keyword rules. */
export class RateLimitedError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(`llm rate limited, retry after ${retryAfterMs} ms`);
    this.name = "RateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

const THAI = /[฀-๿]/;
const DIGITS = String.raw`\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?`;
const NUMBER = `(${DIGITS})`;
// A minus sign is kept so isValidBudget rejects "-500"; one right after a digit is a range ("1000-1500").
const SIGNED_NUMBER = String.raw`((?<!\d)[-−]?(?:${DIGITS}))`;
const AREA = new RegExp(NUMBER + String.raw`\s*(?:m2|m²|sq\.?\s*m|sqm|square\s*met(?:er|re)s?|ตร\.?\s*ม\.?|ตาราง\s*เมตร)`, "i");
const BUDGET_AFTER = new RegExp(SIGNED_NUMBER + String.raw`\s*(?:baht|thb|บาท|฿)`, "i");
const BUDGET_BEFORE = new RegExp(String.raw`(?:฿|thb\s*|budget\s*(?:is|of|:)?\s*|งบ(?:ประมาณ)?\s*(?:ไม่เกิน)?\s*)` + SIGNED_NUMBER, "i");
const BARE_NUMBER = new RegExp(String.raw`^\s*(?:about|around|ประมาณ)?\s*` + NUMBER + String.raw`\s*$`, "i");
const BUDGET_UNDER = new RegExp(
  String.raw`(?:under|below|within|up to|max(?:imum)?)\s*฿?\s*` + SIGNED_NUMBER + String.raw`(?![\d,.]|\s*(?:m2|m²|sq|square|ตร|ตาราง|inch|นิ้ว|cm))`,
  "i",
);
const SKU = /\bhp[\s-]?f\d{2}\b/gi;

const toNumber = (s: string | undefined) => (s === undefined ? null : Number(s.replace(/,/g, "").replace("−", "-")));

const BAND_WORDS: [RegExp, RoomSizeBand][] = [
  [/\b(small|tiny)\b|ห้องเล็ก/i, "small"],
  [/\b(medium|mid-sized|average)\b|ห้องขนาดกลาง|ห้องกลาง/i, "medium"],
  [/\b(large|big|huge)\b|ห้องใหญ่/i, "large"],
];

const index = (re: RegExp, text: string) => re.exec(text)?.index;

const SUPPORT_WORDS: [RegExp, Intent][] = [
  [/\b(staff|human|agent|person|operator)\b|เจ้าหน้าที่|พนักงาน|คุยกับคน/i, "staff_request"],
  [/\b(damaged?|broken|cracked|defective)\b|เสียหาย|แตก|ชำรุด|พัง/i, "damaged_delivery"],
  [/\b(order status|track(ing)?|where is my order|my order|delivery status)\b|สถานะ|ติดตาม|คำสั่งซื้อ|พัสดุ/i, "order_status"],
  [/\b(return|refund|exchange|send (it )?back)\b|คืนสินค้า|คืนเงิน|เปลี่ยนสินค้า|ขอคืน/i, "return_policy"],
  [/\b(warrant(y|ies)|guarantee)\b|รับประกัน/i, "warranty"],
];
const OUT_OF_SCOPE_WORDS =
  /\bdeliver\b|\b(delivery|shipping) (fee|cost|charge)s?\b|\binstall\w*|\bpay(ment|ing|s)?\b|\bcredit card\b|\b(store|opening|business) hours\b|\bwhat time\b[^?]*\b(open|close)|ผ่อน|จัดส่ง|ติดตั้ง|โปรโมชั่น|ชำระ/i;
const CLOSING_WORDS = /\b(thanks|thank you|thx|bye|goodbye|that['’]?s all)\b|ขอบคุณ|บาย|ลาก่อน/i;
const GREETING_WORDS = /^\s*(hi|hello|hey|good (morning|afternoon|evening))\b|สวัสดี/i;
const RECOMMEND_WORDS = /\b(fan|recommend|room|bedroom|buy|price|budget|stock)\b|พัดลม|แนะนำ|ห้อง|ซื้อ|ราคา|งบ/i;

// Order matters: an attribute we don't hold wins over a held one so the question is never answered with the wrong fact.
const ASK_WORDS: [RegExp, ProductAsk][] = [
  [/\b(watts?|wattage|remote|noise|noisy|loud|quiet|decibels?|db|colou?rs?|cm|centimet\w*|weight|weigh)\b|สี|รีโมท|วัตต์/i, "unheld"],
  [/\b(price|how much|cost)\b|ราคา/i, "price"],
  [/\b(stock|available)\b|มีของ/i, "stock"],
  [/\b(room|sqm|fit|suit|good for)\b|ห้อง|ตร\.?\s*ม/i, "fit"],
];

/**
 * Deterministic understander. Used when no LLM is configured and as the fallback when the
 * LLM call fails, so the facts path never depends on the model being up.
 * Every matching intent is kept in message order; "unclear" only when nothing matched.
 */
export function understandByKeywords(text: string, ctx: UnderstandContext): Understanding {
  const language: Language = THAI.test(text) ? "th" : "en";
  const areaMatch = AREA.exec(text);
  const budgetMatch = BUDGET_AFTER.exec(text) ?? BUDGET_BEFORE.exec(text) ?? BUDGET_UNDER.exec(text);
  let area = toNumber(areaMatch?.[1]);
  let budgetThb = toNumber(budgetMatch?.[1]);
  const bare = toNumber(BARE_NUMBER.exec(text)?.[1]);
  if (bare !== null && ctx.awaiting === "budget") budgetThb ??= bare;
  if (bare !== null && ctx.awaiting === "room_size") area ??= bare;

  const bandHit = BAND_WORDS.flatMap(([re, band]) => {
    const at = index(re, text);
    return at === undefined ? [] : [{ band, at }];
  })[0];
  const roomSizeBand = bandHit?.band ?? null;
  const skuMatches = [...text.matchAll(SKU)];
  const skus = skuMatches.map((m) => m[0]);
  const firstSkuAt = skuMatches[0]?.index ?? Infinity;
  const hasSlot = area !== null || budgetThb !== null || roomSizeBand !== null;

  const hits: { intent: Intent; at: number }[] = [];
  for (const [re, intent] of SUPPORT_WORDS) {
    const at = index(re, text);
    if (at !== undefined) hits.push({ intent, at });
  }
  const outOfScopeAt = index(OUT_OF_SCOPE_WORDS, text);
  const orderLike = hits.some((h) => h.intent === "order_status" || h.intent === "damaged_delivery");
  if (outOfScopeAt !== undefined && !orderLike) hits.push({ intent: "out_of_scope", at: outOfScopeAt });

  const asks = ASK_WORDS.find(([re]) => re.test(text))?.[1] ?? null;
  const askAt = Math.min(...ASK_WORDS.map(([re]) => index(re, text) ?? Infinity));
  const hasOtherIntent = hits.length > 0;
  const productInfo = skus.length === 1 && (!hasOtherIntent || asks !== null);
  if (productInfo) hits.push({ intent: "product_info", at: Math.min(firstSkuAt, askAt) });

  const recommendWordAt = index(RECOMMEND_WORDS, text);
  const wantsRecommend = !productInfo && (skus.length >= 2 || hasSlot || (recommendWordAt !== undefined && !hasOtherIntent));
  if (wantsRecommend) {
    const slotAt = Math.min(areaMatch?.index ?? Infinity, budgetMatch?.index ?? Infinity, bandHit?.at ?? Infinity, bare === null ? Infinity : 0);
    hits.push({ intent: "recommend", at: Math.min(slotAt, recommendWordAt ?? Infinity, firstSkuAt) });
  }

  if (hits.length === 0) {
    const greetingAt = index(GREETING_WORDS, text);
    const closingAt = index(CLOSING_WORDS, text);
    if (greetingAt !== undefined) hits.push({ intent: "greeting", at: greetingAt });
    if (closingAt !== undefined) hits.push({ intent: "closing", at: closingAt });
  }

  const [first, ...rest] = new Set(hits.sort((a, b) => a.at - b.at).map((h) => h.intent));
  const intents: [Intent, ...Intent[]] = first === undefined ? ["unclear"] : [first, ...rest];
  return { intents, asks: intents.includes("product_info") ? asks : null, language, roomAreaSqm: area, roomSizeBand, budgetThb, skus };
}
