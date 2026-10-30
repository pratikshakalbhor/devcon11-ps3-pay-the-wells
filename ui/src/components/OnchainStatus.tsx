import { useEffect, useState } from "react";
import { useBalance, useReadContract } from "wagmi";
import { CONTRACT_ADDRESS, deepFundingAbi } from "../abi";
import { merkle } from "../data";
import { KNOWN_DEPLOYMENT, etherscanAddress, etherscanTx, isKnownDeployment } from "../deployment";
import { formatEth, shortAddress, shortHash } from "../format";
import { CopyButton } from "./CopyButton";

const DISPUTE_WINDOW_SECONDS = 48 * 60 * 60;
const ZERO_ROOT = "0x0000000000000000000000000000000000000000000000000000000000000000";
const REFETCH_MS = 15_000;

type BadgeTone = "ok" | "warn" | "bad" | "muted";
type StepState = "done" | "active" | "pending" | "blocked";

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!active) return;
    setNow(Math.floor(Date.now() / 1000));
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  return now;
}

function toUnixSeconds(value: bigint | undefined): number {
  return value === undefined ? 0 : parseInt(value.toString(), 10);
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${rest}s`;
  return `${minutes}m ${rest}s`;
}

interface Step {
  label: string;
  detail: string;
  state: StepState;
}

export function OnchainStatus() {
  const enabled = CONTRACT_ADDRESS !== null;

  const { data: onchainRoot, isPending: rootPending, isError: rootError } = useReadContract({
    address: CONTRACT_ADDRESS ?? undefined,
    abi: deepFundingAbi,
    functionName: "merkleRoot",
    query: { enabled, refetchInterval: REFETCH_MS },
  });

  const { data: proposedAt } = useReadContract({
    address: CONTRACT_ADDRESS ?? undefined,
    abi: deepFundingAbi,
    functionName: "proposedAt",
    query: { enabled, refetchInterval: REFETCH_MS },
  });

  const { data: finalized } = useReadContract({
    address: CONTRACT_ADDRESS ?? undefined,
    abi: deepFundingAbi,
    functionName: "finalized",
    query: { enabled, refetchInterval: REFETCH_MS },
  });

  const { data: hasOpenDispute } = useReadContract({
    address: CONTRACT_ADDRESS ?? undefined,
    abi: deepFundingAbi,
    functionName: "hasOpenDispute",
    query: { enabled, refetchInterval: REFETCH_MS },
  });

  const { data: totalPot } = useReadContract({
    address: CONTRACT_ADDRESS ?? undefined,
    abi: deepFundingAbi,
    functionName: "totalPot",
    query: { enabled, refetchInterval: REFETCH_MS },
  });

  const { data: balance } = useBalance({
    address: CONTRACT_ADDRESS ?? undefined,
    query: { enabled, refetchInterval: REFETCH_MS },
  });

  const proposedAtSeconds = toUnixSeconds(proposedAt);
  const windowEnd = proposedAtSeconds > 0 ? proposedAtSeconds + DISPUTE_WINDOW_SECONDS : 0;
  const hasProposal = onchainRoot !== undefined && onchainRoot.toLowerCase() !== ZERO_ROOT;
  const isFinalized = finalized === true;
  const disputeOpen = hasOpenDispute === true;
  const windowOpen = hasProposal && !isFinalized && windowEnd > Math.floor(Date.now() / 1000);

  const now = useNow(windowOpen);
  const remaining = windowEnd === 0 ? 0 : windowEnd - now;
  const elapsed =
    proposedAtSeconds === 0
      ? 0
      : Math.min(DISPUTE_WINDOW_SECONDS, Math.max(0, now - proposedAtSeconds));
  const progressPercent = isFinalized
    ? 100
    : Math.min(100, Math.max(0, (elapsed / DISPUTE_WINDOW_SECONDS) * 100));

  const contractBalance = balance?.value ?? 0n;
  const pot = totalPot ?? 0n;
  const claimed = pot > contractBalance ? pot - contractBalance : 0n;
  const allClaimed = isFinalized && contractBalance === 0n;

  const rootMatches =
    hasProposal && onchainRoot.toLowerCase() === merkle.root.toLowerCase();

  const stateLabel = rootPending
    ? "Loading"
    : !hasProposal
      ? "Not proposed"
      : isFinalized
        ? "Finalized"
        : disputeOpen
          ? "Dispute open"
          : remaining > 0
            ? "Dispute window open"
            : "Ready to finalize";

  const stateTone: BadgeTone = rootPending
    ? "muted"
    : !hasProposal
      ? "muted"
      : isFinalized
        ? "ok"
        : disputeOpen
          ? "bad"
          : remaining > 0
            ? "warn"
            : "ok";

  const countdownLabel = !hasProposal
    ? "Not proposed yet"
    : isFinalized
      ? "Closed — result finalized"
      : remaining > 0
        ? `${formatDuration(remaining)} left${disputeOpen ? " · dispute open" : ""}`
        : "Window closed — finalize() available";

  const steps: Step[] = [
    {
      label: "Deployed",
      detail:
        CONTRACT_ADDRESS === null ? "no address configured" : shortAddress(CONTRACT_ADDRESS),
      state: CONTRACT_ADDRESS === null ? "pending" : "done",
    },
    {
      label: "Root proposed",
      detail: hasProposal ? shortHash(onchainRoot) : "waiting for operator",
      state: hasProposal ? "done" : CONTRACT_ADDRESS === null ? "pending" : "active",
    },
    {
      label: "Dispute window",
      detail: disputeOpen
        ? "open dispute"
        : !hasProposal
          ? "48 hours after proposal"
          : remaining > 0
            ? `${formatDuration(remaining)} left`
            : "closed",
      state: disputeOpen
        ? "blocked"
        : !hasProposal
          ? "pending"
          : isFinalized || remaining <= 0
            ? "done"
            : "active",
    },
    {
      label: "Finalized",
      detail: isFinalized ? "root locked" : "after the window, no open dispute",
      state: isFinalized
        ? "done"
        : disputeOpen
          ? "blocked"
          : remaining <= 0 && hasProposal
            ? "active"
            : "pending",
    },
    {
      label: "Claims",
      detail: allClaimed
        ? "all claims paid"
        : isFinalized
          ? `${formatEth(claimed)} ETH claimed`
          : "recipients claim with proofs",
      state: allClaimed ? "done" : isFinalized ? "active" : "pending",
    },
  ];

  if (CONTRACT_ADDRESS === null) {
    return (
      <section className="card status-card" aria-labelledby="status-title">
        <div className="status-head">
          <div>
            <p className="eyebrow">Onchain state</p>
            <h2 id="status-title">Live contract status</h2>
          </div>
          <span className="badge badge-muted">Not configured</span>
        </div>
        <p className="notice">
          Set <span className="mono">VITE_CONTRACT_ADDRESS</span> in{" "}
          <span className="mono">ui/.env.local</span> to read the deployed contract.
        </p>
      </section>
    );
  }

  return (
    <section className="card status-card" aria-labelledby="status-title">
      <div className="status-head">
        <div>
          <p className="eyebrow">Onchain state</p>
          <h2 id="status-title">Live contract status</h2>
        </div>
        <span className={`badge badge-${stateTone}`} role="status" aria-live="polite">
          {stateLabel}
        </span>
      </div>

      {rootError ? (
        <p className="notice">
          Could not read Sepolia state. Check the RPC endpoint and reload.
        </p>
      ) : null}

      <div className="status-grid">
        <div className="status-item">
          <span>Pot</span>
          <strong>{formatEth(pot)} ETH</strong>
        </div>
        <div className="status-item">
          <span>Contract balance</span>
          <strong>{formatEth(contractBalance)} ETH</strong>
        </div>
        <div className="status-item">
          <span>Claimed</span>
          <strong>{formatEth(claimed)} ETH</strong>
        </div>
        <div className="status-item">
          <span>Leaves</span>
          <strong>{merkle.leafCount}</strong>
        </div>
      </div>

      <div className="status-block">
        <div className="status-row">
          <span className="muted small">Committed Merkle root</span>
          <span
            className={`badge badge-${
              rootPending ? "muted" : !hasProposal ? "muted" : rootMatches ? "ok" : "bad"
            }`}
          >
            {rootPending
              ? "checking…"
              : !hasProposal
                ? "not proposed"
                : rootMatches
                  ? "matches data/merkle.json"
                  : "differs from data/merkle.json"}
          </span>
        </div>
        <p className="mono status-hash">{onchainRoot ?? "—"}</p>
        <div className="links">
          <CopyButton value={onchainRoot ?? ""} label="Copy onchain root" />
          <CopyButton value={merkle.root} label="Copy local root" />
        </div>
      </div>

      <div className="status-block">
        <div className="status-row">
          <span className="muted small">Dispute window</span>
          <span className="small">{countdownLabel}</span>
        </div>
        <div
          className="countdown-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressPercent)}
          aria-label="Dispute window progress"
        >
          <div
            className={`countdown-fill ${disputeOpen ? "countdown-fill-blocked" : ""}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <ol className="stepper" aria-label="Settlement lifecycle">
        {steps.map((step) => (
          <li
            key={step.label}
            className={`step step-${step.state}`}
            aria-current={step.state === "active" ? "step" : undefined}
          >
            <strong>{step.label}</strong>
            <span>{step.detail}</span>
          </li>
        ))}
      </ol>

      <div className="links">
        <a href={etherscanAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">
          Contract on Etherscan ↗
        </a>
        {isKnownDeployment(CONTRACT_ADDRESS) ? (
          <>
            <a href={etherscanTx(KNOWN_DEPLOYMENT.deployTx)} target="_blank" rel="noreferrer">
              Deploy tx ↗
            </a>
            <a href={etherscanTx(KNOWN_DEPLOYMENT.proposeTx)} target="_blank" rel="noreferrer">
              proposeResult tx ↗
            </a>
          </>
        ) : null}
        <CopyButton value={CONTRACT_ADDRESS} label="Copy address" />
      </div>

      {isKnownDeployment(CONTRACT_ADDRESS) ? null : (
        <p className="muted small">
          Deploy and propose transaction links are hidden because the configured address does not
          match the recorded deployment.
        </p>
      )}
    </section>
  );
}
