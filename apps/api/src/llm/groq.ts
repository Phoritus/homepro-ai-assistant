import { LLM_INTENTS, PRODUCT_ASKS, RateLimitedError, understandingSchema, type Understander } from "../conversation/understanding.ts";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

const TAXONOMY = `Intents (classify ONLY current "message"; use "earlierMessages" solely to resolve pronouns; list in order raised):
- "recommend": wants help choosing a fan, states room size/type, or states a budget. Comparing SKUs for a room is "recommend".
- "browse_catalog": asks what the shop sells or has in stock with NO room size, budget, or SKU (e.g., "what do you sell", "ขายอะไร", "ขายเกี่ยวกับอะไร", "มีอะไรขายบ้าง", "มีพัดลมรุ่นไหนบ้าง").
- "product_info": asks about ONE named SKU (e.g., "HP-F01"). Set "asks" to:
    * "price": cost/price.
    * "stock": availability/stock count.
    * "fit": suitability for a room size.
    * "unheld": ANY other attribute not in our catalog (wattage, noise, colour, remote, dimensions, material). We ONLY hold name, price, stock, and room size.
- "return_policy": returns, refunds, exchanges, unopened item return window.
- "order_status": tracking, delivery status, or ETA of an existing order.
- "damaged_delivery": item arrived broken, defective, or damaged.
- "warranty": warranty, guarantee, or repair coverage.
- "staff_request": explicitly asks for a human, admin, or agent.
- "greeting": bare greeting OR vague conversation starter with no specific topic yet (e.g., "hi", "สวัสดี", "สอบถามข้อมูล", "ขอสอบถามหน่อย", "มีเรื่องจะถาม"). Drop if paired with a specific request.
- "closing": thanks, goodbye, or ending chat with no new request. Drop if paired with a specific request.
- "out_of_scope": a CONCRETE question about the shop not covered above (e.g., new-order delivery fees/areas, payment methods, installments, installation, store hours, promos, non-fan products). Never use for vague "I have a question" openers.
- "off_topic": unrelated to shopping or the store (weather, jokes, chit-chat). "It's hot, I need a fan" is "recommend", not "off_topic".

Rule: Delivery, payment, or installation questions are always "out_of_scope", never "recommend" or "product_info".`;

const SYSTEM_PROMPT = `You are a strict NLU parser for a Thai/English HomePro fan shop assistant.
Return ONLY a valid JSON object matching the schema. Never answer the shopper.

${TAXONOMY}

Fields (use null when not stated in current message):
- intents: non-empty array from the taxonomy above.
- asks: required ("price" | "stock" | "fit" | "unheld") when "product_info" is in intents; else null.
- language: "th" if current message contains Thai script/transliteration, else "en".
- roomAreaSqm: numeric area in sqm if stated (e.g., "20 ตร.ม." -> 20), else null.
- roomSizeBand: "small" | "medium" | "large" ONLY when roomAreaSqm is null:
    * "small": small room, ห้องเล็ก, ห้องนอนเล็ก, โต๊ะทำงาน, desk
    * "medium": medium room, ห้องกลาง, ห้องนอน, bedroom
    * "large": large room, ห้องใหญ่, ห้องนั่งเล่น, ห้องรับแขก, living room, hall
- budgetThb: max budget in THB as a number (e.g., "พันนึง" -> 1000, "พันห้า" -> 1500, "ไม่เกิน 1,400" -> 1400), else null.
- skus: normalized uppercase SKUs in current message or resolved from earlierMessages ("this/it/อันนี้/ตัวนี้"). Normalize "hp-f01" -> "HP-F01", "hp-f03" or "hp-f0318" -> "HP-F03". Empty array if none.
- opener: one brief warm sentence (max 10 words) acknowledging emotion/situation (e.g., heat, broken item). For Thai ("th"), ALWAYS use female polite particles ("ค่ะ" / "คะ") and NEVER use "ครับ". Must contain ZERO facts, numbers, SKUs, prices, policies, or questions. Set to null for bare greetings, vague openers ("สอบถามข้อมูล"), goodbyes, or bare numbers.

Disambiguation with "awaiting":
- awaiting === "budget" + bare number -> budgetThb = number, intents = ["recommend"].
- awaiting === "room_size" + bare number -> roomAreaSqm = number, intents = ["recommend"].
- awaiting === "room_size" + size word -> roomSizeBand = band, intents = ["recommend"].`;

const nullable = (type: string) => ({ type: [type, "null"] });

const READING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intents", "asks", "language", "roomAreaSqm", "roomSizeBand", "budgetThb", "skus", "opener"],
  properties: {
    intents: { type: "array", minItems: 1, items: { type: "string", enum: LLM_INTENTS } },
    asks: { type: ["string", "null"], enum: [...PRODUCT_ASKS, null] },
    language: { type: "string", enum: ["th", "en"] },
    roomAreaSqm: nullable("number"),
    roomSizeBand: { type: ["string", "null"], enum: ["small", "medium", "large", null] },
    budgetThb: nullable("number"),
    skus: { type: "array", items: { type: "string" } },
    opener: nullable("string"),
  },
};

/** Lower reasoning effort on gpt-oss to stay well within Groq free-tier TPM limits. */
const REASONING_EFFORT: [prefix: string, effort: string][] = [
  ["openai/gpt-oss", "low"],
  ["qwen/qwen3", "none"],
];

const reasoningFor = (model: string) => {
  const effort = REASONING_EFFORT.find(([prefix]) => model.startsWith(prefix))?.[1];
  return effort === undefined ? {} : { reasoning_effort: effort };
};

export interface GroqOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

const DEFAULT_RETRY_AFTER_MS = 1000;
const MIN_CALL_MS = 500;

function retryAfterMs(res: Response): number {
  const seconds = Number(res.headers.get("retry-after") ?? NaN);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS;
}

export function createGroqUnderstander({ apiKey, model, timeoutMs, fetch: fetchImpl = fetch }: GroqOptions): Understander {
  return async (text, ctx) => {
    const deadline = Date.now() + timeoutMs;
    const request = JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_schema", json_schema: { name: "reading", strict: true, schema: READING_SCHEMA } },
      ...reasoningFor(model),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify({ awaiting: ctx.awaiting, earlierMessages: ctx.recentShopperMessages, message: text }) },
      ],
    });
    const call = (ms: number) =>
      fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(ms),
        body: request,
      });

    let res = await call(timeoutMs);
    if (res.status === 429) {
      const wait = retryAfterMs(res);
      if (deadline - Date.now() - wait < MIN_CALL_MS) throw new RateLimitedError(wait);
      await new Promise((r) => setTimeout(r, wait));
      res = await call(deadline - Date.now());
      if (res.status === 429) throw new RateLimitedError(retryAfterMs(res));
    }
    if (!res.ok) throw new Error(`groq http ${res.status}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("groq response has no content");
    return understandingSchema.parse(JSON.parse(content));
  };
}
