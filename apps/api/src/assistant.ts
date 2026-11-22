import { randomUUID } from "node:crypto";
import type { AssistantReply, Channel } from "@homepro/shared";
import { handleTurn, type UnderstandingSource } from "./conversation/engine.ts";
import { newSession, sessionKey, type SessionStore } from "./conversation/session.ts";
import { RateLimitedError, understandByKeywords, type UnderstandContext, type Understander, type Understanding } from "./conversation/understanding.ts";
import type { Logger } from "./log.ts";

export interface AssistantDeps {
  sessions: SessionStore;
  /** null runs keyword rules only. */
  llm: Understander | null;
  log: Logger;
  baseUrl: string;
  now?: () => Date;
  newId?: () => string;
}

export interface AssistantResponse {
  reply: AssistantReply;
  source: UnderstandingSource;
}

/** Longest shopper message either channel passes on; Web rejects longer input, LINE's is cut here. */
export const MAX_MESSAGE_CHARS = 1000;

/** The one shared backend both channels call. Channel adapters only translate formats. */
export interface Assistant {
  respond(channel: Channel, userId: string, text: string): Promise<AssistantResponse>;
}

export function createAssistant({ sessions, llm, log, baseUrl, now = () => new Date(), newId = randomUUID }: AssistantDeps): Assistant {
  async function understand(text: string, ctx: UnderstandContext): Promise<{ understanding: Understanding; source: UnderstandingSource }> {
    if (llm) {
      const started = Date.now();
      try {
        const understanding = await llm(text, ctx);
        log.info("llm_ok", { ms: Date.now() - started, intent: understanding.intent });
        return { understanding, source: "llm" };
      } catch (err) {
        if (err instanceof RateLimitedError) log.warn("llm_rate_limited", { ms: Date.now() - started, retryAfterMs: err.retryAfterMs });
        else log.warn("llm_failed", { ms: Date.now() - started, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
      }
    }
    return { understanding: understandByKeywords(text, ctx), source: "rules" };
  }

  return {
    async respond(channel, userId, rawText) {
      const text = rawText.slice(0, MAX_MESSAGE_CHARS);
      if (text.length < rawText.length) log.info("message_truncated", { channel, length: rawText.length });
      const at = now();
      const session = sessions.get(sessionKey(channel, userId), at) ?? newSession(channel, userId, at);
      const recentShopperMessages = session.history.filter((t) => t.role === "shopper").slice(-3).map((t) => t.text);
      const { understanding, source } = await understand(text, { awaiting: session.awaiting, recentShopperMessages });
      const result = handleTurn({ session, text, understanding, source, now: at, newHandoffId: newId, baseUrl });
      sessions.put(result.session);
      log.info("turn", {
        channel,
        session: session.key,
        source,
        intent: understanding.intent,
        decision: result.decision.kind,
        handoffId: result.reply.handoff?.handoffId,
      });
      if (result.reply.handoff) log.info("handoff_packet", { packet: result.reply.handoff });
      return { reply: result.reply, source };
    },
  };
}
