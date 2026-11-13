import type { Network, PaymentRequirements } from "@x402/core/types";

export interface KiteNetwork {
  readonly network: Network;
  readonly asset: string;
  readonly symbol: string;
  readonly decimals: number;
  /** EIP-712 domain name/version of the payment token (needed by the "exact" scheme). */
  readonly name: string;
  readonly version: string;
}

// Constants follow gokite-ai/kite-x402-services as mirrored by the community
// kite-x402-hono template (BrKDDD/kite-x402-hono, Apache-2.0). Re-verify before mainnet use.
export const KITE_NETWORKS = {
  mainnet: {
    network: "eip155:2366",
    asset: "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e",
    symbol: "USDC.e",
    decimals: 6,
    name: "Bridged USDC (Kite AI)",
    version: "2",
  },
  testnet: {
    network: "eip155:2368",
    asset: "0x38129cf4CE5E183eFF248F42A7D345Bb1B47621A",
    symbol: "pieUSD",
    decimals: 18,
    name: "pieUSD",
    version: "1",
  },
} as const satisfies Record<string, KiteNetwork>;

export function resolveNetwork(identifier: string | number): KiteNetwork | undefined {
  const norm = String(identifier).trim().toLowerCase();
  if (norm === "mainnet" || norm === "2366" || norm === "eip155:2366") return KITE_NETWORKS.mainnet;
  if (norm === "testnet" || norm === "2368" || norm === "eip155:2368") return KITE_NETWORKS.testnet;
  return undefined;
}

/** "0.001" -> atomic units string for the network's token. At most 6 fractional digits. */
export function priceToUnits(price: string, chain: KiteNetwork): string {
  const value = price.trim().replace(/^\$/, "");
  if (!/^\d+(?:\.\d{1,6})?$/.test(value) || value.length > 40) {
    throw new Error("PRICE_USD must be a positive decimal with at most 6 fractional digits");
  }
  const [whole = "0", fractional = ""] = value.split(".");
  const units = BigInt(whole + fractional.padEnd(chain.decimals, "0"));
  if (units <= 0n) throw new Error("PRICE_USD must be greater than zero");
  return units.toString();
}

export function buildRequirements(opts: {
  chain: KiteNetwork;
  payTo: string;
  priceUsd: string;
  maxTimeoutSeconds: number;
}): PaymentRequirements {
  return {
    scheme: "exact",
    network: opts.chain.network,
    asset: opts.chain.asset,
    amount: priceToUnits(opts.priceUsd, opts.chain),
    payTo: opts.payTo,
    maxTimeoutSeconds: opts.maxTimeoutSeconds,
    extra: { name: opts.chain.name, version: opts.chain.version },
  };
}
