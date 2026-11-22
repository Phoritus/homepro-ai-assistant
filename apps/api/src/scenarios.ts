import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { AssistantReply } from "@homepro/shared";
import { createAssistant } from "./assistant.ts";
import { createStubLineClient, type LineMessage } from "./channels/line.ts";
import { createMemorySessionStore } from "./conversation/session.ts";
import type { Understander } from "./conversation/understanding.ts";
import { createGroqUnderstander } from "./llm/groq.ts";
import { silentLogger } from "./log.ts";
import { createHttpServer } from "./server.ts";

export interface ScenarioResult {
  id: number;
  name: string;
  input: string;
  expected: string;
  observed: string;
  pass: boolean;
}

const LINE_SECRET = "scenario-test-secret";

interface Harness {
  web(sessionId: string, message: string): Promise<AssistantReply>;
  line(userId: string, message: string): Promise<LineMessage[]>;
  close(): Promise<void>;
}

async function startHarness(llm: Understander | null): Promise<Harness> {
  const stub = createStubLineClient(silentLogger);
  const assistant = createAssistant({ sessions: createMemorySessionStore(30 * 60_000), llm, log: silentLogger, baseUrl: "http://demo.local" });
  const server = createHttpServer({ assistant, log: silentLogger, line: { channelSecret: LINE_SECRET, client: stub } });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let token = 0;

  return {
    async web(sessionId, message) {
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, message }),
      });
      if (!res.ok) throw new Error(`web chat HTTP ${res.status}`);
      return (await res.json()) as AssistantReply;
    },
    async line(userId, message) {
      const replyToken = `rt-${++token}`;
      const body = JSON.stringify({
        destination: "Uscenario",
        events: [{ type: "message", replyToken, source: { type: "user", userId }, message: { type: "text", text: message } }],
      });
      const signature = createHmac("sha256", LINE_SECRET).update(body).digest("base64");
      const res = await fetch(`${base}/webhooks/line`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-line-signature": signature },
        body,
      });
      if (!res.ok) throw new Error(`LINE webhook HTTP ${res.status}`);
      const captured = stub.captured.find((c) => c.replyToken === replyToken);
      if (!captured) throw new Error("no LINE reply captured");
      return captured.messages;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const lineText = (ms: LineMessage[]) => ms.flatMap((m) => (m.type === "text" ? [m.text] : [])).join("\n");
const lineUris = (ms: LineMessage[]) => ms.flatMap((m) => (m.type === "template" ? m.template.actions.map((a) => a.uri) : []));

/** The real Groq client with a broken transport, so the real failure handling runs. */
const failingGroq = (failure: "network" | "garbage"): Understander =>
  createGroqUnderstander({
    apiKey: "simulated",
    model: "simulated",
    timeoutMs: 1000,
    fetch: async () => {
      if (failure === "network") throw new TypeError("fetch failed (simulated outage)");
      return new Response(JSON.stringify({ choices: [{ message: { content: "not json {" } }] }), { status: 200 });
    },
  });

/** Spec §6 mandatory scenarios, driven over real HTTP against the real server. */
export async function runScenarios(llm: Understander | null): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  const h = await startHarness(llm);
  try {
    {
      const first = await h.web("scenario-1-multiturn", "I need a fan for my 12 m² bedroom");
      const second = await h.web("scenario-1-multiturn", "My budget is 1,000 baht");
      const pass = /budget/i.test(first.text) && first.actions.length === 0 && second.text.includes("HP-F01") && second.text.includes("฿890")
        && second.actions.some((a) => a.kind === "demo_checkout" && a.sku === "HP-F01");
      results.push({
        id: 1, name: "Multi-turn sales flow",
        input: 'Turn 1: "I need a fan for my 12 m² bedroom" / Turn 2: "My budget is 1,000 baht"',
        expected: "Turn 1 asks for budget only. Turn 2 recommends HP-F01 ฿890 with reason and demo checkout link, without re-asking room size.",
        observed: `T1: ${oneLine(first.text)} | T2: ${oneLine(second.text)} | actions: ${second.actions.map((a) => `${a.kind}:${a.sku}`).join(", ")}`,
        pass,
      });
    }
    {
      const a = await h.web("scenario-2-oos", "Do you have HP-F03? My budget is 2,000 baht");
      const b = await h.web("scenario-2-budget", "12 m² room, budget 500 baht");
      const offered = (r: AssistantReply) => [...new Set(r.actions.map((x) => x.sku))];
      const pass = /HP-F03.*out of stock/.test(a.text) && !offered(a).includes("HP-F03") && offered(a).includes("HP-F02")
        && /above your ฿500 budget/.test(b.text) && b.actions.length === 0;
      results.push({
        id: 2, name: "Out-of-stock / over-budget handling",
        input: '"Do you have HP-F03? My budget is 2,000 baht" and "12 m² room, budget 500 baht"',
        expected: "HP-F03 stated out of stock, HP-F02 offered with size mismatch noted. ฿500 gets a clear no-match, nothing offered.",
        observed: `${oneLine(a.text)} [offered: ${offered(a).join(", ") || "none"}] | ${oneLine(b.text)} [offered: ${offered(b).join(", ") || "none"}]`,
        pass,
      });
    }
    {
      const r = await h.web("scenario-3-returns", "Can I return a fan I bought last week?");
      const pass = /SUP-01/.test(r.text) && /14 days/.test(r.text) && /unopened/.test(r.text) && /proof of purchase/.test(r.text)
        && /not guaranteed/.test(r.text) && !/will be (approved|refunded)|guaranteed (approval|refund)/i.test(r.text);
      results.push({
        id: 3, name: "Returns policy compliance (SUP-01)",
        input: '"Can I return a fan I bought last week?"',
        expected: "Cites SUP-01: 14 days, unopened, proof of purchase. States approval is not guaranteed.",
        observed: oneLine(r.text),
        pass,
      });
    }
    {
      const order = await h.web("scenario-4-order", "Where is my order #A1234?");
      const damaged = await h.web("scenario-4-damaged", "My fan arrived damaged");
      const leaks = (r: AssistantReply) => /shipped|in transit|out for delivery|delivered on|ticket (#|no\.|number:)/i.test(r.text)
        || (r.handoff !== null && r.text.includes(r.handoff.handoffId));
      const pass = [order, damaged].every((r) => r.handoff !== null && /no order lookup or real ticketing/.test(r.text) && !leaks(r))
        && order.handoff?.reason === "order_status" && damaged.handoff?.reason === "damaged_delivery";
      results.push({
        id: 4, name: "Handoff & anti-hallucination (SUP-02)",
        input: '"Where is my order #A1234?" and "My fan arrived damaged"',
        expected: "Both hand off to staff under SUP-02, state there is no order lookup or ticketing, invent no status or ticket ID.",
        observed: `order: reason=${order.handoff?.reason} "${oneLine(order.text).slice(0, 110)}..." | damaged: reason=${damaged.handoff?.reason}`,
        pass,
      });
    }
    {
      const question = "Large living room, 30 m², budget 2,000 baht";
      const web = await h.web("scenario-5-parity", question);
      const line = await h.line("U-scenario-5-parity", question);
      const webUris = web.actions.map((a) => a.url);
      const pass = web.text === lineText(line) && JSON.stringify(webUris) === JSON.stringify(lineUris(line)) && webUris.length > 0;
      results.push({
        id: 5, name: "Cross-channel parity",
        input: `"${question}" on Web Chat and as a signed LINE webhook event`,
        expected: "Identical reply text and identical next-step links on both channels.",
        observed: `text equal: ${web.text === lineText(line)}; web links: ${webUris.join(", ")}; LINE links: ${lineUris(line).join(", ")}`,
        pass,
      });
    }
  } finally {
    await h.close();
  }

  for (const failure of ["network", "garbage"] as const) {
    const f = await startHarness(failingGroq(failure));
    try {
      const unknown = await f.web(`scenario-6-${failure}-a`, "Tell me something interesting");
      const sales = await f.web(`scenario-6-${failure}-b`, "12 m² room, budget 1,000 baht");
      const pass = /can't process that right now/.test(unknown.text) && unknown.handoff === null && unknown.actions.length === 0
        && sales.text.includes("HP-F01");
      results.push({
        id: 6, name: `Model failure resilience (${failure === "network" ? "network outage" : "invalid LLM output"})`,
        input: `LLM ${failure === "network" ? "fetch throws" : "returns non-JSON"}; "Tell me something interesting" then "12 m² room, budget 1,000 baht"`,
        expected: "No exception. Unknown message gets the safe fallback message. Sales message still answered from deterministic rules (HP-F01).",
        observed: `${oneLine(unknown.text).slice(0, 80)}... | ${oneLine(sales.text).slice(0, 90)}`,
        pass,
      });
    } finally {
      await f.close();
    }
  }
  return results;
}

export function resultsMarkdown(results: ScenarioResult[], mode: string, ranAt: Date): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const passed = results.filter((r) => r.pass).length;
  return [
    "# Scenario test results",
    "",
    `Run: ${ranAt.toISOString()} · Understanding: ${mode} · Generated by \`npm run scenarios\`.`,
    "",
    "| # | Scenario | Input | Expected | Observed | Status |",
    "| :- | :- | :- | :- | :- | :- |",
    ...results.map((r) => `| ${r.id} | ${cell(r.name)} | ${cell(r.input)} | ${cell(r.expected)} | ${cell(r.observed)} | ${r.pass ? "PASS" : "FAIL"} |`),
    "",
    `**Total passed: ${passed} / ${results.length}**`,
    "",
    "**Known limitation:** sessions live in process memory, so a server restart forgets every conversation, and running more than one server instance would split a shopper's history. LINE live delivery is unverified when the stub reply client is used (it is in this run).",
    "",
  ].join("\n");
}
