export type LogFields = Record<string, unknown>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

const SECRET_KEY = /(token|secret|apikey|api_key|authorization|password|signature)$/i;

/** Drops any field whose name looks like a credential, at any depth. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : redact(v)]),
    );
  }
  return value;
}

/** One JSON object per line on stdout, so logs can be grepped or shipped as-is. */
export function createJsonLogger(write: (line: string) => void = (l) => process.stdout.write(l + "\n")): Logger {
  const emit = (level: string) => (event: string, fields: LogFields = {}) =>
    write(JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(fields) as LogFields) }));
  return { info: emit("info"), warn: emit("warn"), error: emit("error") };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
