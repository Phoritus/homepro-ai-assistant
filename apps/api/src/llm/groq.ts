import { RateLimitedError, understandingSchema, type Understander } from "../conversation/understanding.ts";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT = `You read messages sent to a fan shop's chat assistant and return ONLY a JSON object.
You never answer the shopper. You only extract what they said.

Fields (all required, use null when not stated):
- intent: one of
  "sales" (wants a fan, gives room size, budget or a SKU, or asks about a product's price or stock),
  "return_policy" (returns, refunds, exchanges),
  "order_status" (where is my order, tracking, delivery status),
  "damaged_delivery" (item arrived broken or damaged),
  "warranty" (warranty or guarantee questions),
  "staff_request" (wants a human),
  "greeting" (only a greeting),
  "other" (anything else, including questions about things the shop doesn't sell).
- language: "th" if the message is mainly Thai, otherwise "en".
- roomAreaSqm: room area in square metres as a number, or null.
- roomSizeBand: "small", "medium" or "large" only if the shopper uses such a word and gives no area, else null.
- budgetThb: maximum budget in Thai baht as a number, or null.
- sku: a product code like "HP-F01" exactly as written, or null.

If "awaiting" is "budget" and the message is just a number, that number is budgetThb and intent is "sales".
If "awaiting" is "room_size" and the message is just a number, that number is roomAreaSqm and intent is "sales".`;

export interface GroqOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

const DEFAULT_RETRY_AFTER_MS = 1000;
/** The least time worth giving a retried call; a shorter window would only time out. */
const MIN_CALL_MS = 500;

function retryAfterMs(res: Response): number {
  const seconds = Number(res.headers.get("retry-after") ?? NaN);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS;
}

/**
 * Throws on any failure (HTTP, timeout, non-JSON, schema mismatch); the caller owns the fallback.
 * A 429 is retried once after retry-after when that still fits in timeoutMs, else RateLimitedError.
 */
export function createGroqUnderstander({ apiKey, model, timeoutMs, fetch: fetchImpl = fetch }: GroqOptions): Understander {
  return async (text, ctx) => {
    const deadline = Date.now() + timeoutMs;
    const request = JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
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
