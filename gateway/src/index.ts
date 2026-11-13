import { serve } from "@hono/node-server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { GenLayerCourt } from "./court.js";
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
  court: config.court ? new GenLayerCourt(config.court) : undefined,
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  // Never log keys or payment payloads.
  console.log(
    `Gavel gateway on :${info.port} | ${config.network.network} ${config.network.symbol} | ` +
      `price ${config.priceUsd} | upstream ${new URL(config.upstreamUrl).origin} | judge ${config.serv.model} | ` +
      (config.court
        ? `court ${config.court.network} ${config.court.contract} | appeal window ${config.appealWindowSeconds}s`
        : "court off (appeals disabled)"),
  );
});
