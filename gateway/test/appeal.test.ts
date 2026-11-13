import { describe, expect, it, vi } from "vitest";
import type { FacilitatorClient } from "@x402/core/server";
import { decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { createApp } from "../src/app.js";
import { CaseStore } from "../src/cases.js";
import { loadConfig } from "../src/config.js";
import { CourtError, type Court, type CourtResult } from "../src/court.js";
import type { Judge } from "../src/judge.js";
import { buildRequirements } from "../src/networks.js";

const PAYEE = "0x" + "11".repeat(20);
const PAYER = "0x" + "22".repeat(20);
const ADMIN = "admin-token-0123456789";

const baseEnv = {
  PAY_TO: PAYEE,
  UPSTREAM_URL: "https://seller.example",
  SERV_API_KEY: "test-key",
  DELIVERY_SPEC: "Return JSON with a numeric temperature.",
  ADMIN_TOKEN: ADMIN,
  GENLAYER_CONTRACT: "0x" + "ab".repeat(20),
  GENLAYER_PRIVATE_KEY: "0x" + "11".repeat(32),
};

function payment(env: Record<string, string>, nonce: string): string {
  const config = loadConfig(env);
  const accepted = buildRequirements({
    chain: config.network,
    payTo: config.payTo,
    priceUsd: config.priceUsd,
    maxTimeoutSeconds: config.maxTimeoutSeconds,
  });
  return encodePaymentSignatureHeader({
    x402Version: 2,
    accepted,
    payload: { signature: "0xsig", authorization: { from: PAYER, to: PAYEE, value: accepted.amount, nonce } },
  });
}

const courtResult = (verdict: "ACCEPT" | "REJECT"): CourtResult => ({
  verdict,
  reason: `court says ${verdict}`,
  txHashes: ["0xopen", "0xresolve"],
});

function setup(opts: { window?: number; first?: "ACCEPT" | "REJECT"; court?: Court | null } = {}) {
  const env: Record<string, string> = { ...baseEnv };
  if (opts.window) {
    env.APPEAL_WINDOW_SECONDS = String(opts.window);
    env.MAX_TIMEOUT_SECONDS = String(opts.window + 300);
  }
  const clock = { t: 1_000_000 };
  const facilitator = {
    verify: vi.fn(async () => ({ isValid: true, payer: PAYER })),
    settle: vi.fn(async () => ({
      success: true,
      transaction: "0xtx",
      network: "eip155:2368" as const,
      payer: PAYER,
    })),
    getSupported: vi.fn(),
  };
  const judge: Judge = {
    judge: vi.fn(async () => ({ verdict: opts.first ?? ("ACCEPT" as const), reason: "first pass" })),
  };
  const court: Court | undefined =
    opts.court === null ? undefined : (opts.court ?? { resolve: vi.fn(async () => courtResult("ACCEPT")) });
  const fetchImpl = vi.fn(
    async () => new Response('{"temperature":21}', { status: 200, headers: { "content-type": "application/json" } }),
  );
  const store = new CaseStore();
  const app = createApp({
    config: loadConfig(env),
    facilitator: facilitator as unknown as FacilitatorClient,
    judge,
    court,
    store,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now: () => clock.t,
  });
  let n = 0;
  const pay = async () => {
    const res = await app.request("/v1/forecast", { headers: { "payment-signature": payment(env, `0x${++n}`) } });
    return { res, body: (await res.json()) as Record<string, any> };
  };
  const post = (path: string, token?: string) =>
    app.request(path, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });
  const get = (path: string, token?: string) =>
    app.request(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const caseOf = async (id: string) => (await (await app.request(`/gavel/cases/${id}`)).json()) as Record<string, any>;
  return { app, facilitator, judge, court: court as Court, fetchImpl, store, clock, pay, post, get, caseOf };
}

describe("seller appeals a rejection", () => {
  it("court ACCEPT overturns it: settles once, buyer collects with their token", async () => {
    const s = setup({ first: "REJECT" });
    const { res, body } = await s.pay();
    expect(res.status).toBe(422);
    expect(body.case_token).toBeTruthy();
    expect(body.appeal).toBe(`/gavel/cases/${body.case_id}/appeal`);
    expect(JSON.stringify(body)).not.toContain("temperature\":21");

    const appeal = await s.post(`/gavel/cases/${body.case_id}/appeal`, ADMIN);
    expect(appeal.status).toBe(200);
    expect(await appeal.json()).toMatchObject({ verdict: "ACCEPT", settled: true, appeal_by: "seller" });
    expect(s.court.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: body.case_id,
        spec: "Return JSON with a numeric temperature.",
        deliverable: '{"temperature":21}',
        firstVerdict: "REJECT",
        firstReason: "first pass",
      }),
    );
    expect(s.facilitator.settle).toHaveBeenCalledTimes(1);

    expect((await s.get(`/gavel/cases/${body.case_id}/delivery`)).status).toBe(403);
    const delivered = await s.get(`/gavel/cases/${body.case_id}/delivery`, body.case_token);
    expect(delivered.status).toBe(200);
    expect(await delivered.json()).toEqual({ temperature: 21 });
    expect(decodePaymentResponseHeader(delivered.headers.get("payment-response")!).transaction).toBe("0xtx");

    expect(await s.caseOf(body.case_id)).toMatchObject({
      status: "settled",
      appealBy: "seller",
      appealVerdict: "ACCEPT",
      appealTxs: ["0xopen", "0xresolve"],
    });
  });

  it("court REJECT is final: nothing settles and a second appeal is refused", async () => {
    const s = setup({ first: "REJECT", court: { resolve: vi.fn(async () => courtResult("REJECT")) } });
    const { body } = await s.pay();
    const appeal = await s.post(`/gavel/cases/${body.case_id}/appeal`, ADMIN);
    expect(await appeal.json()).toMatchObject({ verdict: "REJECT", settled: false });
    expect(s.facilitator.settle).not.toHaveBeenCalled();
    expect((await s.caseOf(body.case_id)).status).toBe("appeal_rejected");
    expect((await s.post(`/gavel/cases/${body.case_id}/appeal`, ADMIN)).status).toBe(409);
    expect((await s.get(`/gavel/cases/${body.case_id}/delivery`, body.case_token)).status).toBe(409);
  });

  it("requires the right credentials and standing", async () => {
    const s = setup({ first: "REJECT" });
    const { body } = await s.pay();
    const path = `/gavel/cases/${body.case_id}/appeal`;
    expect((await s.post(path)).status).toBe(403);
    expect((await s.post(path, "wrong-token-wrong-token")).status).toBe(403);
    // A buyer has no standing to appeal a rejection.
    expect((await s.post(path, body.case_token)).status).toBe(409);
    expect(s.court.resolve).not.toHaveBeenCalled();
    expect((await s.post("/gavel/cases/nope/appeal", ADMIN)).status).toBe(404);
  });

  it("returns 501 when no court is configured", async () => {
    const s = setup({ first: "REJECT", court: null });
    const { body } = await s.pay();
    expect(body.appeal).toBeUndefined();
    expect((await s.post(`/gavel/cases/${body.case_id}/appeal`, ADMIN)).status).toBe(501);
  });

  it("restores the case and allows a retry when the court is unavailable", async () => {
    const resolve = vi
      .fn()
      .mockRejectedValueOnce(new CourtError("court call failed: Error"))
      .mockResolvedValueOnce(courtResult("ACCEPT"));
    const s = setup({ first: "REJECT", court: { resolve } });
    const { body } = await s.pay();
    const path = `/gavel/cases/${body.case_id}/appeal`;
    const failed = await s.post(path, ADMIN);
    expect(failed.status).toBe(502);
    expect((await s.caseOf(body.case_id)).status).toBe("rejected");
    expect(s.facilitator.settle).not.toHaveBeenCalled();
    expect((await s.post(path, ADMIN)).status).toBe(200);
    expect(s.facilitator.settle).toHaveBeenCalledTimes(1);
  });

  it("does not run two appeals on one case at once", async () => {
    let release!: (r: CourtResult) => void;
    const resolve = vi.fn(() => new Promise<CourtResult>((r) => (release = r)));
    const s = setup({ first: "REJECT", court: { resolve } });
    const { body } = await s.pay();
    const path = `/gavel/cases/${body.case_id}/appeal`;
    const first = s.post(path, ADMIN);
    await vi.waitFor(() => expect(resolve).toHaveBeenCalled());
    expect((await s.post(path, ADMIN)).status).toBe(409);
    release(courtResult("REJECT"));
    expect((await first).status).toBe(200);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("does not deliver when the court ACCEPTs but settlement then fails", async () => {
    const s = setup({ first: "REJECT" });
    s.facilitator.settle.mockResolvedValueOnce({
      success: false,
      errorReason: "authorization_expired",
      transaction: "",
      network: "eip155:2368",
    } as never);
    const { body } = await s.pay();
    const appeal = await s.post(`/gavel/cases/${body.case_id}/appeal`, ADMIN);
    expect(appeal.status).toBe(502);
    expect((await s.caseOf(body.case_id)).status).toBe("settle_failed");
    expect((await s.get(`/gavel/cases/${body.case_id}/delivery`, body.case_token)).status).toBe(409);
  });
});

describe("buyer appeals an acceptance (appeal window)", () => {
  it("holds an ACCEPTed payment and withholds the body during the window", async () => {
    const s = setup({ window: 60 });
    const { res, body } = await s.pay();
    expect(res.status).toBe(202);
    expect(body).toMatchObject({ verdict: "ACCEPT", settled: false });
    expect(body.case_token).toBeTruthy();
    expect(body.release_at).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain("temperature\":21");
    expect(s.facilitator.settle).not.toHaveBeenCalled();
    expect((await s.caseOf(body.case_id)).status).toBe("accepted_pending");
  });

  it("court REJECT protects the buyer: nothing settles, nothing is delivered", async () => {
    const s = setup({ window: 60, court: { resolve: vi.fn(async () => courtResult("REJECT")) } });
    const { body } = await s.pay();
    const appeal = await s.post(`/gavel/cases/${body.case_id}/appeal`, body.case_token);
    expect(await appeal.json()).toMatchObject({ verdict: "REJECT", settled: false, appeal_by: "buyer" });
    expect(s.facilitator.settle).not.toHaveBeenCalled();
    expect((await s.get(`/gavel/cases/${body.case_id}/delivery`, body.case_token)).status).toBe(409);
  });

  it("court ACCEPT confirms the delivery: settles and releases it", async () => {
    const s = setup({ window: 60 });
    const { body } = await s.pay();
    const appeal = await s.post(`/gavel/cases/${body.case_id}/appeal`, body.case_token);
    expect(await appeal.json()).toMatchObject({ verdict: "ACCEPT", settled: true });
    const delivered = await s.get(`/gavel/cases/${body.case_id}/delivery`, body.case_token);
    expect(await delivered.json()).toEqual({ temperature: 21 });
    expect(s.facilitator.settle).toHaveBeenCalledTimes(1);
  });

  it("refuses an appeal after the window closed", async () => {
    const s = setup({ window: 60 });
    const { body } = await s.pay();
    s.clock.t += 61_000;
    const appeal = await s.post(`/gavel/cases/${body.case_id}/appeal`, body.case_token);
    expect(appeal.status).toBe(409);
    expect(await appeal.json()).toMatchObject({ error: "appeal_window_closed" });
    expect(s.court.resolve).not.toHaveBeenCalled();
  });

  it("seller has no standing to appeal an acceptance", async () => {
    const s = setup({ window: 60 });
    const { body } = await s.pay();
    expect((await s.post(`/gavel/cases/${body.case_id}/appeal`, ADMIN)).status).toBe(409);
  });

  it("releases after the window if nobody appeals, and settles only once", async () => {
    const s = setup({ window: 60 });
    const { body } = await s.pay();
    const path = `/gavel/cases/${body.case_id}/delivery`;

    const early = await s.get(path, body.case_token);
    expect(early.status).toBe(425);
    expect(s.facilitator.settle).not.toHaveBeenCalled();

    s.clock.t += 60_000;
    const late = await s.get(path, body.case_token);
    expect(late.status).toBe(200);
    expect(await late.json()).toEqual({ temperature: 21 });
    expect((await s.get(path, body.case_token)).status).toBe(200);
    expect(s.facilitator.settle).toHaveBeenCalledTimes(1);
  });

  it("settles once even when two requests collect at the same moment", async () => {
    const s = setup({ window: 60 });
    const { body } = await s.pay();
    s.clock.t += 60_000;
    let finish!: () => void;
    s.facilitator.settle.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ success: true, transaction: "0xtx", network: "eip155:2368" } as never);
        }) as never,
    );
    const path = `/gavel/cases/${body.case_id}/delivery`;
    const first = s.get(path, body.case_token);
    await vi.waitFor(() => expect(s.facilitator.settle).toHaveBeenCalled());
    const second = await s.get(path, body.case_token);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "case_busy" });
    finish();
    expect((await first).status).toBe(200);
    expect(s.facilitator.settle).toHaveBeenCalledTimes(1);
  });

  it("lets a satisfied buyer release the payment early", async () => {
    const s = setup({ window: 60 });
    const { body } = await s.pay();
    expect((await s.post(`/gavel/cases/${body.case_id}/accept`)).status).toBe(403);
    const accepted = await s.post(`/gavel/cases/${body.case_id}/accept`, body.case_token);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ temperature: 21 });
    expect(s.facilitator.settle).toHaveBeenCalledTimes(1);
    expect((await s.post(`/gavel/cases/${body.case_id}/accept`, body.case_token)).status).toBe(409);
  });
});

describe("no appeal window (default)", () => {
  it("delivers immediately and keeps nothing to collect afterwards", async () => {
    const s = setup();
    const res = await s.app.request("/v1/forecast", { headers: { "payment-signature": payment(baseEnv, "0x9") } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ temperature: 21 });
    const id = res.headers.get("x-gavel-case")!;
    expect((await s.get(`/gavel/cases/${id}/delivery`, "anything-anything-any")).status).toBe(404);
  });
});

describe("appeal configuration", () => {
  it("rejects an appeal window without a court", () => {
    const { GENLAYER_CONTRACT, GENLAYER_PRIVATE_KEY, ...noCourt } = baseEnv;
    void GENLAYER_CONTRACT;
    void GENLAYER_PRIVATE_KEY;
    expect(() => loadConfig({ ...noCourt, APPEAL_WINDOW_SECONDS: "60", MAX_TIMEOUT_SECONDS: "600" })).toThrow(/court/);
  });
  it("requires the payment to outlive the window plus deliberation", () => {
    expect(() => loadConfig({ ...baseEnv, APPEAL_WINDOW_SECONDS: "300", MAX_TIMEOUT_SECONDS: "400" })).toThrow(
      /MAX_TIMEOUT_SECONDS/,
    );
    expect(loadConfig({ ...baseEnv, APPEAL_WINDOW_SECONDS: "300", MAX_TIMEOUT_SECONDS: "480" }).appealWindowSeconds).toBe(300);
  });
  it("validates the admin token and the court settings", () => {
    expect(() => loadConfig({ ...baseEnv, ADMIN_TOKEN: "short" })).toThrow(/ADMIN_TOKEN/);
    expect(() => loadConfig({ ...baseEnv, GENLAYER_PRIVATE_KEY: undefined as unknown as string })).toThrow(/together/);
    expect(() => loadConfig({ ...baseEnv, GENLAYER_PRIVATE_KEY: "0x1234" })).toThrow(/GENLAYER_PRIVATE_KEY/);
    expect(() => loadConfig({ ...baseEnv, GENLAYER_CONTRACT: "0x12" })).toThrow(/GENLAYER_CONTRACT/);
    expect(() => loadConfig({ ...baseEnv, GENLAYER_NETWORK: "mainnet" })).toThrow(/GENLAYER_NETWORK/);
    expect(() => loadConfig({ ...baseEnv, DELIVERY_SPEC: "x".repeat(4001) })).toThrow(/DELIVERY_SPEC/);
  });
  it("leaves appeals off when no court is configured", () => {
    const { GENLAYER_CONTRACT, GENLAYER_PRIVATE_KEY, ...noCourt } = baseEnv;
    void GENLAYER_CONTRACT;
    void GENLAYER_PRIVATE_KEY;
    expect(loadConfig(noCourt).court).toBeUndefined();
  });
});
