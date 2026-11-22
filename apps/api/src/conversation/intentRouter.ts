import type { LlmIntent } from "./understanding.ts";

/** Intents the router picks from example phrases. product_info is not here: one SKU in the message decides it. */
export type RoutedIntent = Exclude<LlmIntent, "product_info">;

/**
 * Example phrases per intent, English and Thai. A message clause goes to the intent of its most similar example.
 * To teach the fallback a new wording, add a phrase here rather than a regex.
 */
export const INTENT_EXAMPLES: Record<RoutedIntent, readonly string[]> = {
  recommend: [
    "recommend a fan for my room", "which fan should I buy", "I need a fan for my bedroom", "help me choose a fan",
    "suggest a fan within my budget", "it's so hot I want a fan", "compare these two fans for my room", "how much is a fan",
    "แนะนำพัดลมหน่อย", "อยากได้พัดลมสำหรับห้องนอน", "ช่วยเลือกพัดลมให้หน่อย", "ร้อนมาก อยากซื้อพัดลม", "งบประมาณไม่เกินพันห้า",
  ],
  browse_catalog: [
    "what products do you sell", "show me everything you have", "list all your fans", "what's in your catalog",
    "what models are available", "show all items you carry", "what's left in stock", "give me all your products",
    "มีสินค้าอะไรบ้าง", "ขายอะไรบ้าง", "มีพัดลมรุ่นอะไรขายบ้าง", "ขอดูสินค้าทั้งหมด", "ร้านนี้ขายอะไร", "ตอนนี้เหลืออะไรบ้าง",
  ],
  return_policy: [
    "what is your return policy", "can I return this item", "how do refunds work", "I want to exchange my fan",
    "what are your store policies", "tell me all your policies", "send it back for a refund", "can I get my money back",
    "นโยบายการคืนสินค้า", "ขอทราบนโยบายร้าน", "ขอดูนโยบาย", "ขอคืนสินค้าได้ไหม", "คืนเงินได้ไหม", "เปลี่ยนสินค้าได้ไหม", "นโยบายของร้านมีอะไรบ้าง",
  ],
  order_status: [
    "where is my order", "track my order", "has my order shipped", "when will my package arrive", "check my order status", "where is my parcel", "has it been sent out yet",
    "ติดตามพัสดุ", "สถานะคำสั่งซื้อ", "ของที่สั่งไปถึงไหนแล้ว", "สั่งไปเมื่อไหร่จะได้",
  ],
  damaged_delivery: [
    "my fan arrived broken", "the item came damaged", "the fan is cracked", "received a defective fan", "it showed up smashed",
    "ของมาถึงแล้วแตก", "พัดลมที่ได้รับชำรุด", "สินค้าเสียหายตอนส่งมา", "พัดลมพัง",
  ],
  warranty: [
    "is there a warranty", "how long is the guarantee", "will you repair it under warranty",
    "รับประกันกี่ปี", "มีประกันไหม", "ซ่อมฟรีไหมถ้าเสีย",
  ],
  staff_request: [
    "talk to a human", "I want a real person", "connect me to an agent", "staff please", "let me speak to someone",
    "ขอคุยกับเจ้าหน้าที่", "ขอคุยกับคน", "ติดต่อพนักงาน",
  ],
  greeting: ["hi", "hello there", "good morning", "hey", "สวัสดีครับ", "สวัสดีค่ะ", "สอบถามข้อมูลหน่อย"],
  closing: ["thanks", "thank you that's all", "ok bye", "goodbye", "ขอบคุณครับ", "ขอบคุณค่ะ", "บายนะ"],
  out_of_scope: [
    "how much is shipping", "do you deliver to my province", "can I pay by credit card", "do you offer installments",
    "can you install it for me", "what are your opening hours", "any promotions now", "do you sell air conditioners",
    "ค่าส่งเท่าไหร่", "ส่งของต่างจังหวัดไหม", "ผ่อนได้ไหม", "ติดตั้งให้ไหม", "ร้านเปิดกี่โมง", "มีโปรโมชั่นไหม", "ขายแอร์ไหม",
  ],
  off_topic: [
    "what's the weather like", "tell me a joke", "who won the football game", "what's your favourite movie",
    "อากาศวันนี้เป็นยังไง", "เล่ามุกหน่อย", "เล่าเรื่องตลก", "ใครชนะบอลเมื่อคืน",
  ],
};

/** Below this cosine a clause matches no intent. Tuned so unrelated questions score below it (see routing.test.ts). */
const MIN_SIMILARITY = 0.35;
const GRAM_SIZES = [2, 3, 4];

// Character n-grams need no word segmenter, which Thai (written without spaces) would otherwise require.
function grams(text: string): string[] {
  const s = ` ${text.toLowerCase().replace(/\s+/g, " ").trim()} `;
  return GRAM_SIZES.flatMap((n) => Array.from({ length: Math.max(0, s.length - n + 1) }, (_, i) => s.slice(i, i + n)));
}

type Vector = Map<string, number>;

const examples = Object.entries(INTENT_EXAMPLES).flatMap(([intent, phrases]) =>
  phrases.map((phrase) => ({ intent: intent as RoutedIntent, grams: grams(phrase) })),
);
const documentFrequency = new Map<string, number>();
for (const { grams: g } of examples) for (const gram of new Set(g)) documentFrequency.set(gram, (documentFrequency.get(gram) ?? 0) + 1);

/** TF-IDF weights; n-grams no example uses carry no signal and are dropped. */
function vectorize(g: string[]): Vector {
  const v: Vector = new Map();
  for (const gram of g) {
    const df = documentFrequency.get(gram);
    if (df !== undefined) v.set(gram, (v.get(gram) ?? 0) + Math.log(1 + examples.length / df));
  }
  return v;
}

const norm = (v: Vector) => Math.sqrt([...v.values()].reduce((sum, w) => sum + w * w, 0));

const exampleVectors = examples.map((e) => {
  const vector = vectorize(e.grams);
  return { intent: e.intent, vector, norm: norm(vector) };
});

function cosine(a: Vector, aNorm: number, b: Vector, bNorm: number): number {
  let dot = 0;
  for (const [gram, w] of a) dot += w * (b.get(gram) ?? 0);
  return dot / (aNorm * bNorm || 1);
}

export interface RoutedClause {
  intent: RoutedIntent;
  /** Where the clause starts in the message, so intents keep the order the shopper raised them. */
  at: number;
  similarity: number;
}

/** "Where is my order? Also recommend a fan" is two requests; each clause is routed on its own. */
const CLAUSE_BREAK = /[?!.\n]+|\balso\b|แล้วก็/gi;

function clauses(text: string): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  let start = 0;
  for (const m of [...text.matchAll(CLAUSE_BREAK), { index: text.length, 0: "" }]) {
    const piece = text.slice(start, m.index);
    if (piece.trim().length > 1) out.push({ text: piece.trim(), at: start + piece.search(/\S/) });
    start = m.index + m[0].length;
  }
  return out;
}

/** Each clause's nearest intent by cosine similarity of character n-gram TF-IDF vectors, in message order. */
export function routeIntents(text: string): RoutedClause[] {
  return clauses(text).flatMap((clause) => {
    const v = vectorize(grams(clause.text));
    const vNorm = norm(v);
    let best: RoutedClause | null = null;
    for (const e of exampleVectors) {
      const similarity = cosine(v, vNorm, e.vector, e.norm);
      if (similarity > (best?.similarity ?? MIN_SIMILARITY)) best = { intent: e.intent, at: clause.at, similarity };
    }
    return best ? [best] : [];
  });
}
