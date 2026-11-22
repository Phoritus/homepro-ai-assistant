/** Every setting the server reads, parsed once at startup. Secrets come only from the environment. */
export interface Config {
  port: number;
  publicBaseUrl: string;
  sessionTtlMs: number;
  groq: { apiKey: string; model: string; timeoutMs: number } | null;
  line: { channelSecret: string; accessToken: string | null } | null;
}

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v === undefined || v === "" || !Number.isFinite(n) ? fallback : n;
};

const nonEmpty = (v: string | undefined) => (v && v.trim() !== "" ? v.trim() : null);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = num(env.PORT, 3000);
  const groqKey = nonEmpty(env.GROQ_API_KEY);
  const lineSecret = nonEmpty(env.LINE_CHANNEL_SECRET);
  return {
    port,
    publicBaseUrl: (nonEmpty(env.PUBLIC_BASE_URL) ?? `http://localhost:${port}`).replace(/\/+$/, ""),
    sessionTtlMs: num(env.SESSION_TTL_MINUTES, 30) * 60_000,
    groq: groqKey
      ? { apiKey: groqKey, model: nonEmpty(env.GROQ_MODEL) ?? "openai/gpt-oss-20b", timeoutMs: num(env.LLM_TIMEOUT_MS, 8000) }
      : null,
    line: lineSecret
      ? { channelSecret: lineSecret, accessToken: env.LINE_MODE === "stub" ? null : nonEmpty(env.LINE_CHANNEL_ACCESS_TOKEN) }
      : null,
  };
}
