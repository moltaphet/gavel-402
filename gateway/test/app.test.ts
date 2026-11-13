import { describe, expect, it, vi } from "vitest";
import type { FacilitatorClient } from "@x402/core/server";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import { createApp } from "../src/app.js";
import { CaseStore } from "../src/cases.js";
import { loadConfig } from "../src/config.js";
import { JudgeError, type Judge } from "../src/judge.js";
import { buildRequirements } from "../src/networks.js";

const PAYEE = "0x" + "11".repeat(20);
const PAYER = "0x" + "22".repeat(20);

const env = {
  PAY_TO: PAYEE,
  UPSTREAM_URL: "https://seller.example",
  SERV_API_KEY: "test-key",
  DELIVERY_SPEC: "Return JSON with a numeric temperature.",
};

function payment(nonce = "0x01"): string {
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
    payload: {
      signature: "0xsig",
      authorization: { from: PAYER, to: PAYEE, value: accepted.amount, nonce },
    },
  });
}

function setup(opts: { judge?: Judge; upstream?: () => Promise<Response> } = {}) {
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
  const judge: Judge = opts.judge ?? { judge: vi.fn(async () => ({ verdict: "ACCEPT" as const, reason: "ok" })) };
  const fetchImpl = vi.fn(
    opts.upstream ??
      (async () =>
        new Response('{"temperature":21}', { status: 200, headers: { "content-type": "application/json" } })),
  );
  const store = new CaseStore();
  const app = createApp({
    config: loadConfig(env),
    facilitator: facilitator as unknown as FacilitatorClient,
    judge,
    store,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { app, facilitator, judge, fetchImpl, store };
}

const call = (app: ReturnType<typeof setup>["app"], sig?: string, path = "/v1/forecast?city=berlin") =>
  app.request(path, { headers: sig ? { "payment-signature": sig } : {} });

describe("gateway payment flow", () => {
  it("answers 402 with decodable Kite testnet requirements when unpaid", async () => {
    const { app, fetchImpl } = setup();
    const res = await call(app);
    expect(res.status).toBe(402);
    const required = decodePaymentRequiredHeader(res.headers.get("payment-required")!);
    expect(required.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "eip155:2368",
      payTo: PAYEE,
      amount: "1000000000000000", // 0.001 with 18 decimals
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not call the seller when payment verification fails", async () => {
    const { app, facilitator, fetchImpl } = setup();
    facilitator.verify.mockResolvedValueOnce({ isValid: false, payer: PAYER, invalidReason: "bad_signature" } as never);
    const res = await call(app, payment());
    expect(res.status).toBe(402);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it("settles and delivers when the judge accepts", async () => {
    const { app, facilitator, fetchImpl, store } = setup();
    const res = await call(app, payment());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ temperature: 21 });
    expect(facilitator.verify).toHaveBeenCalledTimes(1);
    expect(facilitator.settle).toHaveBeenCalledTimes(1);
    expect(decodePaymentResponseHeader(res.headers.get("payment-response")!).transaction).toBe("0xtx");
    expect(res.headers.get("x-gavel-verdict")).toBe("ACCEPT");
    expect(store.get(res.headers.get("x-gavel-case")!)?.status).toBe("settled");

    // The upstream saw the original path/query and never the payment header.
    const [target, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(target)).toBe("https://seller.example/v1/forecast?city=berlin");
    expect(new Headers(init.headers).get("payment-signature")).toBeNull();
  });

  it("withholds the payment and the body when the judge rejects", async () => {
    const judge: Judge = { judge: vi.fn(async () => ({ verdict: "REJECT" as const, reason: "no temperature field" })) };
    const { app, facilitator, store } = setup({ judge });
    const res = await call(app, payment());
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; reason: string; case_id: string; settled: boolean };
    expect(body).toMatchObject({ error: "delivery_rejected", settled: false, reason: "no temperature field" });
    expect(JSON.stringify(body)).not.toContain("temperature\":21");
    expect(facilitator.settle).not.toHaveBeenCalled();
    const rec = store.get(body.case_id)!;
    expect(rec.status).toBe("rejected");
    expect(store.getHeld(body.case_id)).toBeDefined(); // kept so an appeal can still settle it
  });

  it("fails closed (no settlement) when the judge is unavailable", async () => {
    const judge: Judge = {
      judge: vi.fn(async () => {
        throw new JudgeError("SERV returned HTTP 500");
      }),
    };
    const { app, facilitator } = setup({ judge });
    const res = await call(app, payment());
    expect(res.status).toBe(503);
    expect(facilitator.settle).not.toHaveBeenCalled();
    // Not consumed: the same authorization may be retried.
    const retry = await call(app, payment());
    expect(retry.status).toBe(503);
  });

  it("does not settle when the seller errors", async () => {
    const { app, facilitator } = setup({ upstream: async () => new Response("boom", { status: 500 }) });
    const res = await call(app, payment());
    expect(res.status).toBe(502);
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it("does not settle when the seller is unreachable", async () => {
    const { app, facilitator } = setup({
      upstream: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const res = await call(app, payment());
    expect(res.status).toBe(502);
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it("does not deliver the body when settlement fails", async () => {
    const { app, facilitator, store } = setup();
    facilitator.settle.mockResolvedValueOnce({
      success: false,
      errorReason: "insufficient_funds",
      transaction: "",
      network: "eip155:2368",
    } as never);
    const res = await call(app, payment());
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("temperature\":21");
    expect(text).toContain("settlement_failed");
    const id = res.headers.get("x-gavel-case")!;
    expect(store.get(id)?.status).toBe("settle_failed");
  });

  it("refuses to reuse a payment authorization that was already judged", async () => {
    const { app, facilitator } = setup();
    const sig = payment("0xabc");
    expect((await call(app, sig)).status).toBe(200);
    const again = await call(app, sig);
    expect(again.status).toBe(409);
    expect(facilitator.settle).toHaveBeenCalledTimes(1);
  });

  it("serves case records without exposing the held authorization", async () => {
    const judge: Judge = { judge: vi.fn(async () => ({ verdict: "REJECT" as const, reason: "bad" })) };
    const { app } = setup({ judge });
    const rejected = (await (await call(app, payment())).json()) as { case_id: string };
    const res = await app.request(`/gavel/cases/${rejected.case_id}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"status":"rejected"');
    expect(text).not.toContain("0xsig");
    expect((await app.request("/gavel/cases/nope")).status).toBe(404);
  });
});
