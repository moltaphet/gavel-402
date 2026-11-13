import { chains, createAccount, createClient } from "genlayer-js";
import type { CourtConfig } from "./config.js";
import type { Verdict } from "./judge.js";

/** Limits enforced by the DeliveryJudge contract (contracts/delivery_judge.py). */
export const COURT_LIMITS = { spec: 4000, deliverable: 8000 } as const;

export interface CourtCase {
  caseId: string;
  spec: string;
  deliverable: string;
  paymentRef: string;
  firstVerdict: Verdict;
  firstReason: string;
}

export interface CourtResult {
  verdict: Verdict;
  reason: string;
  /** Transaction hashes of the court writes, for the public record / explorer. */
  txHashes: string[];
}

export interface Court {
  resolve(c: CourtCase): Promise<CourtResult>;
}

/** The court could not produce a final verdict. Callers must not settle. */
export class CourtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CourtError";
  }
}

/** The small slice of the genlayer-js client we use. Injectable for tests. */
export interface CourtClientLike {
  estimateTransactionFees(): Promise<{ distribution: unknown; feeValue: bigint }>;
  writeContract(args: {
    address: `0x${string}`;
    functionName: string;
    args: unknown[];
    fees: { distribution: unknown; feeValue: bigint };
  }): Promise<unknown>;
  waitForTransactionReceipt(args: {
    hash: unknown;
    waitUntil: "decided";
    interval: number;
    retries: number;
  }): Promise<unknown>;
  readContract(args: {
    address: `0x${string}`;
    functionName: string;
    args: unknown[];
    jsonSafeReturn: boolean;
  }): Promise<unknown>;
}

interface OnChainCase {
  status?: unknown;
  final_verdict?: unknown;
  final_reason?: unknown;
}

function chainFor(network: CourtConfig["network"]) {
  switch (network) {
    case "studio-dev":
      return chains.studioDevnet;
    case "studionet":
      return chains.studionet;
    case "bradbury":
      return chains.testnetBradbury;
    case "localnet":
      return chains.localnet;
  }
}

export interface GenLayerCourtOptions extends CourtConfig {
  client?: CourtClientLike;
  /** Poll interval/retries while waiting for validator consensus. */
  pollIntervalMs?: number;
  pollRetries?: number;
}

/**
 * Appeal court backed by the DeliveryJudge intelligent contract: validators reach a
 * final ACCEPT/REJECT by consensus. Success is decided from the contract's stored case
 * state, never from the transaction receipt (a transaction can be ACCEPTED while the
 * contract call itself errored).
 */
export class GenLayerCourt implements Court {
  private readonly client: CourtClientLike;
  private readonly address: `0x${string}`;
  private readonly interval: number;
  private readonly retries: number;

  constructor(opts: GenLayerCourtOptions) {
    this.address = opts.contract as `0x${string}`;
    this.interval = opts.pollIntervalMs ?? 3000;
    this.retries = opts.pollRetries ?? 120;
    this.client =
      opts.client ??
      (createClient({
        chain: chainFor(opts.network),
        endpoint: opts.rpcUrl,
        account: createAccount(opts.privateKey as `0x${string}`),
      }) as unknown as CourtClientLike);
  }

  async resolve(c: CourtCase): Promise<CourtResult> {
    if (c.spec.length > COURT_LIMITS.spec) throw new CourtError("spec too large for the court");
    if (c.deliverable.length > COURT_LIMITS.deliverable) throw new CourtError("deliverable too large for the court");

    const txHashes: string[] = [];
    try {
      const existing = await this.readCase(c.caseId);
      if (existing === null) {
        txHashes.push(
          await this.write("open_case", [
            c.caseId,
            c.spec,
            c.deliverable,
            c.paymentRef,
            c.firstVerdict,
            c.firstReason,
          ]),
        );
      }
      if (existing === null || existing.status !== "resolved") {
        txHashes.push(await this.write("resolve", [c.caseId]));
      }
      const final = await this.readCase(c.caseId);
      const verdict = final?.final_verdict;
      if (!final || final.status !== "resolved" || (verdict !== "ACCEPT" && verdict !== "REJECT")) {
        throw new CourtError("court did not produce a final verdict");
      }
      return { verdict, reason: String(final.final_reason ?? ""), txHashes };
    } catch (e) {
      if (e instanceof CourtError) throw e;
      throw new CourtError(`court call failed: ${e instanceof Error ? e.name : "error"}`);
    }
  }

  private async write(functionName: string, args: unknown[]): Promise<string> {
    const est = await this.client.estimateTransactionFees();
    const hash = await this.client.writeContract({
      address: this.address,
      functionName,
      args,
      fees: { distribution: est.distribution, feeValue: est.feeValue },
    });
    await this.client.waitForTransactionReceipt({
      hash,
      waitUntil: "decided",
      interval: this.interval,
      retries: this.retries,
    });
    return String(hash);
  }

  /** Returns null when the case does not exist on-chain yet. */
  private async readCase(caseId: string): Promise<OnChainCase | null> {
    let raw: unknown;
    try {
      raw = await this.client.readContract({
        address: this.address,
        functionName: "get_case",
        args: [caseId],
        jsonSafeReturn: true,
      });
    } catch (e) {
      // Reading a case that was never opened makes the contract raise; the live RPC reports that only as
      // "gen_call: execution failed" (InvalidInputRpcError), not with the contract's own message.
      // Treating it as "absent" is safe: open_case reverts on a duplicate and resolve re-checks state.
      if (e instanceof Error && /unknown case|execution failed/i.test(e.message)) return null;
      throw e;
    }
    const obj = raw instanceof Map ? Object.fromEntries(raw) : raw;
    if (typeof obj !== "object" || obj === null) throw new CourtError("court returned an unreadable case");
    return obj as OnChainCase;
  }
}
