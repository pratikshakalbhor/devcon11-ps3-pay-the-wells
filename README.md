# devcon11-ps3-pay-the-wells

**Road to Devcon XI — Problem 3: retro-funding with a jury-weighted dependency graph.**

A dependency graph is funded from one pot. Jury EIP-712 judgments determine how each parent
splits its downstream share among competing dependencies. The resulting allocation is committed
as a Merkle root onchain, opened to a 48-hour juror dispute window, finalized, and claimed leaf by
leaf. Graph traversal is cycle-safe.

| Item | Value |
| --- | --- |
| Sample pot | `10 ETH` (`10000000000000000000` wei) |
| Sample Merkle root | `0xe0a4e24507e6da90b6f5c165c46af2ae4a1a12c3cb4ad4804debfbb86bd6c477` |
| Merkle leaves | `7` |
| Test juror (public address) | `0x55825c4A63627E344d5cE8FB5f0C6f8daAc653e0` |
| Sepolia contract | [`0xc02f9570f0B7DAB6B12B7ba6d453e5e302A4ec22`](https://sepolia.etherscan.io/address/0xc02f9570f0B7DAB6B12B7ba6d453e5e302A4ec22) |
| Local verification | `forge test` 14/14 pass, `npm test` 4/4 data tests pass, `npm run build` clean |

---

## Architecture

```text
data/graph.json ─────┐
                     ├─► scripts/compute-weights.ts
data/judgments.json ─┘      │  verify EIP-712 signatures
                            │  Bradley-Terry sibling weights
                            │  DFS (visited set + depth cap 100)
                            │  BigInt pot split, exact sum assertion
                            ▼
                 data/allocations.json  +  data/trace.json
                            │
                            ▼
                 scripts/build-merkle.ts
                 StandardMerkleTree.of([[recipient, amount]], ["address","uint256"])
                            │
                            ▼
                    data/merkle.json
                            │
             proposeResult(root) on Sepolia
                            │
                 48h DISPUTE_WINDOW
                    │               │
             juror dispute     no dispute
                    │               │
            resolveDispute      finalize()
             accepted → reset        │
             rejected → close        ▼
                              claim(amount, proof)
                              CEI: claimed = true, then ETH
```

### Onchain lifecycle

1. `constructor(initialJurors) payable` sets `operator = msg.sender`, `totalPot = msg.value`, and
   registers jurors.
2. `proposeResult(root)` is operator-only and accepts exactly one live proposal.
3. Registered jurors may call `dispute(reason)` until `proposedAt + 48 hours`.
4. The operator calls `resolveDispute(true)` to reject the root (resetting `merkleRoot` and
   `proposedAt`, which allows a new proposal) or `resolveDispute(false)` to keep it.
5. `finalize()` succeeds only after the window and only when `hasOpenDispute == false`.
6. Recipients call `claim(amount, proof)`; the proof is checked against the immutable root, the
   `claimed` marker is written **before** the ETH transfer, and `ReentrancyGuard` wraps the call.
7. After `finalize()`, `proposeResult` and `addJuror` revert. The root cannot be overwritten.

### The cycle in the sample graph

`data/graph.json` contains the deliberate cycle:

```text
qr-core ──► i18n-base
i18n-base ──► qr-core
```

`scripts/compute-weights.ts` performs DFS with a global `visited` set:

- On the first visit, the node receives its share, keeps `keepBps / 10000`, and passes the rest to
  its children.
- If a node is reached again (the cycle back-edge), the incoming share is still accounted for, but
  the traversal **does not re-enter** that node. This terminates the cycle without losing wei.
- A separate depth guard throws if `depth > 100`, so even a malformed graph cannot recurse forever.
- Every split assigns the rounding remainder to the last child, and the final assertion is exact:
  `sum(allocations) === totalPot`. No floats are used anywhere.

The frontend marks both directions of the cycle in dashed red; the DFS back-edge is the one the
visited set stops.

### EIP-712 judgments

Domain: `{ name: "DeepFunding", version: "1", chainId: 11155111 }`.
Struct:

```text
Judgment(string packageA, string packageB, string preferred)
```

`preferred` is `"A"`, `"B"`, or `"equal"`. `scripts/compute-weights.ts` recovers each signature and
throws if it does not match `jurorId`. The sample judgments compare the three first-level
dependencies:

| Pair | Preferred |
| --- | --- |
| `qr-tickets` vs `hindi-i18n` | `A` (qr-tickets) |
| `hindi-i18n` vs `wallet-wrapper` | `A` (hindi-i18n) |
| `qr-tickets` vs `wallet-wrapper` | `equal` |

Win counts: `qr-tickets = 1.5`, `hindi-i18n = 1.0`, `wallet-wrapper = 0.5`. Normalized weights:
`0.5 / 0.3333… / 0.1666…`.

### Allocation result (sample, 10 ETH)

| Node | Allocation (ETH) | Share of pot |
| --- | ---: | ---: |
| `event-app` | 5 | 50.0000% |
| `qr-tickets` | 1.25 | 12.5000% |
| `hindi-i18n` | 0.833333333333333333 | 8.3333% |
| `wallet-wrapper` | 0.416666666666666668 | 4.1667% |
| `qr-core` | 0.9375 | 9.3750% |
| `i18n-base` | 1.145833333333333332 | 11.4583% |
| `wallet-core` | 0.416666666666666667 | 4.1667% |
| **Sum** | **10** | **100%** |

### Merkle leaf encoding (important)

`@openzeppelin/merkle-tree`'s `StandardMerkleTree` **double-hashes** leaves:
`keccak256(bytes.concat(keccak256(abi.encode(recipient, amount))))`. The Solidity contract uses the
same double hash so the JS proofs verify onchain. Single-hashing would make every claim fail.

---

## Repository layout

```text
data/
  graph.json          sample dependency graph with cycle
  judgments.json      3 EIP-712 signed comparisons
  allocations.json    BigInt allocations + exact sum assertion
  trace.json          per-node parent, weights, formula (UI explanation)
  merkle.json         root, 7 leaves, proofs
scripts/
  types.ts            shared strict types
  compute-weights.ts  signature verification, weights, cycle-safe DFS, pot split
  build-merkle.ts     StandardMerkleTree + exact sum assertion
  verify-merkle.ts    verifies all proofs
  sign-judgment.ts    test-only EIP-712 signer (key from env)
  make-sample-judgments.ts  regenerates data/judgments.json (key from env)
  data.test.ts        node:test cycle/sum/proof/signature checks
  source-scan.mjs     rejects Number(), parseFloat(), 1e18
src/DeepFunding.sol   dispute window + Merkle claims + CEI + ReentrancyGuard
test/                 Foundry unit, fuzz, reentrancy, invariant tests
script/Deploy.s.sol   Sepolia deploy script (0.01 ETH pot)
ui/                   Vite + React 18 + TypeScript + wagmi v2 + viem
```

---

## Reproduce

Prerequisites: Node 22+, Foundry 1.8+, npm.

```powershell
npm install
forge install foundry-rs/forge-std --no-commit   # already committed as a submodule

# Recompute from the committed graph and judgments.
# The committed judgments verify without any private key.
npm run compute -- --pot 10
npm run merkle -- 10
npm run verify-merkle

# Checks
forge test -vv
npm test          # typecheck + data tests + source scan + Merkle proofs
npm run build     # production UI build -> dist-ui/
node scripts/source-scan.mjs
```

Expected Merkle output:

```text
All 7 proofs valid.
Root: 0xe0a4e24507e6da90b6f5c165c46af2ae4a1a12c3cb4ad4804debfbb86bd6c477
Leaf sum: 10000000000000000000 wei
```

### Regenerating the sample judgments (test only)

`scripts/sign-judgment.ts` and `scripts/make-sample-judgments.ts` are test tooling. They read
`TEST_JUROR_PRIVATE_KEY` from `.env` and never hardcode or commit it. Do **not** use a real funded
key. The committed `.env` is gitignored; only signatures and the public juror address are tracked.

```powershell
# .env contains only: TEST_JUROR_PRIVATE_KEY=0x...
npm run make-judgments
npm run compute -- --pot 10
npm run merkle -- 10
npm run verify-merkle
```

Single judgment:

```powershell
npm run sign-judgment -- --a qr-tickets --b hindi-i18n --prefer A
```

### Frontend

```powershell
Copy-Item ui/.env.example ui/.env.local
# set VITE_CONTRACT_ADDRESS=0xc02f9570f0B7DAB6B12B7ba6d453e5e302A4ec22 (Sepolia)
npm run ui:dev
npm run build
```

The main graph and "Why did I get this much?" panel need no wallet. Dispute and claim panels use
injected wallets and enforce Sepolia (`11155111`). Claim success is shown only when
`receipt.status === "success"`. Amounts use `formatEther` and BigInt percentage math only.

---

## Sepolia deployment

**Status: DEPLOYED. Bytecode verified onchain, Merkle root proposed.**

| Item | Value |
| --- | --- |
| Contract | [`0xc02f9570f0B7DAB6B12B7ba6d453e5e302A4ec22`](https://sepolia.etherscan.io/address/0xc02f9570f0B7DAB6B12B7ba6d453e5e302A4ec22) |
| Etherscan | <https://sepolia.etherscan.io/address/0xc02f9570f0B7DAB6B12B7ba6d453e5e302A4ec22> |
| Deploy tx | [`0x1d55a2cd8b4ad599fb8ec0760739671dde86a9bfbc92504171e944c061114542`](https://sepolia.etherscan.io/tx/0x1d55a2cd8b4ad599fb8ec0760739671dde86a9bfbc92504171e944c061114542) |
| `proposeResult` tx | [`0x4076712e3115f78836dec89c86c455731c5717279de76539b94e78fe3aa602c4`](https://sepolia.etherscan.io/tx/0x4076712e3115f78836dec89c86c455731c5717279de76539b94e78fe3aa602c4) |
| Chain ID | `11155111` |
| Operator | `0x22b94a9953dB57760eF54f010bA304a79bFAbeD2` |
| Juror | `0x55825c4A63627E344d5cE8FB5f0C6f8daAc653e0` |
| Pot | `0.01 ETH` (`10000000000000000` wei, held by the contract) |
| Merkle root | `0xe0a4e24507e6da90b6f5c165c46af2ae4a1a12c3cb4ad4804debfbb86bd6c477` (equals `data/merkle.json`) |
| Runtime code | 3063 bytes, starts `0x608060405234801561` |
| Finalized | `false` — the 48-hour dispute window is open |

The deploy script's output is recorded in `deployments/sepolia.json`
(`chainId`, `contract`, `operator`, `juror`, `totalPotWei`, `status`) and the full broadcast in
`broadcast/Deploy.s.sol/11155111/run-latest.json`.

### Reproduce / verify

```powershell
# 1. Load .env into the PowerShell process.
Get-Content .env | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { Set-Item -Path "Env:$($matches[1])" -Value $matches[2] }
}

# 2. Prove bytecode exists.
$contract = (Get-Content deployments/sepolia.json | ConvertFrom-Json).contract
cast code $contract --rpc-url $env:SEPOLIA_RPC_URL        # starts 0x6080

# 3. Read the committed root.
cast call $contract "merkleRoot()(bytes32)" --rpc-url $env:SEPOLIA_RPC_URL
```

### Redeploying

```powershell
npm run compute -- --pot 10
npm run merkle -- 10

# Sepolia charges roughly 6x the local revm gas estimate for contract creation, so the default
# 130% multiplier runs out of gas. 900% gives the creation enough headroom.
forge script script/Deploy.s.sol:Deploy --rpc-url $env:SEPOLIA_RPC_URL `
  --broadcast --gas-estimate-multiplier 900

$root = (Get-Content data/merkle.json | ConvertFrom-Json).root
$contract = (Get-Content deployments/sepolia.json | ConvertFrom-Json).contract
cast send $contract "proposeResult(bytes32)" $root `
  --rpc-url $env:SEPOLIA_RPC_URL --private-key $env:PRIVATE_KEY
```

`script/Deploy.s.sol` writes `deployments/sepolia.json` after broadcasting. Note that it writes the
file even when the broadcast fails, so always confirm with `cast code` before trusting the address.
`foundry.toml` grants `fs_permissions = [{ access = "read-write", path = "./" }]` so `vm.writeJson`
can create the file.

---

## Rubric map

| # | Rubric item | Implementation | Test / evidence |
| --- | --- | --- | --- |
| 1 | Claims verified against onchain commitment | `src/DeepFunding.sol` → `claim`, `MerkleProof.verify` | `test_Claim_HappyPath`, `test_Claim_InvalidProofReverts`, fuzz invalid proof |
| 2 | Finalization reverts before dispute window closes | `finalize` → `WindowNotClosed` | `test_FinalizeBeforeWindowReverts` |
| 3 | Jury judgments only from registered jurors | `dispute` → `jurors[msg.sender]` / `NotJuror` | `test_NonJurorDisputeReverts` |
| 4 | Open dispute blocks finalization | `finalize` → `hasOpenDispute` / `OpenDispute` | `test_OpenDisputeBlocksFinalize` |
| 5 | Graph traversal terminates on cycles | `compute-weights.ts` `visited` set + `depthGuard(100)` | `scripts/data.test.ts` cycle test; compute output on `qr-core ↔ i18n-base` |
| 6 | Allocation asserts sum == pot exactly | `compute-weights.ts` final assertion; `build-merkle.ts` sum check | `scripts/data.test.ts` allocation sum; `npm run compute` |
| 7 | Claimed marker before transfer (CEI) | `claim` writes `claimed[msg.sender] = true` before `.call` | `test_ClaimedMarkerSetBeforeTransfer`, `test_ReentrancyOnClaim` |
| 8 | Commitment immutable after finalization | `proposeResult` → `AlreadyFinalized`; `addJuror` guarded | `test_FinalizedRootIsImmutable` |
| 9 | Sample graph contains a cycle | `data/graph.json` last two edges | `scripts/data.test.ts` cycle test |
| 10 | No credentials in tracked files | `.gitignore`, `.env.example`, env-only signer | credential grep below; `git ls-files` shows no `.env` |

### Credential check

```powershell
git ls-files | Select-String -Pattern '(^|/)\.env$'
git grep -nE 'PRIVATE_KEY=0x[0-9a-fA-F]{64}' -- . ':!.env.example'
```

Expected: no tracked `.env`, no private-key assignment. The only key material is the untracked
local `.env` used to generate test judgments. Public test addresses and signatures are safe.

---

## Verification table

| Check | Result | Evidence |
| --- | --- | --- |
| `forge test -vv` | **Done — 14 passed, 0 failed** | 13 unit/fuzz + 1 invariant, 256 fuzz runs, 64 invariant runs |
| `npm test` | **Done — 4/4 data tests, typecheck, scan, proofs** | `node:test` TAP output, `All 7 proofs valid.` |
| `npm run build` | **Done — 0 TS errors** | Vite production build to `dist-ui/` |
| `node scripts/source-scan.mjs` | **Done — exit 0** | `source-scan: clean` |
| `node scripts/verify-merkle.ts` | **Done** | `All 7 proofs valid.` |
| Credential grep | **Done — zero secrets** | `.env` untracked; `.env.example` placeholders only |
| Sepolia deployment | **Live — `0xc02f9570f0B7DAB6B12B7ba6d453e5e302A4ec22`** | deploy tx `0x1d55a2cd…1542` in `broadcast/Deploy.s.sol/11155111/run-latest.json` |
| `cast code` proof | **Done — 3063 bytes, starts `0x608060405234801561`** | `cast code 0xc02f…ec22 --rpc-url $env:SEPOLIA_RPC_URL` |
| `proposeResult` smoke test | **Done — root matches `data/merkle.json`** | tx `0x4076712e…02c4`; `merkleRoot()` readback equal |
| Push | **Not run (per instructions)** | push command below |

---

## Push commands

The repository is on branch `main` with all deployment commits applied locally. Do not push from
this environment.

```powershell
git remote add origin https://github.com/pratikshakalbhor/devcon11-ps3-pay-the-wells.git
git push -u origin main
```

---

## Security notes

- The offchain signer is **test-only**. In production, jurors should sign with hardware wallets and
  the domain should bind to a deployed verifier or contract address.
- The contract trusts the operator to propose a correct root and to resolve disputes. The dispute
  window is the social backstop; juror registration is operator-controlled.
- `claim` is `nonReentrant` and follows checks-effects-interactions: proof check → `claimed = true`
  → emit → external transfer. A failed transfer reverts the whole claim.
- The double-hashed leaf encoding is deliberate and must stay in sync with `StandardMerkleTree`.
- No private keys, RPC URLs, or funded accounts are committed.
