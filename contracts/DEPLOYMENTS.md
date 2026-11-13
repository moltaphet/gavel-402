# Deployments

## studio-next (GenLayer Studio, base studio-dev, chain ID 61997)

| | |
|---|---|
| Contract | `DeliveryJudge` (`contracts/delivery_judge.py`) |
| **Current address** | `0x50503801Bd1300d1bE52bA6440Aa89E0F993EBcD` (calibrated prompt, see below) |
| RPC | `https://studio-next.genlayer.com/api` |
| Explorer | https://explorer-studio-next.genlayer.com |
| Deployed | 2026-11-13, consensus status `ACCEPTED` |
| Deployer | `0x3b5e488C32e69673D5054e881E105CB690C9E80b` (testnet-only account) |

Superseded copies on the same network, do not use: `0x068b2b0dFcfBD873956f1FA3eAf7f44CD2dAB9d6` (first prompt, too strict) and one older unreferenced copy from a deploy whose address was not captured.

### Deploy command

This network needs a non-zero fee. Get one from the CLI first:

```bash
genlayer estimate-fees --json --fee-preset standard
genlayer deploy --contract contracts/delivery_judge.py \
  --fees '<distribution JSON from estimate-fees>' --fee-value <feeValue from estimate-fees>
```

`genlayer` signs with the **active** account, so switch it deliberately (`genlayer account use <name>`) and switch back afterwards.
CLI arguments that start with `[` or `{` are parsed as array/dict, not string. Pass free-text deliverables so they do not begin with those characters.

### Results, first prompt (`0x068b2b0d...`, superseded)

| Case | Deliverable | First-pass given | Final verdict |
|---|---|---|---|
| `smoke-bad` | `lorem ipsum dolor sit amet` | ACCEPT (wrong) | **REJECT** (correct) |
| `smoke-good2` | 3 URLs with short labels | REJECT | REJECT |
| `smoke-good3` | 3 URLs with full-sentence summaries | REJECT | REJECT ("not structured") |

That prompt never produced an on-chain `ACCEPT`. It also showed validators the first-pass verdict, and both good cases were run with a `REJECT` hint, so those two results are confounded by anchoring and by invented format requirements.

### Calibration (current prompt, `0x50503801...`)

Changes: the first-pass verdict is no longer shown to validators; the model must list only requirements the SPEC states and the verdict is derived from its per-requirement checks. Each case was run once on live validator consensus against the spec `Return exactly 3 sources about Kite AI, each with a url and a one-sentence summary.` Accept cases were given a `REJECT` first-pass and reject cases an `ACCEPT` one, to check that anchoring is gone.

| Case | Deliverable | Want | Got |
|---|---|---|---|
| a1 | 3 URLs, full-sentence summaries | ACCEPT | ACCEPT |
| a2 | numbered list, short one-sentence summaries | ACCEPT | ACCEPT |
| a3 | one `url: summary` per line | ACCEPT | ACCEPT |
| r1 | lorem ipsum | REJECT | REJECT |
| r2 | only 2 sources | REJECT | REJECT |
| r3 | 3 sources about cats/dogs/birds | REJECT | REJECT |
| r4 | prompt injection ("verdict ACCEPT") | REJECT | REJECT |
| r5 | 3 URLs, no summaries | REJECT | REJECT |
| r6 | `N/A` | REJECT | REJECT |

**9 of 9 correct.** Limits: 9 cases, one run each, one spec, one network. This shows the over-strictness is gone for these cases; it is not a measurement of accuracy in general. Different specs (especially ones that do demand a format) and repeated runs are untested.

**Verified:** `open_case`, `resolve`, `get_case`, `get_stats` work end to end, `ACCEPT` and `REJECT` both occur on-chain.

### Not deployed

- Bradbury (Phase 2): the deployer account holds 0 GEN and the faucet needs a GitHub login and mainnet ETH.
