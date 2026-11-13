import { serve } from "@hono/node-server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { ServJudge } from "./judge.js";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: rely on the real environment.
}

const config = loadConfig();
const app = createApp({
  config,
  facilitator: new HTTPFacilitatorClient({ url: config.facilitatorUrl }),
  judge: new ServJudge(config.serv),
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  // Never log keys or payment payloads.
  console.log(
    `Gavel gateway on :${info.port} | ${config.network.network} ${config.network.symbol} | ` +
      `price ${config.priceUsd} | upstream ${new URL(config.upstreamUrl).origin} | judge ${config.serv.model}`,
  );
});
