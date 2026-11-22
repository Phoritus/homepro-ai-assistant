export type Language = "th" | "en";

export type Channel = "web" | "line";

export type RoomSizeBand = "small" | "medium" | "large";

export type PolicyId = "SUP-01" | "SUP-02";

export type ReplyAction =
  | { kind: "view_product"; sku: string; url: string }
  | { kind: "demo_checkout"; sku: string; url: string };

export type HandoffReason =
  | "order_status"
  | "damaged_delivery"
  | "uncovered_warranty"
  | "shopper_request"
  | "out_of_scope";

export interface Turn {
  role: "shopper" | "assistant";
  text: string;
  at: string;
}

export interface KnownContext {
  roomSizeBand?: RoomSizeBand;
  budgetThb?: number;
  skusMentioned: string[];
}

/** Sent to staff only. `handoffId` is never shown to the shopper. */
export interface HandoffPacket {
  handoffId: string;
  channel: Channel;
  sessionKey: string;
  reason: HandoffReason;
  policyRef: PolicyId | null;
  shopperLanguage: Language;
  knownContext: KnownContext;
  lastMessages: Turn[];
  createdAt: string;
}

/** Channel-neutral reply. Web and LINE adapters format this; parity is checked here. */
export interface AssistantReply {
  language: Language;
  text: string;
  actions: ReplyAction[];
  handoff: HandoffPacket | null;
}
