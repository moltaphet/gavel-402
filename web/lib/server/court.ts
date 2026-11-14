import { chains, createAccount, createClient } from "genlayer-js";
import type { Verdict } from "@/lib/scenarios";

// Same flow as gateway/src/court.ts: open the case if absent, resolve it, read the stored verdict.
// Success is judged from the contract's stored state, never from the receipt alone.
export interface CourtResult {
  verdict: Verdict;
  reason: string;
  txHashes: string[];
}

const LIMITS = { spec: 4000, deliverable: 8000 } as const;

export async function courtRule(caseId: string, spec: string, deliverable: string, firstVerdict: Verdict, firstReason: string): Promise<CourtResult> {
  const key = process.env.GENLAYER_PRIVATE_KEY;
  const contract = process.env.GENLAYER_CONTRACT;
  if (!key || !contract) throw new Error("GENLAYER_PRIVATE_KEY / GENLAYER_CONTRACT not set");
  if (spec.length > LIMITS.spec || deliverable.length > LIMITS.deliverable) throw new Error("input too large for the court");

  const client = createClient({
    chain: chains.studioDevnet,
    endpoint: process.env.GENLAYER_RPC_URL || "https://studio-dev.genlayer.com/api",
    account: createAccount(key as `0x${string}`),
  });
  const address = contract as `0x${string}`;
  const fee = await client.estimateTransactionFees();
  const fees = { distribution: fee.distribution, feeValue: fee.feeValue };
  const txHashes: string[] = [];

  const read = async () => {
    try {
      const raw = await client.readContract({ address, functionName: "get_case", args: [caseId], jsonSafeReturn: true });
      return raw instanceof Map ? Object.fromEntries(raw) : (raw as Record<string, unknown>);
    } catch (e) {
      // The live RPC reports a missing case as "execution failed" (see gateway court.ts).
      if (e instanceof Error && /unknown case|execution failed/i.test(e.message)) return null;
      throw e;
    }
  };
  const write = async (functionName: string, args: string[]) => {
    const hash = await client.writeContract({ address, functionName, args, fees });
    await client.waitForTransactionReceipt({ hash, waitUntil: "decided", interval: 3000, retries: 120 });
    txHashes.push(String(hash));
  };

  const existing = await read();
  if (existing === null) await write("open_case", [caseId, spec, deliverable, caseId, firstVerdict, firstReason]);
  if (existing?.status !== "resolved") await write("resolve", [caseId]);
  const final = await read();
  const v = final?.final_verdict;
  if (!final || final.status !== "resolved" || (v !== "ACCEPT" && v !== "REJECT")) throw new Error("court did not produce a final verdict");
  return { verdict: v, reason: String(final.final_reason ?? ""), txHashes };
}
