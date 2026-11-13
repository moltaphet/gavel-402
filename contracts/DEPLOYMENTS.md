# Deployments

## studio-next (GenLayer Studio, base studio-dev, chain ID 61997)

| | |
|---|---|
| Contract | `DeliveryJudge` (`contracts/delivery_judge.py`) |
| Address | `0x068b2b0dFcfBD873956f1FA3eAf7f44CD2dAB9d6` |
| RPC | `https://studio-next.genlayer.com/api` |
| Explorer | https://explorer-studio-next.genlayer.com |
| Deployed | 2026-11-13, consensus status `ACCEPTED` |
| Deployer | `0x3b5e488C32e69673D5054e881E105CB690C9E80b` (testnet-only account) |

Note: a first deploy attempt that returned `ACCEPTED` was repeated to capture the address, so an older, unreferenced copy of the contract exists on the same network. Use only the address above.

### Deploy command

This network needs a non-zero fee. Get one from the CLI first:

```bash
genlayer estimate-fees --json --fee-preset standard
genlayer deploy --contract contracts/delivery_judge.py \
  --fees '<distribution JSON from estimate-fees>' --fee-value <feeValue from estimate-fees>
```

`genlayer` signs with the **active** account, so switch it deliberately (`genlayer account use <name>`) and switch back afterwards.
CLI arguments that start with `[` or `{` are parsed as array/dict, not string. Pass free-text deliverables so they do not begin with those characters.

### Smoke test results (live validator consensus, ~23 s per `resolve`)

| Case | Deliverable | First-pass | Final verdict |
|---|---|---|---|
| `smoke-bad` | `lorem ipsum dolor sit amet` | ACCEPT (wrong) | **REJECT** (correct; overrode the first pass) |
| `smoke-good2` | 3 URLs with short labels | REJECT | REJECT (summaries too brief) |
| `smoke-good3` | 3 URLs with full-sentence summaries, plain text | REJECT | REJECT (not "structured" enough) |

**Verified:** `open_case`, `resolve`, `get_case`, `get_stats` work end to end, and a garbage deliverable is rejected.

**Not verified:** the `ACCEPT` path has never produced an `ACCEPT` on-chain. In both reasonable deliveries the validators rejected for formatting reasons the spec did not clearly require. The judge prompt is likely too strict about format and needs calibration before this is trusted to release payments.

### Not deployed

- Bradbury (Phase 2): the deployer account holds 0 GEN and the faucet needs a GitHub login and mainnet ETH.
