import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import { MAX_MESSAGE_CHARS, type Assistant } from "./assistant.ts";
import { parseLineWebhook, toLineMessages, verifyLineSignature, type LineReplyClient } from "./channels/line.ts";
import { CATALOG, findProduct, STORE_NAME } from "./domain/catalog.ts";
import type { Logger } from "./log.ts";

export interface ServerDeps {
  assistant: Assistant;
  log: Logger;
  /** null when LINE isn't configured: the webhook answers 503. */
  line: { channelSecret: string; client: LineReplyClient } | null;
}

const MAX_BODY_BYTES = 64 * 1024;
const WEB_CHAT_HTML = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

const chatRequest = z.object({
  sessionId: z.string().regex(/^[\w-]{8,100}$/),
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function parseJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

const send = (res: ServerResponse, status: number, body: string, type: string) => {
  res.writeHead(status, { "content-type": `${type}; charset=utf-8` });
  res.end(body);
};
const sendJson = (res: ServerResponse, status: number, body: unknown) => send(res, status, JSON.stringify(body), "application/json");

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<title>${escapeHtml(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem}` +
  `.demo{background:#fff4d6;border:1px solid #e6c36a;padding:.5rem .75rem;border-radius:6px}</style></head>` +
  `<body><p class="demo">Demo only. Fictional catalog, no payments, no real orders.</p>${body}<p><a href="/">Back to chat</a></p></body></html>`;

function productPage(sku: string): string | null {
  const p = findProduct(sku);
  if (!p) return null;
  const stock = p.stock > 0 ? `${p.stock} in stock at ${STORE_NAME}` : "Out of stock";
  return page(`${p.sku} ${p.name.en}`, `<h1>${escapeHtml(p.sku)} ${escapeHtml(p.name.en)}</h1><p>${escapeHtml(p.name.th)}</p>` +
    `<p><strong>฿${p.priceThb.toLocaleString("en-US")}</strong> · ${p.band} room · ${stock}</p>` +
    (p.stock > 0 ? `<p><a href="/demo/checkout?sku=${encodeURIComponent(p.sku)}">Demo checkout</a></p>` : ""));
}

export function createApp({ assistant, log, line }: ServerDeps) {
  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://local");
    const method = req.method ?? "GET";

    if (method === "GET" && url.pathname === "/") return send(res, 200, WEB_CHAT_HTML, "text/html");
    if (method === "GET" && url.pathname === "/health") return sendJson(res, 200, { ok: true, line: line !== null });

    if (method === "POST" && url.pathname === "/api/chat") {
      const parsed = chatRequest.safeParse(parseJson(await readBody(req)));
      if (!parsed.success) throw new HttpError(400, "expected { sessionId, message }");
      const { reply } = await assistant.respond("web", parsed.data.sessionId, parsed.data.message);
      return sendJson(res, 200, reply);
    }

    if (method === "POST" && url.pathname === "/webhooks/line") {
      if (!line) throw new HttpError(503, "LINE channel not configured");
      const raw = await readBody(req);
      const signature = req.headers["x-line-signature"];
      if (!verifyLineSignature(raw, typeof signature === "string" ? signature : undefined, line.channelSecret)) {
        throw new HttpError(401, "bad signature");
      }
      const events = parseLineWebhook(parseJson(raw));
      if (events === null) throw new HttpError(400, "not a LINE webhook body");
      // Reply tokens are single-use and expire, so a LINE redelivery can never fix a failed reply:
      // log it, finish the batch, and acknowledge with 200.
      for (const ev of events) {
        try {
          const { reply } = await assistant.respond("line", ev.userId, ev.text);
          await line.client.reply(ev.replyToken, toLineMessages(reply));
        } catch (err) {
          log.warn("line_reply_failed", { userId: ev.userId, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return sendJson(res, 200, { ok: true });
    }

    const productMatch = /^\/demo\/products\/([\w-]+)$/.exec(url.pathname);
    if (method === "GET" && productMatch?.[1]) {
      const html = productPage(productMatch[1]);
      return html ? send(res, 200, html, "text/html") : send(res, 404, page("Not found", "<h1>Unknown product</h1>"), "text/html");
    }
    if (method === "GET" && url.pathname === "/demo/checkout") {
      const p = findProduct(url.searchParams.get("sku") ?? "");
      const body = p && p.stock > 0
        ? `<h1>Demo checkout</h1><p>${escapeHtml(p.sku)} ${escapeHtml(p.name.en)}, ฿${p.priceThb.toLocaleString("en-US")}.</p><p>This is where checkout would start. No payment is taken and no order is created.</p>`
        : `<h1>Not available</h1><p>Choose one of: ${CATALOG.filter((x) => x.stock > 0).map((x) => x.sku).join(", ")}.</p>`;
      return send(res, 200, page("Demo checkout", body), "text/html");
    }

    throw new HttpError(404, "not found");
  }

  return (req: IncomingMessage, res: ServerResponse) => {
    const started = Date.now();
    route(req, res)
      .catch((err: unknown) => {
        if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
        log.error("request_failed", { path: req.url, error: err instanceof Error ? err.stack : String(err) });
        return sendJson(res, 500, { error: "internal error" });
      })
      .finally(() => log.info("http", { method: req.method, path: req.url?.split("?")[0], status: res.statusCode, ms: Date.now() - started }));
  };
}

export const createHttpServer = (deps: ServerDeps): Server => createServer(createApp(deps));
