import { loadConfig } from "./config.ts";
import { RateLimitedError, type Awaiting, type Intent, type ProductAsk, type Understanding } from "./conversation/understanding.ts";
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

/** One probe per spec requirement that depends on the model's reading; routing edge cases live in the unit tests. */
const PROBES: Probe[] = [
  { id: "4.1.1-room", text: "I need a fan for my 12 m² bedroom", want: ["recommend"], area: 12 },
  { id: "6.1-budget-turn", text: "1500", awaiting: "budget", earlier: ["I need a fan for my 12 m² bedroom"], want: ["recommend"], budget: 1500 },
  { id: "4.1-thai", text: "อยากได้พัดลมสำหรับห้องนอน 15 ตร.ม. งบ 1000 บาท", want: ["recommend"], area: 15, budget: 1000 },
  { id: "4.1-browse", text: "ตอนนี้มีอะไรเหลือบ้าง", earlier: ["Where is my order?"], want: ["browse_catalog"] },
  { id: "6.2-out-of-stock", text: "Is HP-F03 in stock?", want: ["product_info"], asks: "stock" },
  { id: "4.2.2-returns", text: "Can I return a fan I bought last week?", want: ["return_policy"] },
  { id: "4.2.3-order", text: "Where is my order #A1234?", want: ["order_status"] },
  { id: "4.2.3-damaged", text: "พัดลมที่ส่งมาแตกครับ", want: ["damaged_delivery"] },
  { id: "4.2.3-warranty", text: "How long is the warranty on HP-F02?", want: ["warranty"] },
  { id: "4.2.3-outside", text: "Do you deliver to Chiang Mai?", want: ["out_of_scope"] },
];

// Groq free tier allows 8K tokens per minute and a medium-effort reading costs about 1K.
const PACE_MS = 8000;
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
