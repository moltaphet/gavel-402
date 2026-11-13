import { describe, expect, it, vi } from "vitest";
import { COURT_LIMITS, CourtError, GenLayerCourt, type CourtClientLike } from "../src/court.js";

const CONTRACT = "0x" + "ab".repeat(20);
const base = {
  network: "studio-dev" as const,
  contract: CONTRACT,
  privateKey: "0x" + "11".repeat(32),
  pollIntervalMs: 1,
  pollRetries: 1,
};
const input = {
  caseId: "case-1",
  spec: "Return 3 sources.",
  deliverable: "one source only",
  paymentRef: "case-1",
  firstVerdict: "ACCEPT" as const,
  firstReason: "looked fine",
};

/** Fake chain: tracks the on-chain case so reads reflect earlier writes. */
function fakeClient(opts: {
  existing?: Record<string, unknown> | null;
  verdictOnResolve?: "ACCEPT" | "REJECT" | null;
  asMap?: boolean;
  readError?: Error;
}) {
  let stored: Record<string, unknown> | null = opts.existing ?? null;
  const writes: { fn: string; args: unknown[]; fees: unknown }[] = [];
  const client: CourtClientLike = {
    estimateTransactionFees: vi.fn(async () => ({ distribution: { d: 1 }, feeValue: 123n })),
    writeContract: vi.fn(async (a) => {
      writes.push({ fn: a.functionName, args: a.args, fees: a.fees });
      if (a.functionName === "open_case") stored = { status: "open", final_verdict: "", final_reason: "" };
      if (a.functionName === "resolve" && opts.verdictOnResolve) {
        stored = { status: "resolved", final_verdict: opts.verdictOnResolve, final_reason: "because" };
      }
      return `0xhash-${writes.length}`;
    }),
    waitForTransactionReceipt: vi.fn(async () => ({})),
    readContract: vi.fn(async () => {
      if (opts.readError) throw opts.readError;
      if (stored === null) {
        // Shape observed from the live studio-next RPC for a case that does not exist.
        const err = new Error("GenLayer RPC error (gen_call): execution failed");
        err.name = "InvalidInputRpcError";
        throw err;
      }
      return opts.asMap ? new Map(Object.entries(stored)) : stored;
    }),
  };
  return { client, writes };
}

describe("GenLayerCourt", () => {
  it("opens the case, resolves it, and returns the on-chain verdict with tx hashes", async () => {
    const { client, writes } = fakeClient({ verdictOnResolve: "REJECT" });
    const out = await new GenLayerCourt({ ...base, client }).resolve(input);
    expect(out).toEqual({ verdict: "REJECT", reason: "because", txHashes: ["0xhash-1", "0xhash-2"] });
    expect(writes.map((w) => w.fn)).toEqual(["open_case", "resolve"]);
    expect(writes[0]!.args).toEqual(["case-1", input.spec, input.deliverable, "case-1", "ACCEPT", "looked fine"]);
  });

  it("sends the estimated fees with every write", async () => {
    const { client, writes } = fakeClient({ verdictOnResolve: "ACCEPT" });
    await new GenLayerCourt({ ...base, client }).resolve(input);
    for (const w of writes) expect(w.fees).toEqual({ distribution: { d: 1 }, feeValue: 123n });
  });

  it("skips open_case when the case already exists (retry after a failed resolve)", async () => {
    const { client, writes } = fakeClient({
      existing: { status: "open", final_verdict: "", final_reason: "" },
      verdictOnResolve: "ACCEPT",
    });
    const out = await new GenLayerCourt({ ...base, client }).resolve(input);
    expect(out.verdict).toBe("ACCEPT");
    expect(writes.map((w) => w.fn)).toEqual(["resolve"]);
  });

  it("does not write at all when the case is already resolved", async () => {
    const { client, writes } = fakeClient({
      existing: { status: "resolved", final_verdict: "REJECT", final_reason: "done" },
    });
    const out = await new GenLayerCourt({ ...base, client }).resolve(input);
    expect(out).toMatchObject({ verdict: "REJECT", reason: "done", txHashes: [] });
    expect(writes).toHaveLength(0);
  });

  it("fails when the transaction is decided but the contract call errored (case stays open)", async () => {
    const { client } = fakeClient({ verdictOnResolve: null });
    await expect(new GenLayerCourt({ ...base, client }).resolve(input)).rejects.toThrow(CourtError);
  });

  it("handles a Map return value from the client", async () => {
    const { client } = fakeClient({ verdictOnResolve: "ACCEPT", asMap: true });
    const out = await new GenLayerCourt({ ...base, client }).resolve(input);
    expect(out.verdict).toBe("ACCEPT");
  });

  it("refuses oversized input before touching the chain", async () => {
    const { client, writes } = fakeClient({ verdictOnResolve: "ACCEPT" });
    const court = new GenLayerCourt({ ...base, client });
    await expect(court.resolve({ ...input, spec: "s".repeat(COURT_LIMITS.spec + 1) })).rejects.toThrow(/spec too large/);
    await expect(court.resolve({ ...input, deliverable: "d".repeat(COURT_LIMITS.deliverable + 1) })).rejects.toThrow(
      /deliverable too large/,
    );
    expect(writes).toHaveLength(0);
    expect(client.readContract).not.toHaveBeenCalled();
  });

  it("also treats the contract's own 'unknown case' error as an absent case", async () => {
    const { client, writes } = fakeClient({ verdictOnResolve: "ACCEPT" });
    const original = client.readContract;
    let first = true;
    client.readContract = vi.fn(async (a) => {
      if (first) {
        first = false;
        throw new Error("UserError: [EXPECTED] unknown case");
      }
      return original(a);
    });
    const out = await new GenLayerCourt({ ...base, client }).resolve(input);
    expect(out.verdict).toBe("ACCEPT");
    expect(writes.map((w) => w.fn)).toEqual(["open_case", "resolve"]);
  });

  it("wraps unexpected client errors without leaking details", async () => {
    const { client } = fakeClient({ readError: new Error("rpc exploded with secret=abc") });
    const err = await new GenLayerCourt({ ...base, client }).resolve(input).catch((e: Error) => e);
    expect(err).toBeInstanceOf(CourtError);
    expect(String(err)).not.toContain("secret=abc");
  });
});
