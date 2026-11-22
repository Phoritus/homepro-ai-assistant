import { loadConfig } from "./config.ts";
import type { Awaiting, Intent, ProductAsk, Understanding } from "./conversation/understanding.ts";
import { RateLimitedError } from "./conversation/understanding.ts";
import { createGroqUnderstander } from "./llm/groq.ts";

interface Probe {
  id: string;
  text: string;
  want: Intent[];
  asks?: ProductAsk;
  alsoOk?: Intent[][];
  awaiting?: Awaiting;
  earlier?: string[];
  budget?: number;
  area?: number;
}

const PROBES: Probe[] = [
  { id: "001a", text: "What is the wattage of HP-F01?", want: ["product_info"], asks: "unheld" },
  { id: "001b", text: "Does HP-F02 come with a remote control?", want: ["product_info"], asks: "unheld" },
  { id: "001c", text: "How loud is HP-F02 in decibels?", want: ["product_info"], asks: "unheld" },
  { id: "001d", text: "HP-F01 มีกี่สี", want: ["product_info"], asks: "unheld" },
  { id: "pi1", text: "How much is HP-F02?", want: ["product_info"], asks: "price" },
  { id: "pi2", text: "Is HP-F03 in stock?", want: ["product_info"], asks: "stock" },
  { id: "pi3", text: "I have a 20 sqm room. Is HP-F01 good for me?", want: ["product_info"], asks: "fit" },
  { id: "pi4", text: "HP-F01 ราคาเท่าไหร่", want: ["product_info"], asks: "price" },
  { id: "pi5", text: "Do you have HP-F03? My budget is 2,000 baht", want: ["product_info"], asks: "stock" },
  { id: "002a", text: "Do you deliver to Chiang Mai?", want: ["out_of_scope"] },
  { id: "002b", text: "Can I pay for a fan in installments?", want: ["out_of_scope"] },
  { id: "002c", text: "Do you offer installation for ceiling fans?", want: ["out_of_scope"] },
  { id: "002d", text: "ผ่อนชำระได้ไหมครับ", want: ["out_of_scope"] },
  { id: "002e", text: "What time does the store open?", want: ["out_of_scope"] },
  { id: "002f", text: "Any promotions on fans this month?", want: ["out_of_scope"] },
  { id: "002g", text: "Do you sell air conditioners?", want: ["out_of_scope"] },
  { id: "002h", text: "Tell me a joke", want: ["out_of_scope"] },
  { id: "004a", text: "thanks, that's all", want: ["closing"] },
  { id: "004b", text: "ok bye", want: ["closing"] },
  { id: "004c", text: "thank you!", want: ["closing"] },
  { id: "004d", text: "ขอบคุณครับ", want: ["closing"] },
  { id: "004e", text: "great, I'll think about it", want: ["closing"] },
  { id: "g1", text: "Hello", want: ["greeting"] },
  { id: "g2", text: "สวัสดีค่ะ", want: ["greeting"] },
  { id: "r1", text: "I need a fan for my 12 m² bedroom", want: ["recommend"] },
  { id: "r2", text: "Large living room, 30 m², budget 2,000 baht", want: ["recommend"] },
  { id: "r3", text: "อยากได้พัดลมสำหรับห้องนอน 15 ตร.ม. งบ 1000 บาท", want: ["recommend"] },
  { id: "r4", text: "Which is better for a 20 sqm room, HP-F01 or HP-F02? budget 2000", want: ["recommend"] },
  { id: "r5", text: "recommend me a fan", want: ["recommend"] },
  { id: "s1", text: "Can I return a fan I bought last week?", want: ["return_policy"] },
  { id: "s2", text: "Where is my order #A1234?", want: ["order_status"] },
  { id: "s3", text: "My fan arrived damaged", want: ["damaged_delivery"] },
  { id: "s4", text: "How long is the warranty on HP-F02?", want: ["warranty"] },
  { id: "s5", text: "I want to talk to a real person", want: ["staff_request"] },
  { id: "s6", text: "พัดลมที่ส่งมาแตกครับ", want: ["damaged_delivery"] },
  { id: "011a", text: "Where is my order? Also recommend a fan for 12 sqm under 1000", want: ["order_status", "recommend"] },
  { id: "011b", text: "Thanks! One more thing, can I return an opened fan?", want: ["return_policy"], alsoOk: [["closing", "return_policy"]] },
  {
    id: "011c",
    text: "Hi, what's the price of HP-F01 and do you deliver?",
    want: ["product_info", "out_of_scope"],
    asks: "price",
    alsoOk: [["greeting", "product_info", "out_of_scope"]],
  },
  { id: "ctx1", text: "1500", awaiting: "budget", earlier: ["I need a fan for my 12 m² bedroom"], want: ["recommend"], budget: 1500 },
  { id: "ctx2", text: "about 20", awaiting: "room_size", earlier: ["recommend me a fan"], want: ["recommend"], area: 20 },
];

const PACE_MS = 2100;
const PASS_RATE = 0.95;
const MAX_WAIT_MS = 30_000;

const sameIntents = (a: readonly Intent[], b: readonly Intent[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function passes(probe: Probe, out: Understanding): boolean {
  if (![probe.want, ...(probe.alsoOk ?? [])].some((w) => sameIntents(w, out.intents))) return false;
  if (out.intents.includes("product_info") && probe.asks && out.asks !== probe.asks) return false;
  if (probe.budget && out.budgetThb !== probe.budget) return false;
  if (probe.area && out.roomAreaSqm !== probe.area) return false;
  return true;
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const groq = loadConfig().groq;
if (!groq) {
  console.error("GROQ_API_KEY is not set; the eval needs the real model.");
  process.exit(2);
}
const understand = createGroqUnderstander({ ...groq, timeoutMs: Math.max(groq.timeoutMs, 30_000) });

/** Free-tier limits throttle a long run; waiting out a 429 keeps them from being scored as model misses. */
async function understandPatiently(...args: Parameters<typeof understand>) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await understand(...args);
    } catch (err) {
      if (!(err instanceof RateLimitedError) || attempt >= 3 || err.retryAfterMs > MAX_WAIT_MS) throw err;
      await sleep(err.retryAfterMs + 500);
    }
  }
}

const latencies: number[] = [];
const failures: string[] = [];
for (const probe of PROBES) {
  const started = Date.now();
  try {
    const out = await understandPatiently(probe.text, { awaiting: probe.awaiting ?? null, recentShopperMessages: probe.earlier ?? [] });
    latencies.push(Date.now() - started);
    if (!passes(probe, out)) failures.push(`${probe.id} got ${JSON.stringify(out.intents)}${out.asks ? `/${out.asks}` : ""} want ${JSON.stringify(probe.want)}`);
  } catch (err) {
    failures.push(`${probe.id} error ${err instanceof Error ? err.message : String(err)}`);
  }
  console.error(`${probe.id} ${Date.now() - started} ms`);
  await sleep(Math.max(0, PACE_MS - (Date.now() - started)));
}

const passed = PROBES.length - failures.length;
const sorted = [...latencies].sort((a, b) => a - b);
console.log(`${groq.model}: ${passed}/${PROBES.length} passed, p50 ${percentile(sorted, 0.5)} ms, p95 ${percentile(sorted, 0.95)} ms`);
for (const f of failures) console.log(`  fail ${f}`);
process.exit(passed / PROBES.length >= PASS_RATE ? 0 : 1);
