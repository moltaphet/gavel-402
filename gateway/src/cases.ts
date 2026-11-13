import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { Verdict } from "./judge.js";

export type CaseStatus =
  | "settled" // paid and deliverable released
  | "rejected" // judged REJECT: payment held, nothing delivered (seller may appeal)
  | "accepted_pending" // judged ACCEPT inside an appeal window: payment held (buyer may appeal)
  | "appeal_pending" // sent to the court, awaiting consensus
  | "appeal_rejected" // court said REJECT: final, nothing settles
  | "upstream_failed" // seller errored or timed out: payment never settled
  | "unjudged" // judge unavailable: fail closed, payment never settled
  | "settle_failed"; // judged ACCEPT but settlement failed: nothing delivered

export interface Case {
  id: string;
  createdAt: string;
  status: CaseStatus;
  request: string;
  amount: string;
  network: string;
  payer?: string;
  /** First-pass (SERV) verdict. */
  verdict?: Verdict;
  reason?: string;
  upstreamStatus?: number;
  transaction?: string;
  /** When an accepted_pending payment is released if nobody appeals. */
  releaseAt?: string;
  /** Appeal outcome from the GenLayer court. */
  appealBy?: "buyer" | "seller";
  appealVerdict?: Verdict;
  appealReason?: string;
  appealTxs?: string[];
}

/** Internal: the signed authorization we keep so a later release or appeal can still settle it. Never exposed. */
export interface HeldPayment {
  payload: PaymentPayload;
  requirements: PaymentRequirements;
}

/** Internal: the withheld response and the buyer's secret. Never exposed through the public case record. */
export interface HeldDelivery {
  bytes: Uint8Array;
  contentType: string;
  upstreamStatus: number;
  /** Text shown to the judge/court. */
  text: string;
  /** Buyer's secret for this case: proves they are the payer when appealing or collecting. */
  token: string;
  /** Epoch ms when an accepted_pending payment is released. */
  releaseAtMs?: number;
  /** Encoded PAYMENT-RESPONSE header, set once settled. */
  paymentResponse?: string;
}

export class CaseStore {
  private readonly cases = new Map<string, Case>();
  private readonly held = new Map<string, HeldPayment>();
  private readonly deliveries = new Map<string, HeldDelivery>();
  private readonly claimed = new Set<string>();

  add(c: Case, held?: HeldPayment): void {
    this.cases.set(c.id, c);
    if (held) this.held.set(c.id, held);
  }

  update(id: string, patch: Partial<Case>): void {
    const c = this.cases.get(id);
    if (c) Object.assign(c, patch);
  }

  get(id: string): Case | undefined {
    return this.cases.get(id);
  }

  getHeld(id: string): HeldPayment | undefined {
    return this.held.get(id);
  }

  setDelivery(id: string, d: HeldDelivery): void {
    this.deliveries.set(id, d);
  }

  getDelivery(id: string): HeldDelivery | undefined {
    return this.deliveries.get(id);
  }

  deleteDelivery(id: string): void {
    this.deliveries.delete(id);
  }

  /** Reserve a payment nonce so the same signed authorization cannot be used twice at once. */
  claim(key: string): boolean {
    if (this.claimed.has(key)) return false;
    this.claimed.add(key);
    return true;
  }

  release(key: string): void {
    this.claimed.delete(key);
  }
}
