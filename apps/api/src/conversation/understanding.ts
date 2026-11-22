import type { Language, RoomSizeBand } from "@homepro/shared";
import { z } from "zod";

export const INTENTS = [
  "sales",
  "return_policy",
  "order_status",
  "damaged_delivery",
  "warranty",
  "staff_request",
  "greeting",
  "other",
] as const;
export type Intent = (typeof INTENTS)[number];

/** What the assistant is waiting for, passed to understanders so a bare "1500" can be read as a Budget. */
export type Awaiting = "room_size" | "budget" | null;

/**
 * Structured reading of one shopper message. Produced by the LLM or by the keyword rules;
 * it carries no facts about products or policies, only what the shopper said.
 */
export interface Understanding {
  intent: Intent;
  language: Language;
  roomAreaSqm: number | null;
  roomSizeBand: RoomSizeBand | null;
  budgetThb: number | null;
  sku: string | null;
}

export const understandingSchema = z.object({
  intent: z.enum(INTENTS),
  language: z.enum(["th", "en"]),
  roomAreaSqm: z.number().nullable(),
  roomSizeBand: z.enum(["small", "medium", "large"]).nullable(),
  budgetThb: z.number().nullable(),
  sku: z.string().nullable(),
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
const SKU = /\bhp[\s-]?f\d{2}\b/i;

const toNumber = (s: string | undefined) => (s === undefined ? null : Number(s.replace(/,/g, "").replace("−", "-")));

const BAND_WORDS: [RegExp, RoomSizeBand][] = [
  [/\b(small|tiny)\b|ห้องเล็ก/i, "small"],
  [/\b(medium|mid-sized|average)\b|ห้องขนาดกลาง|ห้องกลาง/i, "medium"],
  [/\b(large|big|huge)\b|ห้องใหญ่/i, "large"],
];

const INTENT_WORDS: [RegExp, Intent][] = [
  [/\b(staff|human|agent|person|operator)\b|เจ้าหน้าที่|พนักงาน|คุยกับคน/i, "staff_request"],
  [/\b(damaged?|broken|cracked|defective)\b|เสียหาย|แตก|ชำรุด|พัง/i, "damaged_delivery"],
  [/\b(order status|track(ing)?|where is my order|my order|delivery status|shipping)\b|สถานะ|ติดตาม|คำสั่งซื้อ|พัสดุ/i, "order_status"],
  [/\b(return|refund|exchange|send (it )?back)\b|คืนสินค้า|คืนเงิน|เปลี่ยนสินค้า|ขอคืน/i, "return_policy"],
  [/\b(warrant(y|ies)|guarantee)\b|รับประกัน/i, "warranty"],
  [/\b(fan|recommend|room|bedroom|buy|price|budget|stock)\b|พัดลม|แนะนำ|ห้อง|ซื้อ|ราคา|งบ/i, "sales"],
  [/^\s*(hi|hello|hey|good (morning|afternoon|evening))\b|สวัสดี/i, "greeting"],
];

/**
 * Deterministic understander. Used when no LLM is configured and as the fallback when the
 * LLM call fails, so the facts path never depends on the model being up.
 */
export function understandByKeywords(text: string, ctx: UnderstandContext): Understanding {
  const language: Language = THAI.test(text) ? "th" : "en";
  const roomAreaSqm = toNumber(AREA.exec(text)?.[1]);
  let budgetThb = toNumber((BUDGET_AFTER.exec(text) ?? BUDGET_BEFORE.exec(text))?.[1]);
  const bare = toNumber(BARE_NUMBER.exec(text)?.[1]);
  let area = roomAreaSqm;
  if (bare !== null && ctx.awaiting === "budget") budgetThb ??= bare;
  if (bare !== null && ctx.awaiting === "room_size") area ??= bare;

  const roomSizeBand = BAND_WORDS.find(([re]) => re.test(text))?.[1] ?? null;
  const sku = SKU.exec(text)?.[0] ?? null;
  const hasSlot = area !== null || budgetThb !== null || roomSizeBand !== null || sku !== null;
  const intent = INTENT_WORDS.find(([re]) => re.test(text))?.[1] ?? (hasSlot ? "sales" : "other");

  return { intent, language, roomAreaSqm: area, roomSizeBand, budgetThb, sku };
}
