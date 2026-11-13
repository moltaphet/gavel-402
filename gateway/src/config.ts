import { KITE_NETWORKS, resolveNetwork, type KiteNetwork } from "./networks.js";

export interface Config {
  network: KiteNetwork;
  facilitatorUrl: string;
  payTo: string;
  upstreamUrl: string;
  upstreamAuth?: { header: string; value: string };
  priceUsd: string;
  port: number;
  /** How long the signed payment stays valid. Must outlast upstream call + judging. */
  maxTimeoutSeconds: number;
  upstreamTimeoutMs: number;
  maxBodyBytes: number;
  /** What the seller promised to deliver. The judge decides against this text. */
  spec: string;
  serv: { apiKey: string; baseUrl: string; model: string; timeoutMs: number };
}

export const DEFAULT_SPEC =
  "The response must be a complete, relevant, non-empty answer to the request. " +
  "Empty bodies, error messages, placeholders, lorem ipsum, or off-topic content do not satisfy the spec.";

type Env = Record<string, string | undefined>;

function num(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${key} must be a number between ${min} and ${max}`);
  return n;
}

function need(env: Env, key: string): string {
  const v = env[key]?.trim();
  if (!v) throw new Error(`${key} is required`);
  return v;
}

export function loadConfig(env: Env = process.env): Config {
  const networkName = env.KITE_NETWORK?.trim() || "testnet";
  const network = resolveNetwork(networkName);
  if (!network) throw new Error(`KITE_NETWORK must be one of: ${Object.keys(KITE_NETWORKS).join(", ")}`);

  const payTo = need(env, "PAY_TO");
  if (!/^0x[0-9a-fA-F]{40}$/.test(payTo)) throw new Error("PAY_TO must be a 0x-prefixed 20-byte address");

  const upstreamUrl = need(env, "UPSTREAM_URL");
  let parsed: URL;
  try {
    parsed = new URL(upstreamUrl);
  } catch {
    throw new Error("UPSTREAM_URL must be a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("UPSTREAM_URL must be http(s)");

  const authHeader = env.UPSTREAM_AUTH_HEADER?.trim();
  const authValue = env.UPSTREAM_AUTH_VALUE;
  if (!!authHeader !== !!authValue) throw new Error("UPSTREAM_AUTH_HEADER and UPSTREAM_AUTH_VALUE must be set together");

  return {
    network,
    facilitatorUrl: env.FACILITATOR_URL?.trim() || "https://facilitator.pieverse.io/v2",
    payTo,
    upstreamUrl,
    upstreamAuth: authHeader && authValue ? { header: authHeader, value: authValue } : undefined,
    priceUsd: env.PRICE_USD?.trim() || "0.001",
    port: num(env, "PORT", 8402, 1, 65535),
    maxTimeoutSeconds: num(env, "MAX_TIMEOUT_SECONDS", 120, 10, 3600),
    upstreamTimeoutMs: num(env, "UPSTREAM_TIMEOUT_MS", 10000, 100, 120000),
    maxBodyBytes: num(env, "MAX_BODY_BYTES", 1_000_000, 1, 50_000_000),
    spec: env.DELIVERY_SPEC?.trim() || DEFAULT_SPEC,
    serv: {
      apiKey: need(env, "SERV_API_KEY"),
      baseUrl: (env.SERV_BASE_URL?.trim() || "https://inference-api.openserv.ai/v1").replace(/\/+$/, ""),
      model: env.SERV_MODEL?.trim() || "gpt-5.4-mini",
      timeoutMs: num(env, "SERV_TIMEOUT_MS", 30000, 1000, 120000),
    },
  };
}
