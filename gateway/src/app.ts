import { createHash } from "node:crypto";
import { Hono } from "hono";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import { CaseStore, type Case } from "./cases.js";
import type { Config } from "./config.js";
import { JudgeError, type Judge } from "./judge.js";
import { buildRequirements } from "./networks.js";

export interface AppDeps {
  config: Config;
  facilitator: FacilitatorClient;
  judge: Judge;
  store?: CaseStore;
  /** Used for the upstream call. Injectable for tests. */
  fetchImpl?: typeof fetch;
}

const FORWARD_HEADERS = ["accept", "accept-language", "content-type"];

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function paymentAuth(payload: PaymentPayload): { from?: string; nonce?: string } {
  const auth = payload.payload?.authorization as { from?: unknown; nonce?: unknown } | undefined;
  return {
    from: typeof auth?.from === "string" ? auth.from : undefined,
    nonce: typeof auth?.nonce === "string" ? auth.nonce : undefined,
  };
}

function nonceKey(payload: PaymentPayload, rawHeader: string): string {
  const { from, nonce } = paymentAuth(payload);
  if (from && nonce) return `${from.toLowerCase()}:${nonce.toLowerCase()}`;
  return `sig:${createHash("sha256").update(rawHeader).digest("hex")}`;
}

function isTextual(contentType: string): boolean {
  if (contentType === "") return true;
  return /^(text\/|application\/(json|xml|javascript)|application\/[a-z0-9.+-]*\+(json|xml))/i.test(contentType);
}

export function createApp(deps: AppDeps): Hono {
  const { config, facilitator, judge } = deps;
  const store = deps.store ?? new CaseStore();
  const doFetch = deps.fetchImpl ?? fetch;
  const requirements: PaymentRequirements = buildRequirements({
    chain: config.network,
    payTo: config.payTo,
    priceUsd: config.priceUsd,
    maxTimeoutSeconds: config.maxTimeoutSeconds,
  });

  const paymentRequired = (resourceUrl: string, error?: string): Response => {
    const body: PaymentRequired = {
      x402Version: 2,
      ...(error ? { error } : {}),
      resource: { url: resourceUrl, description: "Pay-on-proof API via Gavel", mimeType: "application/json" },
      accepts: [requirements],
    };
    return json(402, body, { "payment-required": encodePaymentRequiredHeader(body) });
  };

  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/gavel/cases/:id", (c) => {
    const found = store.get(c.req.param("id"));
    return found ? c.json(found) : c.json({ error: "case_not_found" }, 404);
  });

  app.all("/v1/*", async (c) => {
    const url = new URL(c.req.url);
    const requestLine = `${c.req.method} ${url.pathname}${url.search}`;

    const header = c.req.header("payment-signature") ?? c.req.header("x-payment");
    if (!header) return paymentRequired(c.req.url);

    let payload: PaymentPayload;
    try {
      payload = decodePaymentSignatureHeader(header);
    } catch {
      return paymentRequired(c.req.url, "invalid_payment_header");
    }

    // Read the request body (if any) before taking any payment state.
    let body: Uint8Array | undefined;
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const declared = Number(c.req.header("content-length") ?? 0);
      if (declared > config.maxBodyBytes) return json(413, { error: "request_too_large" });
      body = new Uint8Array(await c.req.arrayBuffer());
      if (body.length > config.maxBodyBytes) return json(413, { error: "request_too_large" });
    }

    const key = nonceKey(payload, header);
    if (!store.claim(key)) return json(409, { error: "payment_already_in_use" });
    let keepClaim = false;

    try {
      // 1. Verify only. Nothing moves yet.
      let verified;
      try {
        verified = await facilitator.verify(payload, requirements);
      } catch {
        return json(503, { error: "facilitator_unavailable" });
      }
      if (!verified.isValid) return paymentRequired(c.req.url, verified.invalidReason ?? "payment_invalid");

      const caseRec: Case = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        status: "unjudged",
        request: requestLine,
        amount: requirements.amount,
        network: requirements.network,
        payer: verified.payer ?? paymentAuth(payload).from,
      };
      store.add(caseRec, { payload, requirements });
      const caseHeaders = { "x-gavel-case": caseRec.id };

      // 2. The seller does the work.
      let target: URL;
      try {
        const base = new URL(config.upstreamUrl);
        target = new URL(base.href.replace(/\/+$/, "") + url.pathname + url.search);
        if (target.origin !== base.origin) throw new Error("origin mismatch");
      } catch {
        store.update(caseRec.id, { status: "upstream_failed" });
        return json(502, { error: "bad_upstream_target", case_id: caseRec.id }, caseHeaders);
      }
      const upHeaders = new Headers();
      for (const name of FORWARD_HEADERS) {
        const v = c.req.header(name);
        if (v) upHeaders.set(name, v);
      }
      if (config.upstreamAuth) upHeaders.set(config.upstreamAuth.header, config.upstreamAuth.value);

      let up: Response;
      let bytes: Uint8Array | null;
      try {
        up = await doFetch(target, {
          method: c.req.method,
          headers: upHeaders,
          body: body as BodyInit | undefined,
          redirect: "manual",
          signal: AbortSignal.timeout(config.upstreamTimeoutMs),
        });
        bytes = await readCapped(up, config.maxBodyBytes);
      } catch {
        store.update(caseRec.id, { status: "upstream_failed" });
        return json(502, { error: "upstream_unreachable", case_id: caseRec.id, settled: false }, caseHeaders);
      }
      store.update(caseRec.id, { upstreamStatus: up.status });
      if (up.status < 200 || up.status >= 300 || bytes === null) {
        store.update(caseRec.id, { status: "upstream_failed" });
        return json(
          502,
          {
            error: bytes === null ? "upstream_response_too_large" : "upstream_error",
            upstream_status: up.status,
            case_id: caseRec.id,
            settled: false,
          },
          caseHeaders,
        );
      }

      // 3. Judge the delivery against the spec. Fail closed.
      const contentType = up.headers.get("content-type") ?? "";
      const deliverable = isTextual(contentType)
        ? new TextDecoder().decode(bytes)
        : `[binary content: ${bytes.length} bytes, content-type ${contentType}]`;
      let result;
      try {
        result = await judge.judge({
          spec: config.spec,
          request: { method: c.req.method, url: `${url.pathname}${url.search}` },
          deliverable,
        });
      } catch (e) {
        store.update(caseRec.id, { status: "unjudged", reason: e instanceof JudgeError ? e.message : "judge failed" });
        return json(503, { error: "judge_unavailable", case_id: caseRec.id, settled: false }, caseHeaders);
      }
      store.update(caseRec.id, { verdict: result.verdict, reason: result.reason });

      if (result.verdict === "REJECT") {
        store.update(caseRec.id, { status: "rejected" });
        keepClaim = true; // authorization stays held for this case
        return json(
          422,
          {
            error: "delivery_rejected",
            case_id: caseRec.id,
            verdict: "REJECT",
            reason: result.reason,
            settled: false,
          },
          caseHeaders,
        );
      }

      // 4. ACCEPT: settle, then deliver.
      keepClaim = true; // from here a charge may exist even if the call below errors
      let settled;
      try {
        settled = await facilitator.settle(payload, requirements);
      } catch {
        store.update(caseRec.id, { status: "settle_failed" });
        return json(502, { error: "settlement_unavailable", case_id: caseRec.id }, caseHeaders);
      }
      if (!settled.success) {
        store.update(caseRec.id, { status: "settle_failed", reason: settled.errorReason });
        return json(
          502,
          { error: "settlement_failed", reason: settled.errorReason, case_id: caseRec.id },
          caseHeaders,
        );
      }
      store.update(caseRec.id, { status: "settled", transaction: settled.transaction });

      const headers = new Headers({
        "cache-control": "no-store",
        "payment-response": encodePaymentResponseHeader(settled),
        "x-gavel-case": caseRec.id,
        "x-gavel-verdict": "ACCEPT",
      });
      if (contentType) headers.set("content-type", contentType);
      return new Response(bytes as BodyInit, { status: up.status, headers });
    } finally {
      if (!keepClaim) store.release(key);
    }
  });

  return app;
}
