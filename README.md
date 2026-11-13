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
| `gateway/` | x402 gateway + SERV Reasoning judge (planned) |
| `web/` | Dashboard (planned) |

## Status

Work in progress during the hackathon (build period ends 2026-11-15).

- `DeliveryJudge` passes `genvm-lint`. Its direct-mode tests are written but **not yet run** (tooling mismatch), so its behavior is untested.
- Nothing is deployed yet.
- Gateway and dashboard are not started.

## Security

Never commit private keys, keystores or `.env` files. See `.gitignore`.
