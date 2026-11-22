import type { Channel, KnownContext, Language, Turn } from "@homepro/shared";
import type { Awaiting } from "./understanding.ts";

/** One shopper's conversation on one channel. Web and LINE sessions never share a key. */
export interface Session {
  key: string;
  channel: Channel;
  userId: string;
  language: Language;
  known: KnownContext;
  awaiting: Awaiting;
  history: Turn[];
  updatedAt: string;
}

export const sessionKey = (channel: Channel, userId: string) => `${channel}:${userId}`;

export const newSession = (channel: Channel, userId: string, now: Date): Session => ({
  key: sessionKey(channel, userId),
  channel,
  userId,
  language: "en",
  known: { skusMentioned: [] },
  awaiting: null,
  history: [],
  updatedAt: now.toISOString(),
});

export interface SessionStore {
  get(key: string, now: Date): Session | undefined;
  put(session: Session): void;
}

const MAX_HISTORY = 20;

/** Demo store: one process, lost on restart. Idle sessions expire after `ttlMs`. */
export function createMemorySessionStore(ttlMs: number): SessionStore {
  const sessions = new Map<string, Session>();
  return {
    get(key, now) {
      const s = sessions.get(key);
      if (!s) return undefined;
      if (now.getTime() - Date.parse(s.updatedAt) > ttlMs) {
        sessions.delete(key);
        return undefined;
      }
      return s;
    },
    put(session) {
      sessions.set(session.key, { ...session, history: session.history.slice(-MAX_HISTORY) });
    },
  };
}
