# devcon11-ps3-pay-the-wells

Jury-weighted retro-funding for a dependency graph, settled onchain with a Merkle root, a 48-hour
dispute window, and pull-based ETH claims.

> Road to Devcon XI — Problem 3. Offchain allocation is computed in BigInt, committed onchain, and
> claimed leaf by leaf. Contract and tooling are unaudited; do not use with real funds.

---

## Live deployment (Sepolia)

| Item | Value |
| --- | --- |
| Contract | [`0xc02f9570f0B7DAB6B12B7ba6d453e5e302A4ec22`](https://sepolia.etherscan.io/address/0xc02f9570f0B7DAB6B12B7ba6d453e5e302A4ec22) |
| Deploy tx | [`0x1d55a2cd8b4ad599fb8ec0760739671dde86a9bfbc92504171e944c061114542`](https://sepolia.etherscan.io/tx/0x1d55a2cd8b4ad599fb8ec0760739671dde86a9bfbc92504171e944c061114542) |
| `proposeResult` tx | [`0x4076712e3115f78836dec89c86c455731c5717279de76539b94e78fe3aa602c4`](https://sepolia.etherscan.io/tx/0x4076712e3115f78836dec89c86c455731c5717279de76539b94e78fe3aa602c4) |
| Chain ID | `11155111` |
| Operator | `0x22b94a9953dB57760eF54f010bA304a79bFAbeD2` |
| Juror | `0x55825c4A63627E344d5cE8FB5f0C6f8daAc653e0` |
| Pot | `0.01 ETH` (`10000000000000000` wei, held by the contract) |
| Merkle root | `0xe0a4e24507e6da90b6f5c165c46af2ae4a1a12c3cb4ad4804debfbb86bd6c477` |
| Runtime code | 3,063 bytes, starts `0x608060405234801561` |
| State | Root proposed, `finalized() == false`, dispute window open |

`deployments/sepolia.json` is the machine-readable record; the full broadcast is in
`broadcast/Deploy.s.sol/11155111/run-latest.json` (gitignored).

---

## Stack

| Layer | Tooling |
| --- | --- |
| Contract | Solidity `0.8.24`, Foundry 1.8+, OpenZeppelin 5.4 (`ReentrancyGuard`, `MerkleProof`) |
| Offchain pipeline | TypeScript, `tsx`, `@openzeppelin/merkle-tree`, `viem` |
| Frontend | Vite 6, React 18, wagmi v2, viem v2, TanStack Query |
| Data | JSON artifacts committed under `data/` |

---

## Quickstart

```powershell
git clone https://github.com/pratikshakalbhor/devcon11-ps3-pay-the-wells.git
cd devcon11-ps3-pay-the-wells
npm install
forge install foundry-rs/forge-std --no-commit   # already vendored as a submodule
```

Recompute the committed artifacts and run every check:

```powershell
npm run pipeline        # compute -> merkle -> verify-merkle
forge test             # 13 unit/fuzz + 1 invariant
npm test                # typecheck + data tests + source scan + proof verification
npm run build           # production UI -> dist-ui/
```

Expected pipeline tail:

```text
All 7 proofs valid.
Root: 0xe0a4e24507e6da90b6f5c165c46af2ae4a1a12c3cb4ad4804debfbb86bd6c477
Leaf sum: 10000000000000000000 wei
```

### npm scripts

| Script | What it does |
| --- | --- |
| `npm run compute -- --pot 10` | Verify EIP-712 judgments, compute Bradley-Terry weights, run cycle-safe DFS, split the pot, write `data/allocations.json` + `data/trace.json` |
| `npm run merkle -- 10` | Build `StandardMerkleTree` over `[recipient, amount]` leaves, assert exact sum, write `data/merkle.json` |
| `npm run verify-merkle` | Re-verify every proof in `data/merkle.json` |
| `npm run pipeline` | `compute` -> `merkle -- 10` -> `verify-merkle` |
| `npm test` | `typecheck` + `test:data` + `source-scan` + `verify-merkle` |
| `npm run source-scan` | Fails on `Number(`, `parseFloat(`, or `1e18` in `scripts/` and `ui/src/` |
| `npm run sign-judgment -- --a X --b Y --prefer A` | Test-only EIP-712 signer (uses `TEST_JUROR_PRIVATE_KEY`) |
| `npm run make-judgments` | Regenerates `data/judgments.json` from the sample graph |
| `npm run ui:dev` | Vite dev server for the UI |
| `npm run build` | Typecheck + production UI build into `dist-ui/` |

---

## Architecture

```text
data/graph.json ─────┐
                     ├─► scripts/compute-weights.ts
data/judgments.json ─┘      │  verify EIP-712 signatures
                            │  Bradley-Terry sibling weights
                            │  DFS with visited set + depth cap 100
                            │  BigInt pot split, exact sum assertion
                            ▼
                 data/allocations.json + data/trace.json
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

1. `constructor(initialJurors) payable` — `operator = msg.sender`, `totalPot = msg.value`,
   registers each juror, emits `JurorAdded`.
2. `proposeResult(root)` — operator-only, one live proposal at a time.
3. `dispute(reason)` — registered jurors only, until `proposedAt + 48 hours`; sets
   `hasOpenDispute` and records `keccak256(abi.encode(msg.sender, reason, block.timestamp))`.
4. `resolveDispute(accepted)` — operator-only. `accepted == true` clears `merkleRoot` and
   `proposedAt` so a new root can be proposed; `false` keeps the root and closes the dispute.
5. `finalize()` — only after the window and only when `hasOpenDispute == false`.
6. `claim(amount, proof)` — proof checked against the immutable root; `claimed[msg.sender]` is
   written **before** the ETH transfer; `nonReentrant` guards the call.
7. After `finalize()`, `proposeResult` and `addJuror` revert. The root cannot be overwritten.

---

## Contract API

`src/DeepFunding.sol` — `contract DeepFunding is ReentrancyGuard`.

### State

| Member | Type | Notes |
| --- | --- | --- |
| `operator` | `address public immutable` | Deployer; proposes roots, adds jurors, resolves disputes |
| `merkleRoot` | `bytes32 public` | Live commitment, zero when none/after accepted dispute |
| `totalPot` | `uint256 public` | Wei funded at construction |
| `proposedAt` | `uint256 public` | Timestamp of the current proposal |
| `DISPUTE_WINDOW` | `uint256 public constant` | `48 hours` |
| `finalized` | `bool public` | Terminal flag |
| `hasOpenDispute` | `bool public` | Blocks finalization while true |
| `jurors` / `claimed` / `disputed` | `mapping` | Registration, claim marker, dispute hashes |

### Functions

| Function | Access | Guards |
| --- | --- | --- |
| `constructor(address[] initialJurors) payable` | anyone | `ZeroAddress` per juror |
| `addJuror(address juror)` | operator | `AlreadyFinalized`, `ZeroAddress` |
| `proposeResult(bytes32 root)` | operator | `AlreadyFinalized`, `AlreadyProposed`, `InvalidRoot` |
| `dispute(string reason)` | juror | `NothingProposed`, `WindowClosed`, `NotJuror` |
| `resolveDispute(bool accepted)` | operator | `NoOpenDispute` |
| `finalize()` | anyone | `AlreadyFinalized`, `NothingProposed`, `WindowNotClosed`, `OpenDispute` |
| `claim(uint256 amount, bytes32[] proof)` | recipient | `NotFinalized`, `AlreadyClaimed`, `InvalidProof`, `TransferFailed`, `nonReentrant` |

### Events

`ResultProposed(bytes32 root, uint256 proposedAt)`, `Disputed(address indexed juror, string reason)`,
`DisputeResolved(bool accepted)`, `Finalized(bytes32 root)`,
`Claimed(address indexed recipient, uint256 amount)`, `JurorAdded(address indexed juror)`.

### Leaf encoding (critical)

`@openzeppelin/merkle-tree`'s `StandardMerkleTree` **double-hashes** leaves:

```solidity
leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount))));
```

The contract uses the same construction. Single-hashing makes every claim fail with
`InvalidProof`.

---

## Data pipeline

### Inputs

- `data/graph.json` — packages with `id`, `keepBps`, and `dependencies`.
- `data/judgments.json` — EIP-712 signed pairwise comparisons.

The sample graph contains a deliberate cycle:

```text
qr-core ──► i18n-base
i18n-base ──► qr-core
```

`compute-weights.ts` performs DFS with a global `visited` set: a re-entered node still receives its
incoming share but is not traversed again, so the cycle terminates without losing wei. A separate
`depth > 100` guard throws on malformed graphs. Each split gives the rounding remainder to the last
child, and the final assertion is exact: `sum(allocations) === totalPot`. No floats.

### EIP-712 judgments

```text
Domain: { name: "DeepFunding", version: "1", chainId: 11155111 }
Struct: Judgment(string packageA, string packageB, string preferred)
```

`preferred` is `"A"`, `"B"`, or `"equal"`. Signatures are recovered and checked against the
`jurorId` in `data/judgments.json`; a mismatch throws. Win counts feed Bradley-Terry sibling
weights (`1` win, `0.5` tie), which are normalized per sibling set.

### Sample allocation (10 ETH pot)

| Node | ETH | Share |
| --- | ---: | ---: |
| `event-app` | 5 | 50.0000% |
| `qr-tickets` | 1.25 | 12.5000% |
| `hindi-i18n` | 0.833333333333333333 | 8.3333% |
| `wallet-wrapper` | 0.416666666666666668 | 4.1667% |
| `qr-core` | 0.9375 | 9.3750% |
| `i18n-base` | 1.145833333333333332 | 11.4583% |
| `wallet-core` | 0.416666666666666667 | 4.1667% |
| **Sum** | **10** | **100%** |

---

## Repository layout

```text
src/DeepFunding.sol            pot + dispute window + Merkle claims + CEI + ReentrancyGuard
test/
  DeepFunding.t.sol            unit, fuzz, reentrancy, CEI-ordering tests
  DeepFundingInvariant.t.sol   invariant: contract balance >= unclaimed allocations
script/Deploy.s.sol            Sepolia deploy: 0.01 ETH pot, jurors [JUROR_ADDRESS, deployer]
data/
  graph.json                   sample dependency graph with cycle
  judgments.json               3 EIP-712 signed comparisons
  allocations.json            BigInt allocations + exact sum assertion
  trace.json                  per-node parent, weights, formula (UI explanation)
  merkle.json                 root, 7 leaves, proofs
scripts/
  types.ts                    shared strict types
  eip712.ts                   domain + typehash definitions
  compute-weights.ts          signature verification, weights, cycle-safe DFS, pot split
  build-merkle.ts             StandardMerkleTree + exact sum assertion
  verify-merkle.ts            verifies all proofs
  sign-judgment.ts            test-only signer (key from env)
  make-sample-judgments.ts    regenerates judgments (key from env)
  data.test.ts                node:test cycle/sum/proof/signature checks
  source-scan.mjs             rejects Number(), parseFloat(), 1e18
ui/
  src/abi.ts                  contract ABI used by wagmi
  src/components/             DependencyGraph, WhyPanel, DisputePanel, ClaimPanel
deployments/sepolia.json      public deployment record (no secrets)
foundry.toml                  solc 0.8.24, cancun, fs_permissions read-write "./"
```

---

## Tests

```powershell
forge test -vv
npm test
```

`test/DeepFunding.t.sol` covers:

| Test | Property |
| --- | --- |
| `test_ProposeResult_OnlyOperator` | proposal is operator-gated |
| `test_Claim_HappyPath` | valid proof pays exactly once |
| `test_Claim_InvalidProofReverts` | bad proof reverts |
| `test_Claim_OnlyOnce` | double claim reverts |
| `test_FinalizeBeforeWindowReverts` | window is enforced |
| `test_OpenDisputeBlocksFinalize` | open dispute blocks finalization |
| `test_DisputeAfterWindowReverts` | late dispute reverts |
| `test_NonJurorDisputeReverts` | only registered jurors |
| `test_ResolveDisputeAccepted_AllowsReproposal` | accepted dispute resets the root |
| `test_FinalizedRootIsImmutable` | root and juror set frozen after finalize |
| `test_ReentrancyOnClaim` | reentrant recipient cannot drain |
| `test_ClaimedMarkerSetBeforeTransfer` | CEI ordering |
| `testFuzz_InvalidProofAlwaysReverts` | 256 runs |

`test/DeepFundingInvariant.t.sol` asserts `totalClaimed <= totalPot` and
`contractBalance + totalClaimed == totalPot` across randomized claims.

---

## Deploying

### Environment

`.env` at the repo root (gitignored). `.env.example` documents the keys.

| Variable | Required | Notes |
| --- | --- | --- |
| `PRIVATE_KEY` | yes | Funded deployer; becomes `operator` |
| `SEPOLIA_RPC_URL` | yes | Any Sepolia endpoint |
| `JUROR_ADDRESS` | yes | **20-byte address**, not a key |
| `TEST_JUROR_PRIVATE_KEY` | test only | Only for regenerating sample judgments |

`.env` is untracked; `deployments/sepolia.json` contains public chain data only.

### Deploy

```powershell
# 1. Load .env into the process (never echo PRIVATE_KEY).
Get-Content .env | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { Set-Item -Path "Env:$($matches[1])" -Value $matches[2].Trim() }
}

# 2. Rebuild artifacts and the data set.
forge clean; forge build
npm run compute -- --pot 10
npm run merkle -- 10

# 3. Broadcast. See "Gas" below for why the multiplier is required.
forge script script/Deploy.s.sol:Deploy --rpc-url $env:SEPOLIA_RPC_URL `
  --broadcast --gas-estimate-multiplier 900

# 4. Prove bytecode exists before trusting the JSON record.
$contract = (Get-Content deployments/sepolia.json | ConvertFrom-Json).contract
cast code $contract --rpc-url $env:SEPOLIA_RPC_URL      # must start 0x6080, never 0x

# 5. Propose the committed root.
$root = (Get-Content data/merkle.json | ConvertFrom-Json).root
cast send $contract "proposeResult(bytes32)" $root `
  --rpc-url $env:SEPOLIA_RPC_URL --private-key $env:PRIVATE_KEY

# 6. Read back.
cast call $contract "merkleRoot()(bytes32)" --rpc-url $env:SEPOLIA_RPC_URL
```

### Gas

Sepolia's execution gas for **contract creation** is far above the local revm estimate used by
`forge script` (measured ~4x for an empty contract, ~6.7x for `DeepFunding`). A plain transfer still
costs 21,000, but deploying an empty contract costs ~210,000 and the full `DeepFunding` init code
costs ~5.4M. The default `--gas-estimate-multiplier 130` therefore OOGs, and `--gas-limit` is only
an alias for `--block-gas-limit` (simulation), so it does not help. Use `--gas-estimate-multiplier
900`.

### `vm.writeJson` behavior

`foundry.toml` grants:

```toml
fs_permissions = [{ access = "read-write", path = "./" }]
```

`script/Deploy.s.sol` writes `deployments/sepolia.json` **after broadcasting** — but Foundry runs
the script body even when the broadcast fails, so the file can contain a predicted address that was
never deployed. Always confirm with `cast code` before committing the record.

---

## Operations runbook

```powershell
$c = "0xc02f9570f0B7DAB6B12B7ba6d453e5e302A4ec22"
$rpc = $env:SEPOLIA_RPC_URL
```

**Propose** (operator):

```powershell
cast send $c "proposeResult(bytes32)" (Get-Content data/merkle.json | ConvertFrom-Json).root `
  --rpc-url $rpc --private-key $env:PRIVATE_KEY
```

**Dispute** (registered juror, within 48h):

```powershell
cast send $c "dispute(string)" "root does not match published trace" `
  --rpc-url $rpc --private-key $env:TEST_JUROR_PRIVATE_KEY
```

**Resolve** (operator): `true` rejects the root and allows a new proposal; `false` keeps it.

```powershell
cast send $c "resolveDispute(bool)" true --rpc-url $rpc --private-key $env:PRIVATE_KEY
```

**Finalize** (anyone, after the window, no open dispute):

```powershell
cast send $c "finalize()" --rpc-url $rpc --private-key $env:PRIVATE_KEY
```

**Claim** (recipient):

```powershell
# amount + proof come from data/merkle.json for your address
cast send $c "claim(uint256,bytes32[])" <amount> "[<proof0>,<proof1>,...]" `
  --rpc-url $rpc --private-key $env:RECIPIENT_PRIVATE_KEY
```

**Inspect state**:

```powershell
cast call $c "merkleRoot()(bytes32)"        --rpc-url $rpc
cast call $c "proposedAt()(uint256)"        --rpc-url $rpc
cast call $c "finalized()(bool)"            --rpc-url $rpc
cast call $c "hasOpenDispute()(bool)"       --rpc-url $rpc
cast call $c "totalPot()(uint256)"          --rpc-url $rpc
cast call $c "jurors(address)(bool)" $env:JUROR_ADDRESS --rpc-url $rpc
```

---

## Frontend

```powershell
Copy-Item ui/.env.example ui/.env.local
# VITE_CONTRACT_ADDRESS=0xc02f9570f0B7DAB6B12B7ba6d453e5e302A4ec22
npm run ui:dev
npm run build      # -> dist-ui/
```

The graph and the "Why did I get this much?" panel are read-only and need no wallet. Dispute and
claim panels use an injected wallet and enforce Sepolia (`11155111`). Claim success is shown only
when `receipt.status === "success"`. Amounts use `formatEther` and BigInt percentage math.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `cast code` returns `0x` | Address was never deployed (predicted address written by a failed broadcast) | Re-broadcast and verify `0x6080…` |
| `Transaction Failure` with `gasUsed == gasLimit` | Creation OOG from the low local estimate | `--gas-estimate-multiplier 900` |
| `WrongChain(1)` / `WrongChain(...)` | RPC is not Sepolia | Point `SEPOLIA_RPC_URL` at chain `11155111` |
| `vm.envAddress: failed parsing as address` | `JUROR_ADDRESS` holds a key instead of an address | Set the 20-byte juror address |
| `AlreadyProposed` | A root is already live | `resolveDispute(true)` resets it, or finalize the existing root |
| `WindowNotClosed` | `finalize()` before `proposedAt + 48h` | Wait out the window |
| `OpenDispute` | A juror dispute is unresolved | Operator calls `resolveDispute` |
| `NotJuror` | Disputer is not registered | `addJuror` (operator, pre-finalization) |
| `InvalidProof` | Leaf built with single hashing or wrong amount | Rebuild from `data/merkle.json` with the double-hashed leaf |
| `fs_permissions` denial on `vm.writeJson` | Path not granted | `fs_permissions = [{ access = "read-write", path = "./" }]` |

---

## Security model and limits

- **Unaudited.** Testnet-only demonstration.
- The operator is trusted to propose a correct root and to resolve disputes; the 48-hour window is
  the social backstop. Juror registration is operator-controlled.
- `claim` is `nonReentrant`, follows checks-effects-interactions, and reverts the whole claim if the
  ETH transfer fails. Recipients with reverting fallbacks cannot claim.
- `resolveDispute(true)` clears the root, so the operator can re-propose; it cannot alter an
  already-finalized root.
- The EIP-712 signer in `scripts/` is test-only. Production should use hardware wallets and bind the
  domain to a deployed verifier.
- No private keys, mnemonics, RPC credentials, or funded accounts are committed. `npm run
  source-scan` and the credential grep below enforce this.

### Credential check

```powershell
git ls-files | Select-String -Pattern '(^|/)\.env$'
git grep -nEi '(private|secret|mnemonic|passphrase|api.?key).{0,30}0x[0-9a-fA-F]{64}' -- .
git grep -nEi 'infura\.io/v3/|alchemy\.com/v2/|api[_-]?key=|apikey=' -- .
```

Expected: only `.env.example` / `ui/.env.example` are tracked, and no assignments or provider keys
match.

---

## Conventions

- **BigInt only** for money. `source-scan.mjs` fails the build on `Number()`, `parseFloat()`, or
  `1e18` in `scripts/` and `ui/src/`.
- Allocation math asserts `sum == pot` exactly; the rounding remainder goes to the last child.
- Leaf encoding must stay in sync between `build-merkle.ts` and `DeepFunding.claim`.
- Commits: `contract:`, `offchain:`, `ui:`, `deploy:`, `docs:` prefixes.

## Push

```powershell
git remote add origin https://github.com/pratikshakalbhor/devcon11-ps3-pay-the-wells.git
git push -u origin main
```
