import { useState, useEffect, type FormEvent } from "react";
import { useAccount, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import type { Hex } from "viem";
import { CONTRACT_ADDRESS, SEPOLIA_CHAIN_ID, deepFundingAbi } from "../abi";
import { errorMessage } from "../errors";

export function DisputePanel() {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { writeContractAsync, isPending: writing } = useWriteContract();
  const [reason, setReason] = useState("");
  const [hash, setHash] = useState<Hex | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [success, setSuccess] = useState(false);

  const { data: receipt } = useWaitForTransactionReceipt({ hash });

  const { data: isJuror } = useReadContract({
    address: CONTRACT_ADDRESS ?? undefined,
    abi: deepFundingAbi,
    functionName: "jurors",
    args: address === undefined ? undefined : [address],
    query: { enabled: CONTRACT_ADDRESS !== null && address !== undefined },
  });

  const { data: finalized } = useReadContract({
    address: CONTRACT_ADDRESS ?? undefined,
    abi: deepFundingAbi,
    functionName: "finalized",
    query: { enabled: CONTRACT_ADDRESS !== null },
  });

  const { data: hasOpenDispute } = useReadContract({
    address: CONTRACT_ADDRESS ?? undefined,
    abi: deepFundingAbi,
    functionName: "hasOpenDispute",
    query: { enabled: CONTRACT_ADDRESS !== null },
  });

  useEffect(() => {
    if (receipt?.status === "success") {
      setSuccess(true);
      setReason("");
    }
  }, [receipt]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(undefined);
    setSuccess(false);
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      setError("Enter a dispute reason.");
      return;
    }
    if (CONTRACT_ADDRESS === null) {
      setError("No contract address configured. Set VITE_CONTRACT_ADDRESS.");
      return;
    }
    if (chainId !== SEPOLIA_CHAIN_ID) {
      setError("Switch to Sepolia before disputing.");
      return;
    }
    try {
      const txHash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: deepFundingAbi,
        functionName: "dispute",
        args: [trimmed],
      });
      setHash(txHash);
    } catch (caught: unknown) {
      setError(errorMessage(caught));
    }
  };

  return (
    <section className="panel">
      <h2>Dispute result</h2>
      <p className="muted">
        Only registered jurors may dispute, and only during the 48-hour window. An open dispute
        blocks finalization until the operator resolves it.
      </p>

      {CONTRACT_ADDRESS === null ? (
        <p className="notice">No contract configured. Set VITE_CONTRACT_ADDRESS in ui/.env.local.</p>
      ) : finalized === true ? (
        <p className="notice">The result is finalized; the dispute window is over.</p>
      ) : (
        <>
          {hasOpenDispute === true ? (
            <p className="notice warn">A dispute is already open. Finalization is blocked.</p>
          ) : null}

          {!isConnected ? (
            <p className="notice">Connect a juror wallet to submit a dispute.</p>
          ) : chainId !== SEPOLIA_CHAIN_ID ? (
            <button
              type="button"
              className="secondary"
              disabled={switching}
              onClick={() => switchChain({ chainId: SEPOLIA_CHAIN_ID })}
            >
              {switching ? "Switching…" : "Switch to Sepolia"}
            </button>
          ) : isJuror !== true ? (
            <p className="notice warn">Connected wallet {address} is not a registered juror.</p>
          ) : (
            <form onSubmit={onSubmit} className="stack">
              <label htmlFor="dispute-reason">Reason</label>
              <textarea
                id="dispute-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Explain what is wrong with the proposed allocation"
                disabled={writing || hasOpenDispute === true}
              />
              <button
                type="submit"
                className="danger"
                disabled={writing || hasOpenDispute === true || reason.trim().length === 0}
              >
                {writing ? "Submitting…" : "Submit Dispute"}
              </button>
            </form>
          )}

          {hash !== undefined ? (
            <p className="mono small">
              tx {hash} · {receipt === undefined ? "pending" : receipt.status}
            </p>
          ) : null}
          {success ? <p className="notice success">Dispute recorded onchain.</p> : null}
          {error !== undefined ? <p className="notice error">{error}</p> : null}
        </>
      )}
    </section>
  );
}
