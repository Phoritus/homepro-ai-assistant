#!/usr/bin/env node
// Drives a verification instance of the HomePro assistant over its real HTTP surface.
// Usage: node .claude/skills/verify/scripts/verify.mjs <command> [--port N] [args]
//   start [--llm]            launch an instance (LINE stub, keyword rules unless --llm), wait until ready
//   doctor                   read-only health check of the instance this run started
//   chat <sessionId> <text>  POST /api/chat, print the reply JSON
//   line <userId> <text>     signed LINE webhook event, print the captured reply payload
//   get <path>               GET a page, print status and visible text
//   stop                     kill the instance this run started; evidence is kept
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const RUN_DIR = join(ROOT, ".verify-run");
const EVIDENCE_ROOT = join(ROOT, ".verify-evidence");
const LINE_SECRET = "verify-line-secret";

const args = process.argv.slice(2);
const portFlag = args.indexOf("--port");
const PORT = portFlag >= 0 ? Number(args.splice(portFlag, 2)[1]) : 3299;
const useLlm = args.includes("--llm");
if (useLlm) args.splice(args.indexOf("--llm"), 1);
const [command, ...rest] = args;
const stateFile = join(RUN_DIR, `${PORT}.json`);
const base = `http://127.0.0.1:${PORT}`;

const readState = () => {
  if (!existsSync(stateFile)) fail(`no instance started by verify on port ${PORT}. Run: start --port ${PORT}`);
  return JSON.parse(readFileSync(stateFile, "utf8"));
};
function fail(msg) {
  console.error(`verify: ${msg}`);
  process.exit(1);
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const record = (state, entry) =>
  appendFileSync(join(state.evidenceDir, "transcript.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
const logLines = (state) =>
  readFileSync(join(state.evidenceDir, "server.log"), "utf8").split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function start() {
  if (existsSync(stateFile) && alive(readState().pid)) fail(`an instance from this skill already runs on ${PORT}. stop it or use another --port`);
  if (await fetch(`${base}/health`).then(() => true, () => false)) fail(`port ${PORT} is already served by something this run did not start`);
  const evidenceDir = join(EVIDENCE_ROOT, `${new Date().toISOString().replace(/[:.]/g, "-")}-${PORT}`);
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(RUN_DIR, { recursive: true });
  const out = openSync(join(evidenceDir, "server.log"), "a");
  const env = {
    ...process.env,
    PORT: String(PORT),
    PUBLIC_BASE_URL: base,
    LINE_CHANNEL_SECRET: LINE_SECRET,
    LINE_MODE: "stub",
    ...(useLlm ? {} : { GROQ_API_KEY: "" }),
  };
  const child = spawn(process.execPath, ["--env-file-if-exists=.env", "apps/api/src/main.ts"], {
    cwd: ROOT, env, detached: true, stdio: ["ignore", out, out], windowsHide: true,
  });
  child.unref();
  const state = { pid: child.pid, port: PORT, evidenceDir, startedAt: new Date().toISOString() };
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
  for (let i = 0; i < 40; i++) {
    const started = logLines(state).find((l) => l.event === "server_started");
    if (started) {
      console.log(JSON.stringify({ ready: true, ...state, llm: started.llm, line: started.line }, null, 2));
      return;
    }
    if (!alive(child.pid)) fail(`server exited during startup. See ${join(evidenceDir, "server.log")}`);
    await wait(250);
  }
  fail(`no server_started line after 10s. See ${join(evidenceDir, "server.log")}`);
}

async function doctor() {
  const state = readState();
  const checks = { pidAlive: alive(state.pid), health: null, mode: null, evidenceDir: state.evidenceDir };
  try {
    checks.health = await (await fetch(`${base}/health`)).json();
  } catch (e) {
    checks.health = `unreachable: ${e.message}`;
  }
  const started = logLines(state).find((l) => l.event === "server_started");
  checks.mode = started ? { port: started.port, llm: started.llm, line: started.line } : "no server_started line";
  const ok = checks.pidAlive && checks.health?.ok === true && checks.health?.line === true && started?.port === PORT;
  console.log(JSON.stringify({ ok, ...checks }, null, 2));
  if (!ok) process.exit(1);
}

async function chat(sessionId, text) {
  const state = readState();
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, message: text }),
  });
  const body = await res.json();
  record(state, { channel: "web", sessionId, sent: text, status: res.status, reply: body });
  console.log(JSON.stringify({ status: res.status, reply: body }, null, 2));
}

async function line(userId, text) {
  const state = readState();
  const replyToken = `verify-${Date.now()}`;
  const body = JSON.stringify({
    destination: "Uverify",
    events: [{ type: "message", replyToken, source: { type: "user", userId }, message: { type: "text", text } }],
  });
  const before = logLines(state).filter((l) => l.event === "line_reply_stubbed").length;
  const res = await fetch(`${base}/webhooks/line`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": createHmac("sha256", LINE_SECRET).update(body).digest("base64") },
    body,
  });
  await wait(100);
  const captured = logLines(state).filter((l) => l.event === "line_reply_stubbed").slice(before).map((l) => l.messages);
  record(state, { channel: "line", userId, sent: text, status: res.status, captured });
  console.log(JSON.stringify({ status: res.status, captured }, null, 2));
}

async function get(path) {
  const state = readState();
  const res = await fetch(`${base}/${path.replace(/^\/+/, "")}`);
  const html = await res.text();
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  record(state, { channel: "http", get: path, status: res.status, text: text.slice(0, 500) });
  console.log(JSON.stringify({ status: res.status, text: text.slice(0, 500) }, null, 2));
}

function stop() {
  const state = readState();
  if (alive(state.pid)) process.kill(state.pid);
  rmSync(stateFile);
  console.log(JSON.stringify({ stopped: state.pid, evidenceKept: state.evidenceDir }, null, 2));
}

const text = rest.slice(1).join(" ");
switch (command) {
  case "start": await start(); break;
  case "doctor": await doctor(); break;
  case "chat": await chat(rest[0], text); break;
  case "line": await line(rest[0], text); break;
  case "get": await get(rest[0] ?? ""); break;
  case "stop": stop(); break;
  default: fail("commands: start [--llm] | doctor | chat <sessionId> <text> | line <userId> <text> | get <path> | stop  (all accept --port N)");
}
