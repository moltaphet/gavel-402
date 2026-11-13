import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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
import { CourtError, type Court } from "./court.js";
import { JudgeError, type Judge } from "./judge.js";
import { buildRequirements } from "./networks.js";

export interface AppDeps {
  config: Config;
  facilitator: FacilitatorClient;
  judge: Judge;
  /** GenLayer appeal court. Appeals return 501 when absent. */
  court?: Court;
  store?: CaseStore;
  /** Used for the upstream call. Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Epoch ms clock. Injectable for tests. */
  now?: () => number;
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

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/** Constant-time comparison of secrets (compares fixed-length digests). */
function tokenOk(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

function bearer(header: string | undefined): string | undefined {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return m?.[1]?.trim();
}

export function createApp(deps: AppDeps): Hono {
  const { config, facilitator, judge, court } = deps;
  const store = deps.store ?? new CaseStore();
  const doFetch = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const requirements: PaymentRequirements = buildRequirements({
    chain: config.network,
    payTo: config.payTo,
    priceUsd: config.priceUsd,
    maxTimeoutSeconds: config.maxTimeoutSeconds,
  });

  /** Cases currently being settled or appealed; stops two requests acting on one case. */
  const busy = new Set<string>();

  const paymentRequired = (resourceUrl: string, error?: string): Response => {
    const body: PaymentRequired = {
      x402Version: 2,
      ...(error ? { error } : {}),
      resource: { url: resourceUrl, description: "Pay-on-proof API via Gavel", mimeType: "application/json" },
      accepts: [requirements],
    };
    return json(402, body, { "payment-required": encodePaymentRequiredHeader(body) });
  };

  /** Settle the held authorization for a case and record the outcome. */
  async function settleHeld(id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const held = store.getHeld(id);
    if (!held) return { ok: false, reason: "no_held_payment" };
    let settled;
    try {
      settled = await facilitator.settle(held.payload, held.requirements);
    } catch {
      store.update(id, { status: "settle_failed" });
      return { ok: false, reason: "settlement_unavailable" };
    }
    if (!settled.success) {
      store.update(id, { status: "settle_failed", reason: settled.errorReason });
      return { ok: false, reason: settled.errorReason ?? "settlement_failed" };
    }
    store.update(id, { status: "settled", transaction: settled.transaction });
    const d = store.getDelivery(id);
    if (d) d.paymentResponse = encodePaymentResponseHeader(settled);
    return { ok: true };
  }

  function deliveryResponse(id: string): Response {
    const d = store.getDelivery(id)!;
    const headers = new Headers({
      "cache-control": "no-store",
      "x-gavel-case": id,
      "x-gavel-verdict": "ACCEPT",
    });
    if (d.contentType) headers.set("content-type", d.contentType);
    if (d.paymentResponse) headers.set("payment-response", d.paymentResponse);
    return new Response(d.bytes as BodyInit, { status: d.upstreamStatus, headers });
  }

  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/gavel/cases/:id", (c) => {
    const found = store.get(c.req.param("id"));
    return found ? c.json(found) : c.json({ error: "case_not_found" }, 404);
  });

  // ----------------------------------------------------------------- appeal

  app.post("/gavel/cases/:id/appeal", async (c) => {
    const id = c.req.param("id");
    const rec = store.get(id);
    if (!rec) return json(404, { error: "case_not_found" });
    if (!court) return json(501, { error: "appeal_not_configured" });

    const token = bearer(c.req.header("authorization"));
    const delivery = store.getDelivery(id);
    let by: "buyer" | "seller" | undefined;
    if (delivery && tokenOk(token, delivery.token)) by = "buyer";
    else if (tokenOk(token, config.adminToken)) by = "seller";
    if (!by) return json(403, { error: "forbidden" });

    if (busy.has(id)) return json(409, { error: "case_busy" });
    // Standing: a buyer contests an acceptance, a seller contests a rejection.
    if (by === "buyer") {
      if (rec.status !== "accepted_pending") {
        return json(409, { error: "buyer_can_only_appeal_a_pending_acceptance", status: rec.status });
      }
      if (delivery?.releaseAtMs !== undefined && now() >= delivery.releaseAtMs) {
        return json(409, { error: "appeal_window_closed", release_at: rec.releaseAt });
      }
    } else if (rec.status !== "rejected") {
      return json(409, { error: "seller_can_only_appeal_a_rejection", status: rec.status });
    }
    if (!delivery) return json(409, { error: "nothing_to_appeal" });

    busy.add(id);
    const previous = rec.status;
    store.update(id, { status: "appeal_pending", appealBy: by });
    try {
      let result;
      try {
        result = await court.resolve({
          caseId: id,
          spec: config.spec,
          deliverable: delivery.text,
          paymentRef: id,
          firstVerdict: rec.verdict ?? "REJECT",
          firstReason: rec.reason ?? "",
        });
      } catch (e) {
        store.update(id, { status: previous, appealBy: undefined });
        return json(502, {
          error: "court_unavailable",
          detail: e instanceof CourtError ? e.message : undefined,
          case_id: id,
        });
      }
      store.update(id, {
        appealVerdict: result.verdict,
        appealReason: result.reason,
        appealTxs: result.txHashes,
      });

      if (result.verdict === "REJECT") {
        store.update(id, { status: "appeal_rejected" });
        return json(200, {
          case_id: id,
          appeal_by: by,
          verdict: "REJECT",
          settled: false,
          reason: result.reason,
          court_txs: result.txHashes,
        });
      }

      const settled = await settleHeld(id);
      if (!settled.ok) {
        return json(502, { error: "settlement_failed", reason: settled.reason, case_id: id, verdict: "ACCEPT" });
      }
      return json(200, {
        case_id: id,
        appeal_by: by,
        verdict: "ACCEPT",
        settled: true,
        delivery: `/gavel/cases/${id}/delivery`,
        reason: result.reason,
        court_txs: result.txHashes,
      });
    } finally {
      busy.delete(id);
    }
  });

  // ----------------------------------------------------- release / delivery

  /** Buyer is satisfied: release the held payment now instead of waiting out the window. */
  app.post("/gavel/cases/:id/accept", async (c) => {
    const id = c.req.param("id");
    const rec = store.get(id);
    const delivery = store.getDelivery(id);
    if (!rec || !delivery) return json(404, { error: "case_not_found" });
    if (!tokenOk(bearer(c.req.header("authorization")), delivery.token)) return json(403, { error: "forbidden" });
    if (rec.status !== "accepted_pending") return json(409, { error: "not_pending", status: rec.status });
    if (busy.has(id)) return json(409, { error: "case_busy" });
    busy.add(id);
    try {
      const settled = await settleHeld(id);
      if (!settled.ok) return json(502, { error: "settlement_failed", reason: settled.reason, case_id: id });
      return deliveryResponse(id);
    } finally {
      busy.delete(id);
    }
  });

  /** Collect the deliverable. Only released once the payment has settled. */
  app.get("/gavel/cases/:id/delivery", async (c) => {
    const id = c.req.param("id");
    const rec = store.get(id);
    const delivery = store.getDelivery(id);
    if (!rec || !delivery) return json(404, { error: "case_not_found" });
    if (!tokenOk(bearer(c.req.header("authorization")), delivery.token)) return json(403, { error: "forbidden" });

    if (rec.status === "settled") return deliveryResponse(id);

    if (rec.status === "accepted_pending") {
      if (delivery.releaseAtMs !== undefined && now() < delivery.releaseAtMs) {
        return json(425, { error: "appeal_window_open", release_at: rec.releaseAt, case_id: id });
      }
      if (busy.has(id)) return json(409, { error: "case_busy" });
      busy.add(id);
      try {
        // The window passed with no appeal: release the payment, then deliver.
        const settled = await settleHeld(id);
        if (!settled.ok) return json(502, { error: "settlement_failed", reason: settled.reason, case_id: id });
        return deliveryResponse(id);
      } finally {
        busy.delete(id);
      }
    }
    return json(409, { error: "not_deliverable", status: rec.status, case_id: id });
  });

  // ------------------------------------------------------------- paid route

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
        createdAt: new Date(now()).toISOString(),
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

      // The withheld response and the buyer's secret, kept for appeals and later collection.
      const caseToken = randomBytes(24).toString("hex");
      const withhold = (releaseAtMs?: number) =>
        store.setDelivery(caseRec.id, {
          bytes: bytes!,
          contentType,
          upstreamStatus: up.status,
          text: deliverable,
          token: caseToken,
          releaseAtMs,
        });
      const appealPath = court ? `/gavel/cases/${caseRec.id}/appeal` : undefined;

      if (result.verdict === "REJECT") {
        withhold();
        store.update(caseRec.id, { status: "rejected" });
        keepClaim = true; // authorization stays held for this case
        return json(
          422,
          {
            error: "delivery_rejected",
            case_id: caseRec.id,
            case_token: caseToken,
            verdict: "REJECT",
            reason: result.reason,
            settled: false,
            // The seller (operator) may appeal; the buyer collects via `delivery` if the court overturns it.
            ...(appealPath ? { appeal: appealPath, delivery: `/gavel/cases/${caseRec.id}/delivery` } : {}),
          },
          caseHeaders,
        );
      }

      // 4a. ACCEPT inside an appeal window: hold the payment so the buyer can still contest it.
      if (config.appealWindowSeconds > 0) {
        const releaseAtMs = now() + config.appealWindowSeconds * 1000;
        withhold(releaseAtMs);
        store.update(caseRec.id, { status: "accepted_pending", releaseAt: new Date(releaseAtMs).toISOString() });
        keepClaim = true;
        return json(
          202,
          {
            case_id: caseRec.id,
            case_token: caseToken,
            verdict: "ACCEPT",
            settled: false,
            release_at: new Date(releaseAtMs).toISOString(),
            delivery: `/gavel/cases/${caseRec.id}/delivery`,
            accept_now: `/gavel/cases/${caseRec.id}/accept`,
            ...(appealPath ? { appeal: appealPath } : {}),
          },
          caseHeaders,
        );
      }

      // 4b. ACCEPT with no window: settle, then deliver.
      keepClaim = true; // from here a charge may exist even if the call below errors
      withhold();
      busy.add(caseRec.id);
      let settled;
      try {
        settled = await settleHeld(caseRec.id);
      } finally {
        busy.delete(caseRec.id);
      }
      if (!settled.ok) {
        store.deleteDelivery(caseRec.id); // no appeal path in this mode: don't keep the body
        const errorName = settled.reason === "settlement_unavailable" ? "settlement_unavailable" : "settlement_failed";
        return json(502, { error: errorName, reason: settled.reason, case_id: caseRec.id }, caseHeaders);
      }
      const response = deliveryResponse(caseRec.id);
      store.deleteDelivery(caseRec.id); // delivered once; nothing left to collect
      return response;
    } finally {
      if (!keepClaim) store.release(key);
    }
  });

  return app;
}
