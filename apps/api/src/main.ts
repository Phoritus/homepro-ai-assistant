import { createAssistant } from "./assistant.ts";
import { createLiveLineClient, createStubLineClient } from "./channels/line.ts";
import { loadConfig } from "./config.ts";
import { createMemorySessionStore } from "./conversation/session.ts";
import { createGroqUnderstander } from "./llm/groq.ts";
import { createJsonLogger } from "./log.ts";
import { createHttpServer } from "./server.ts";

const config = loadConfig();
const log = createJsonLogger();

const assistant = createAssistant({
  sessions: createMemorySessionStore(config.sessionTtlMs),
  llm: config.groq ? createGroqUnderstander(config.groq) : null,
  log,
  baseUrl: config.publicBaseUrl,
});

const line = config.line
  ? {
      channelSecret: config.line.channelSecret,
      client: config.line.accessToken ? createLiveLineClient(config.line.accessToken) : createStubLineClient(log),
    }
  : null;

createHttpServer({ assistant, log, line }).listen(config.port, () => {
  log.info("server_started", {
    port: config.port,
    baseUrl: config.publicBaseUrl,
    llm: config.groq ? `groq:${config.groq.model}` : "off (keyword rules only)",
    line: !config.line ? "off" : config.line.accessToken ? "live" : "stub (replies captured, not delivered)",
  });
});
