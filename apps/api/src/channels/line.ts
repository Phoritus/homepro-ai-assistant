import { createHmac, timingSafeEqual } from "node:crypto";
import type { AssistantReply } from "@homepro/shared";
import { z } from "zod";
import type { Logger } from "../log.ts";

const REPLY_ENDPOINT = "https://api.line.me/v2/bot/message/reply";

export function verifyLineSignature(rawBody: Buffer, signature: string | undefined, channelSecret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", channelSecret).update(rawBody).digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const textEvent = z.object({
  type: z.literal("message"),
  replyToken: z.string(),
  source: z.object({ userId: z.string() }),
  message: z.object({ type: z.literal("text"), text: z.string() }),
});

const webhookBody = z.object({ events: z.array(z.unknown()) });

export interface LineTextEvent {
  replyToken: string;
  userId: string;
  text: string;
}

/** Keeps text messages from users; follows, stickers, images and group events are ignored. */
export function parseLineWebhook(body: unknown): LineTextEvent[] | null {
  const parsed = webhookBody.safeParse(body);
  if (!parsed.success) return null;
  return parsed.data.events.flatMap((e) => {
    const ev = textEvent.safeParse(e);
    return ev.success ? [{ replyToken: ev.data.replyToken, userId: ev.data.source.userId, text: ev.data.message.text }] : [];
  });
}

export type LineMessage =
  | { type: "text"; text: string }
  | {
      type: "template";
      altText: string;
      template: { type: "buttons"; text: string; actions: { type: "uri"; label: string; uri: string }[] };
    };

const BUTTON_LABEL = {
  en: { view: (sku: string) => `View ${sku}`, checkout: "Demo checkout", prompt: "Next step (demo links)" },
  th: { view: (sku: string) => `ดู ${sku}`, checkout: "สั่งซื้อ (เดโม)", prompt: "ขั้นตอนถัดไป (ลิงก์เดโม)" },
} as const;

/** Same text and the same links as Web Chat; only the envelope differs. LINE allows 4 buttons, 20-char labels. */
export function toLineMessages(reply: AssistantReply): LineMessage[] {
  const messages: LineMessage[] = [{ type: "text", text: reply.text.slice(0, 5000) }];
  if (reply.actions.length === 0) return messages;
  const l = BUTTON_LABEL[reply.language];
  messages.push({
    type: "template",
    altText: l.prompt,
    template: {
      type: "buttons",
      text: l.prompt,
      actions: reply.actions.slice(0, 4).map((a) => ({
        type: "uri",
        label: (a.kind === "view_product" ? l.view(a.sku) : l.checkout).slice(0, 20),
        uri: a.url,
      })),
    },
  });
  return messages;
}

export interface LineReplyClient {
  reply(replyToken: string, messages: LineMessage[]): Promise<void>;
}

export function createLiveLineClient(accessToken: string, fetchImpl: typeof fetch = fetch): LineReplyClient {
  return {
    async reply(replyToken, messages) {
      const res = await fetchImpl(REPLY_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ replyToken, messages }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`line reply http ${res.status}: ${await res.text()}`);
    },
  };
}

export interface CapturedLineReply {
  replyToken: string;
  messages: LineMessage[];
}

/** Stub reply API for synthetic webhook tests. Live delivery is unverified when this is in use. */
export function createStubLineClient(log: Logger): LineReplyClient & { captured: CapturedLineReply[] } {
  const captured: CapturedLineReply[] = [];
  return {
    captured,
    async reply(replyToken, messages) {
      captured.push({ replyToken, messages });
      log.info("line_reply_stubbed", { messages });
    },
  };
}
