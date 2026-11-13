# Gavel

**Agents pay only for proof.**

Gavel is an escrow gateway for agent payments on [Kite](https://docs.gokite.ai). When an AI agent pays a paid API over x402, the money normally moves before anyone knows whether the answer was any good. Gavel holds the payment until the delivery is judged.

Built for the [SERV Hackathon, Edition 02](https://www.openserv.ai/hackathon-2) (Kite track).

## How it works

1. The agent calls a paid API through the Gavel gateway and sends an x402 payment authorization. The facilitator **verifies** it, but nothing is **settled** yet.
2. The seller does the work.
3. **Fast judge (SERV Reasoning)** checks the result against the delivery spec the seller promised. If it passes and nobody objects, the payment is settled.
4. **Appeal court (GenLayer, Bradbury testnet)**: if either side disputes the verdict, or the amount is large, the case goes to the `DeliveryJudge` intelligent contract. Validators reach a final `ACCEPT` / `REJECT` by consensus, and the gateway settles only on `ACCEPT`.

## Layout

| Path | What |
|---|---|
| `contracts/` | GenLayer intelligent contract (`DeliveryJudge`) |
| `tests/direct/` | Direct-mode tests for the contract |
| `gateway/` | x402 gateway + SERV Reasoning judge (TypeScript, Hono) |
| `web/` | Dashboard (planned) |

## Status

Work in progress during the hackathon (build period ends 2026-11-15).

- `DeliveryJudge` passes `genvm-lint`. Its direct-mode tests are written but **not yet run** (tooling mismatch), so its behavior is untested.
- `gateway/`: verify, upstream call, SERV judge, settle-or-withhold flow is implemented with 21 passing unit tests (facilitator, seller and judge are mocked). The SERV judge was also checked live on 5 sample deliveries. The gateway has **not** been run against the real Kite facilitator or a real signed payment yet, and the GenLayer appeal path is not wired in.
- Nothing is deployed yet. The dashboard is not started.

## Run the gateway

```bash
cd gateway
npm install
cp .env.example .env   # set SERV_API_KEY, PAY_TO, UPSTREAM_URL
npm test
npm run dev
```

Flow per request to `/v1/*`: no payment header -> `402` with requirements; with payment -> facilitator **verify** -> call the seller -> SERV judge -> `ACCEPT`: **settle** and deliver, `REJECT`: nothing settles, body withheld, case recorded at `GET /gavel/cases/:id`. If the judge or seller fails, nothing settles.

## Security

Never commit private keys, keystores or `.env` files. See `.gitignore`.
