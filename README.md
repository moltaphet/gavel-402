# Gavel

**Agents pay only for proof.**

Gavel is an escrow gateway for agent payments on [Kite](https://docs.gokite.ai). When an AI agent pays a paid API over x402, the money normally moves before anyone knows whether the answer was any good. Gavel verifies the payment but holds it until the delivery is judged.

Built for the [SERV Hackathon, Edition 02](https://www.openserv.ai/hackathon-2), Kite track.

## How it works

1. The agent calls a paid API through the gateway with an x402 payment authorization. The facilitator **verifies** it. Nothing settles yet.
2. The seller does the work.
3. **First-pass judge (SERV Reasoning)** compares the delivery with the spec the seller promised.
   - ACCEPT and no one objects: the payment settles and the delivery is released.
   - REJECT: nothing settles and the body is withheld.
4. **Appeal court (GenLayer `DeliveryJudge`)**: either side can dispute the verdict. Validators decide by consensus, and money moves only on a final ACCEPT.
   - Seller appeals a REJECT.
   - Buyer appeals an ACCEPT during an optional appeal window.

## Layout

| Path | What |
|---|---|
| `gateway/` | x402 gateway in TypeScript (Hono). Verify, call the seller, judge, settle or withhold, appeal. |
| `contracts/` | `DeliveryJudge` intelligent contract for GenLayer, plus `DEPLOYMENTS.md` |
| `contracts/tests/direct/` | Direct-mode tests for the contract (written, not yet run) |
| `web/` | Courtroom dashboard: a 3D replay of recorded cases (Next.js, React Three Fiber) |

## Status

| Part | State |
|---|---|
| Gateway | 50 unit tests pass. The SERV judge and the GenLayer court client were each run live on small samples. **Not run** against the Kite facilitator with a real signed payment. |
| `DeliveryJudge` contract | Lints clean. Deployed on GenLayer **studio-dev** (`0x03cCab04532d59D09c95f555F2AA38f435A48e8E`) and studio-next. Calibration scored 9/9 on studio-next. Not deployed to Bradbury. |
| Contract unit tests | Written, **not run**: the installed `genlayer-test` does not load the pinned runner. |
| Dashboard | Builds, and was checked in a browser at desktop and phone width. It replays recorded runs, **payments are simulated**, and it is not connected to the gateway. |
| Kite payment | **Not done.** The test faucet gives KITE only, and the gateway needs pieUSD. |

Addresses and history are in [`contracts/DEPLOYMENTS.md`](contracts/DEPLOYMENTS.md).

## Run it

Gateway:

```bash
cd gateway
npm install
cp .env.example .env   # set SERV_API_KEY, PAY_TO, UPSTREAM_URL
npm test
npm run dev
```

Flow per request to `/v1/*`: no payment header returns `402` with the requirements. With a payment, the gateway verifies it, calls the seller, judges, and then settles or withholds. If the judge or the seller fails, nothing settles.

Appeals are enabled by setting `GENLAYER_CONTRACT`, `GENLAYER_PRIVATE_KEY`, and `ADMIN_TOKEN` (see `gateway/.env.example`). Without them, appeal endpoints return `501`.

- Seller appeal: `POST /gavel/cases/:id/appeal` with the admin token, for a REJECT.
- Buyer appeal: the same endpoint with the `case_token` from the response, for an ACCEPT inside the window (`APPEAL_WINDOW_SECONDS`).
- Court ACCEPT settles the held payment. Court REJECT is final.

Dashboard:

```bash
cd web
npm install
npm run dev   # http://localhost:3000
```

Pick a case and the courtroom replays it. "What is real?" lists what is recorded and what is simulated.

Contract tests (not yet runnable here):

```bash
genvm-lint check contracts/delivery_judge.py
```

## Caveats

- Appeal content (spec and deliverable, up to 4000 and 8000 characters) is posted to a **public** chain.
- Cases and withheld bodies are held in memory and are lost on restart.
- The GenLayer validator set in the dashboard is illustrative. Only the verdicts are real.
- Network constants (token address, chain ID) are copied from a community template and need checking against the Kite docs before mainnet use.

## Security

Never commit private keys, keystores, or `.env` files. `.gitignore` covers them. Testnet keys used here live in the local OS keychain and `~/.genlayer`, not in the repo.
