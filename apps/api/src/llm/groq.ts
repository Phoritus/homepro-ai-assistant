import { LLM_INTENTS, PRODUCT_ASKS, RateLimitedError, understandingSchema, type Understander } from "../conversation/understanding.ts";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

const TAXONOMY = `Intents (a message may carry more than one; list them in the order the shopper raised them):
- "recommend": wants help choosing a fan, or gives room size or budget. Comparing several SKUs for their room is "recommend".
- "browse_catalog": asks what fans the shop has, sells, has in stock or has left, with no room size, budget or SKU.
- "product_info": asks about ONE named SKU (like "HP-F01"). Set "asks" to what they want to know:
    "price", "stock" (availability), "fit" (is it right for my room), or "unheld" for ANY other attribute
    (wattage, noise, colour, remote, dimensions, features, materials). We only hold name, price, stock and room size.
- "return_policy": returns, refunds, exchanges.
- "order_status": where is my order, tracking, delivery status of an existing order.
- "damaged_delivery": an item arrived broken or damaged.
- "warranty": warranty or guarantee questions.
- "staff_request": wants a human.
- "greeting": a greeting with no request.
- "closing": thanks, goodbye, or ending the chat with no new request.
- "out_of_scope": a question about the shop that staff could answer but the above don't cover, including delivery
    areas or fees for new purchases, payment methods, installments, installation, store hours, promotions, other products.
- "off_topic": not about the shop at all: weather, jokes, news, general knowledge, chit-chat.
    Mentioning hot weather while asking for a fan is "recommend", not "off_topic".
Never use "recommend" or "product_info" just because a message mentions fans or buying; delivery, payment and
installation questions are "out_of_scope" even when they mention a fan.
Drop "greeting" or "closing" when the same message also carries a real request.`;

const SYSTEM_PROMPT = `You read messages sent to a fan shop's chat assistant and return ONLY a JSON object.
You never answer the shopper. You only classify and extract what they said.

${TAXONOMY}

Fields (all required, use null when not stated):
- intents: array of one or more intents, as above.
- asks: for "product_info", one of "price", "stock", "fit", "unheld"; otherwise null.
- language: "th" if the message is mainly Thai, otherwise "en".
- roomAreaSqm: room area in square metres as a number, or null.
- roomSizeBand: "small", "medium" or "large" only if the shopper uses such a word and gives no area, else null.
- budgetThb: maximum budget in Thai baht as a number, or null.
- skus: every product code like "HP-F01" exactly as written, in order; empty array if none.
- opener: one short, warm sentence in the message's language that acknowledges how the shopper feels or what
  they are dealing with, such as sympathy for a damaged item or a hot bedroom. The shop's code writes the rest of the
  reply, so the opener must not answer anything: no numbers, prices, product codes, stock, policies, returns,
  warranty, delivery, orders, promises or questions. Use null for a bare greeting, a goodbye, or a bare number.

If "awaiting" is "budget" and the message is just a number, that number is budgetThb and intents is ["recommend"].
If "awaiting" is "room_size" and the message is just a number, that number is roomAreaSqm and intents is ["recommend"].`;

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

/** Reasoning knob per model family: gpt-oss takes "medium", qwen3 takes "none". Other models get none. */
const REASONING_EFFORT: [prefix: string, effort: string][] = [
  ["openai/gpt-oss", "medium"],
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
