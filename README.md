# Gavel

**Agents pay only for proof.**

Gavel is an escrow gateway for agent payments on [Kite](https://docs.gokite.ai). When an AI agent pays a paid API over x402, the money normally moves before anyone knows whether the answer was any good. Gavel holds the payment until the delivery is judged.

Built for the [SERV Hackathon, Edition 02](https://www.openserv.ai/hackathon-2) (Kite track).

## How it works

1. The agent calls a paid API through the Gavel gateway and sends an x402 payment authorization. The facilitator **verifies** it, but nothing is **settled** yet.
2. The seller does the work.
3. **Fast judge (SERV Reasoning)** checks the result against the delivery spec the seller promised. If it passes and nobody objects, the payment is settled.
4. **Appeal court (GenLayer)**: either side can dispute the verdict. The case goes to the `DeliveryJudge` intelligent contract, validators reach a final `ACCEPT` / `REJECT` by consensus, and the gateway settles only on `ACCEPT`. It currently runs on GenLayer **studio-next**; Bradbury is not deployed yet (see `contracts/DEPLOYMENTS.md`).

## Layout

| Path | What |
|---|---|
| `contracts/` | GenLayer intelligent contract (`DeliveryJudge`) |
| `tests/direct/` | Direct-mode tests for the contract |
| `gateway/` | x402 gateway + SERV Reasoning judge (TypeScript, Hono) |
| `web/` | Dashboard (planned) |

## Status

Work in progress during the hackathon (build period ends 2026-11-15).

- `DeliveryJudge` passes `genvm-lint` and is deployed on studio-next. It got 9/9 on a live calibration set (one run each, one spec). Its direct-mode unit tests are written but **not run** locally (tooling mismatch).
- `gateway/`: verify, upstream call, SERV judge, settle-or-withhold, and the appeal flow (seller and buyer, optional appeal window) are implemented with 50 passing unit tests. Facilitator, seller and court are mocked in those; the SERV judge and the GenLayer court client were each also exercised live on small samples.
- **Never run:** the gateway against the real Kite facilitator or a real signed payment (no pieUSD yet), or gateway + live court together. Whether a signed authorization stays settleable through an appeal window is untested.
- Not deployed to Bradbury. The dashboard is not started.

## Run the gateway

```bash
cd gateway
npm install
cp .env.example .env   # set SERV_API_KEY, PAY_TO, UPSTREAM_URL
npm test
npm run dev
```

Flow per request to `/v1/*`: no payment header -> `402` with requirements; with payment -> facilitator **verify** -> call the seller -> SERV judge -> `ACCEPT`: **settle** and deliver, `REJECT`: nothing settles, body withheld, case recorded at `GET /gavel/cases/:id`. If the judge or seller fails, nothing settles.

## Appeals

Set `GENLAYER_CONTRACT`, `GENLAYER_PRIVATE_KEY` (and `GENLAYER_RPC_URL`, `GENLAYER_NETWORK`) to enable the court, and `ADMIN_TOKEN` so the seller can appeal. Without them appeals return `501`.

| Who | Can appeal | Credential |
|---|---|---|
| Seller (gateway operator) | a `REJECT` | `Authorization: Bearer $ADMIN_TOKEN` |
| Buyer | an `ACCEPT` that is still inside the appeal window | the `case_token` from their response |

- Default `APPEAL_WINDOW_SECONDS=0`: an `ACCEPT` settles at once, so there is nothing for a buyer to appeal. With a window `> 0` the `ACCEPT` is held (`202`) and the body withheld until the window ends, the buyer calls `POST /gavel/cases/:id/accept`, or an appeal settles it. `MAX_TIMEOUT_SECONDS` must be at least window + 180 so the signed payment outlives the court.
- `POST /gavel/cases/:id/appeal` sends the case to the court. Court `ACCEPT` settles the held payment; court `REJECT` is final and nothing settles. `GET /gavel/cases/:id/delivery` (buyer token) releases the body only after settlement.
- A court that errors never settles anything; the case goes back to its previous state and can be retried.

Caveats: the spec and deliverable (up to 4000 / 8000 characters) are written to a **public** chain when appealed. The gateway operator pays court fees. Cases and withheld bodies live **in memory** only and are lost on restart.

## Security

Never commit private keys, keystores or `.env` files. See `.gitignore`.
