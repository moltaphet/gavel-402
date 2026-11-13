import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { Verdict } from "./judge.js";

export type CaseStatus =
  | "settled" // judged ACCEPT and paid
  | "rejected" // judged REJECT: payment held, nothing delivered
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
  verdict?: Verdict;
  reason?: string;
  upstreamStatus?: number;
  transaction?: string;
}

/** Internal: the signed authorization we keep so a later appeal can still settle it. Never exposed. */
export interface HeldPayment {
  payload: PaymentPayload;
  requirements: PaymentRequirements;
}

export class CaseStore {
  private readonly cases = new Map<string, Case>();
  private readonly held = new Map<string, HeldPayment>();
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
