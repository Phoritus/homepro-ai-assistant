import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import type { Understander } from "./conversation/understanding.ts";
import { createGroqUnderstander } from "./llm/groq.ts";
import { resultsMarkdown, runScenarios } from "./scenarios.ts";

const useLlm = process.argv.includes("--llm");
const config = loadConfig();
if (useLlm && !config.groq) {
  console.error("--llm needs GROQ_API_KEY in .env");
  process.exit(2);
}

// The keyword fallback passes these scenarios on its own, so an --llm run must prove Groq actually answered.
const calls = { ok: 0, failed: 0, errors: new Set<string>() };
const groq = useLlm && config.groq ? createGroqUnderstander(config.groq) : null;
const llm: Understander | null = groq
  ? async (text, ctx) => {
      try {
        const u = await groq(text, ctx);
        calls.ok++;
        return u;
      } catch (err) {
        calls.failed++;
        calls.errors.add(err instanceof Error ? err.message.split("\n")[0] ?? "" : String(err));
        throw err;
      }
    }
  : null;

const results = await runScenarios(llm);
const llmHealthy = !llm || (calls.ok > 0 && calls.failed === 0);
const mode = llm
  ? `Groq LLM (${config.groq?.model}) with keyword fallback · real LLM calls: ${calls.ok} ok, ${calls.failed} failed`
  : "keyword rules (no LLM)";
const out = new URL(`../../../docs/test-results${useLlm ? "-llm" : ""}.md`, import.meta.url);
writeFileSync(out, resultsMarkdown(results, mode, new Date()));

for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  #${r.id} ${r.name}\n      ${r.observed}`);
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed. ${mode}. Written to ${fileURLToPath(out)}`);
if (!llmHealthy) console.error(`LLM check FAILED: ${[...calls.errors].join("; ") || "no LLM calls made"}`);
process.exitCode = passed === results.length && llmHealthy ? 0 : 1;
