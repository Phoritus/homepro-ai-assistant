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

/** One line of conversation as staff see it in a Handoff Packet. */
export interface Message {
  role: "shopper" | "assistant";
  text: string;
  at: string;
}

/** A session history entry. Assistant turns keep what they offered so a reloaded Web Chat can redraw it. */
export type Turn =
  | (Message & { role: "shopper" })
  | (Message & { role: "assistant"; language: Language; actions: ReplyAction[]; handedOff: boolean });

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
  lastMessages: Message[];
  createdAt: string;
}

/** Channel-neutral reply. Web and LINE adapters format this; parity is checked here. */
export interface AssistantReply {
  language: Language;
  text: string;
  actions: ReplyAction[];
  handoff: HandoffPacket | null;
}
