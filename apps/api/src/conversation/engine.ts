import type { AssistantReply, HandoffPacket, HandoffReason, KnownContext, Turn } from "@homepro/shared";
import { findProduct } from "../domain/catalog.ts";
import { checkSku, isValidBudget, matchProducts } from "../domain/matching.ts";
import { bandForArea } from "../domain/roomSize.ts";
import { render, type Decision } from "./render.ts";
import type { Session } from "./session.ts";
import type { Awaiting, Intent, Understanding } from "./understanding.ts";

/** "llm" when the model read the message; "rules" when the keyword understander did (no LLM, or it failed). */
export type UnderstandingSource = "llm" | "rules";

export interface TurnRequest {
  session: Session;
  text: string;
  understanding: Understanding;
  source: UnderstandingSource;
  now: Date;
  newHandoffId: () => string;
  baseUrl: string;
}

export interface TurnResult {
  session: Session;
  decision: Decision;
  reply: AssistantReply;
}

const HANDOFF_REASONS: Partial<Record<Intent, HandoffReason>> = {
  order_status: "order_status",
  damaged_delivery: "damaged_delivery",
  warranty: "uncovered_warranty",
  staff_request: "shopper_request",
};

const HANDOFF_MESSAGES = 6;

function mergeSlots(known: KnownContext, u: Understanding): KnownContext {
  const band = u.roomSizeBand ?? (u.roomAreaSqm === null ? undefined : bandForArea(u.roomAreaSqm));
  const sku = u.sku === null ? undefined : findProduct(u.sku)?.sku;
  const next: KnownContext = { ...known, skusMentioned: sku && !known.skusMentioned.includes(sku) ? [...known.skusMentioned, sku] : known.skusMentioned };
  if (band) next.roomSizeBand = band;
  if (u.budgetThb !== null && isValidBudget(u.budgetThb)) next.budgetThb = u.budgetThb;
  return next;
}

interface Step {
  decision: Decision;
  known: KnownContext;
  awaiting: Awaiting;
}

function decideSales(known: KnownContext, u: Understanding): Step {
  if (u.sku !== null) {
    const outcome = checkSku(u.sku, known.budgetThb);
    // Asking about a SKU implies that product's room size when the shopper hasn't given one.
    const implied = outcome.kind === "unknown_sku" || known.roomSizeBand ? known : { ...known, roomSizeBand: outcome.product.band };
    const awaiting = outcome.kind === "out_of_stock" && outcome.followUp === null ? "budget" : null;
    return { decision: { kind: "sku", outcome }, known: implied, awaiting };
  }
  const { roomSizeBand: band, budgetThb: budget } = known;
  if (band === undefined && budget === undefined) return { decision: { kind: "ask", missing: "both", known }, known, awaiting: null };
  if (band === undefined) return { decision: { kind: "ask", missing: "room_size", known }, known, awaiting: "room_size" };
  if (budget === undefined) return { decision: { kind: "ask", missing: "budget", known }, known, awaiting: "budget" };
  return { decision: { kind: "match", outcome: matchProducts(band, budget) }, known, awaiting: null };
}

function decide(session: Session, u: Understanding, source: UnderstandingSource): Step {
  const known = mergeSlots(session.known, u);
  const keep = { known, awaiting: session.awaiting };
  const reason = HANDOFF_REASONS[u.intent];
  if (reason) return { decision: { kind: "handoff", reason }, known, awaiting: null };
  switch (u.intent) {
    case "sales":
      return decideSales(known, u);
    case "return_policy":
      return { decision: { kind: "policy", policyId: "SUP-01" }, ...keep };
    case "greeting":
      return { decision: { kind: "greet" }, ...keep };
    default:
      // The LLM judged it outside our data: hand off per spec §4.2.3. The keyword rules can't tell
      // "out of scope" from "not understood", so they fall back instead of escalating.
      return source === "llm"
        ? { decision: { kind: "handoff", reason: "out_of_scope" }, known, awaiting: null }
        : { decision: { kind: "fallback" }, ...keep };
  }
}

export function handleTurn(req: TurnRequest): TurnResult {
  const { session, understanding: u, now } = req;
  const at = now.toISOString();
  const shopperTurn: Turn = { role: "shopper", text: req.text, at };
  const { decision, known, awaiting } = decide(session, u, req.source);
  const language = u.language;
  const { text, actions } = render(decision, language, req.baseUrl);

  const historyWithShopper = [...session.history, shopperTurn];
  const handoff: HandoffPacket | null =
    decision.kind === "handoff"
      ? {
          handoffId: req.newHandoffId(),
          channel: session.channel,
          sessionKey: session.key,
          reason: decision.reason,
          policyRef: "SUP-02",
          shopperLanguage: language,
          knownContext: known,
          lastMessages: historyWithShopper.slice(-HANDOFF_MESSAGES),
          createdAt: at,
        }
      : null;

  const reply: AssistantReply = { language, text, actions, handoff };
  const next: Session = {
    ...session,
    language,
    known,
    awaiting,
    history: [...historyWithShopper, { role: "assistant", text, at }],
    updatedAt: at,
  };
  return { session: next, decision, reply };
}
