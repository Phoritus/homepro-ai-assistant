import type { AssistantReply, HandoffPacket, HandoffReason, KnownContext, Turn } from "@homepro/shared";
import { findProduct } from "../domain/catalog.ts";
import { checkSku, isValidBudget, matchProducts } from "../domain/matching.ts";
import { bandForArea } from "../domain/roomSize.ts";
import { render, type Decision } from "./render.ts";
import type { Session } from "./session.ts";
import type { Awaiting, Intent, Understanding } from "./understanding.ts";

export interface TurnRequest {
  session: Session;
  text: string;
  understanding: Understanding;
  now: Date;
  newHandoffId: () => string;
  baseUrl: string;
}

export interface TurnResult {
  session: Session;
  decisions: Decision[];
  reply: AssistantReply;
}

const HANDOFF_MESSAGES = 6;

function mergeSlots(known: KnownContext, u: Understanding): KnownContext {
  const band = u.roomSizeBand ?? (u.roomAreaSqm === null ? undefined : bandForArea(u.roomAreaSqm));
  const skus = u.skus.flatMap((s) => findProduct(s)?.sku ?? []);
  const next: KnownContext = { ...known, skusMentioned: [...new Set([...known.skusMentioned, ...skus])] };
  if (band) next.roomSizeBand = band;
  if (u.budgetThb !== null && isValidBudget(u.budgetThb)) next.budgetThb = u.budgetThb;
  return next;
}

interface Step {
  decision: Decision;
  known: KnownContext;
  /** Undefined leaves the session's pending question as it was. */
  awaiting?: Awaiting;
}

type Route = (known: KnownContext, u: Understanding) => Step;

const recommend: Route = (known) => {
  const { roomSizeBand: band, budgetThb: budget } = known;
  if (band === undefined && budget === undefined) return { decision: { kind: "ask", missing: "both", known }, known, awaiting: null };
  if (band === undefined) return { decision: { kind: "ask", missing: "room_size", known }, known, awaiting: "room_size" };
  if (budget === undefined) return { decision: { kind: "ask", missing: "budget", known }, known, awaiting: "budget" };
  return { decision: { kind: "match", outcome: matchProducts(band, budget) }, known, awaiting: null };
};

const handoff =
  (reason: HandoffReason): Route =>
  (known) => ({ decision: { kind: "handoff", reason }, known, awaiting: null });

const productInfo: Route = (known, u) => {
  if (u.asks === "unheld") return handoff("out_of_scope")(known, u);
  const [sku] = u.skus;
  if (sku === undefined) return recommend(known, u);
  const outcome = checkSku(sku, known.budgetThb, known.roomSizeBand);
  const awaitingBudget = (outcome.kind === "out_of_stock" || outcome.kind === "wrong_size") && outcome.followUp === null;
  // The follow-up question needs a band, and asking about a SKU implies its band when the shopper gave none.
  const next = outcome.kind === "out_of_stock" && awaitingBudget ? { ...known, roomSizeBand: outcome.product.band } : known;
  return { decision: { kind: "sku", outcome }, known: next, awaiting: awaitingBudget ? "budget" : null };
};

const ROUTES: Record<Intent, Route> = {
  recommend,
  product_info: productInfo,
  return_policy: (known) => ({ decision: { kind: "policy", policyId: "SUP-01" }, known }),
  order_status: handoff("order_status"),
  damaged_delivery: handoff("damaged_delivery"),
  warranty: handoff("uncovered_warranty"),
  staff_request: handoff("shopper_request"),
  greeting: (known) => ({ decision: { kind: "greet" }, known }),
  closing: (known) => ({ decision: { kind: "close" }, known }),
  out_of_scope: handoff("out_of_scope"),
  unclear: (known) => ({ decision: { kind: "fallback" }, known }),
};

const isSmallTalk = (d: Decision) => d.kind === "greet" || d.kind === "close";

/** One handoff at most; no questions while handing off; small talk only when nothing else was said. */
function keep(steps: Step[]): Step[] {
  const firstHandoff = steps.findIndex((s) => s.decision.kind === "handoff");
  const kept = steps.filter((s, i) => {
    if (s.decision.kind === "handoff") return i === firstHandoff;
    return !(firstHandoff >= 0 && s.decision.kind === "ask");
  });
  return kept.some((s) => !isSmallTalk(s.decision)) ? kept.filter((s) => !isSmallTalk(s.decision)) : kept;
}

function decide(session: Session, u: Understanding): { steps: Step[]; known: KnownContext; awaiting: Awaiting } {
  let known = mergeSlots(session.known, u);
  const all: Step[] = [];
  for (const intent of u.intents) {
    const step = ROUTES[intent](known, u);
    known = step.known;
    all.push(step);
  }
  const steps = keep(all);
  const awaiting = [...steps].reverse().find((s) => s.awaiting !== undefined)?.awaiting ?? session.awaiting;
  return { steps, known, awaiting };
}

export function handleTurn(req: TurnRequest): TurnResult {
  const { session, understanding: u, now } = req;
  const at = now.toISOString();
  const shopperTurn: Turn = { role: "shopper", text: req.text, at };
  const { steps, known, awaiting } = decide(session, u);
  const decisions = steps.map((s) => s.decision);
  const language = u.language;
  const { text, actions } = render(decisions, language, req.baseUrl);

  const historyWithShopper = [...session.history, shopperTurn];
  const handoffDecision = decisions.find((d) => d.kind === "handoff");
  const handoffPacket: HandoffPacket | null =
    handoffDecision
      ? {
          handoffId: req.newHandoffId(),
          channel: session.channel,
          sessionKey: session.key,
          reason: handoffDecision.reason,
          policyRef: "SUP-02",
          shopperLanguage: language,
          knownContext: known,
          lastMessages: historyWithShopper.slice(-HANDOFF_MESSAGES),
          createdAt: at,
        }
      : null;

  const reply: AssistantReply = { language, text, actions, handoff: handoffPacket };
  const next: Session = {
    ...session,
    language,
    known,
    awaiting,
    history: [...historyWithShopper, { role: "assistant", text, at }],
    updatedAt: at,
  };
  return { session: next, decisions, reply };
}
