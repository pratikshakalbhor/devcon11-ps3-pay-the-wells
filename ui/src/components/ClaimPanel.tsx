import { useEffect, useState } from "react";
import { useAccount, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import type { Hex } from "viem";
import { CONTRACT_ADDRESS, SEPOLIA_CHAIN_ID, deepFundingAbi } from "../abi";
import { merkle } from "../data";
import { errorMessage } from "../errors";
import { formatEth } from "../format";

export function ClaimPanel() {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { writeContractAsync, isPending: writing } = useWriteContract();
  const [hash, setHash] = useState<Hex | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const { data: finalized } = useReadContract({
    address: CONTRACT_ADDRESS ?? undefined,
    abi: deepFundingAbi,
    functionName: "finalized",
    query: { enabled: CONTRACT_ADDRESS !== null },
  });

  const { data: claimed } = useReadContract({
    address: CONTRACT_ADDRESS ?? undefined,
    abi: deepFundingAbi,
    functionName: "claimed",
    args: address === undefined ? undefined : [address],
    query: { enabled: CONTRACT_ADDRESS !== null && address !== undefined },
  });

  const { data: receipt } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (receipt?.status === "reverted") {
      setError("Claim transaction reverted.");
    }
  }, [receipt]);

  const leaf =
    address === undefined
      ? undefined
      : merkle.leaves.find((item) => item.recipient.toLowerCase() === address.toLowerCase());

  const onClaim = async (): Promise<void> => {
    setError(undefined);
    if (CONTRACT_ADDRESS === null) {
      setError("No contract address configured. Set VITE_CONTRACT_ADDRESS.");
      return;
    }
    if (leaf === undefined) {
      setError("No Merkle leaf for the connected address.");
      return;
    }
    if (chainId !== SEPOLIA_CHAIN_ID) {
      setError("Switch to Sepolia before claiming.");
      return;
    }
    try {
      const txHash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: deepFundingAbi,
        functionName: "claim",
        args: [BigInt(leaf.amount), leaf.proof],
      });
      setHash(txHash);
    } catch (caught: unknown) {
      setError(errorMessage(caught));
    }
  };

  const claimState =
    receipt?.status === "success"
      ? "success"
      : receipt?.status === "reverted"
        ? "reverted"
        : hash !== undefined
          ? "pending"
          : "idle";

  return (
    <section className="panel">
      <h2>Claim allocation</h2>
      <p className="muted">
        The amount and proof are bundled from data/merkle.json. The contract checks the proof
        against the finalized onchain root and writes the claimed marker before transferring ETH.
      </p>

      {CONTRACT_ADDRESS === null ? (
        <p className="notice">No contract configured. Set VITE_CONTRACT_ADDRESS in ui/.env.local.</p>
      ) : !isConnected ? (
        <p className="notice">Connect a recipient wallet to check its allocation.</p>
      ) : chainId !== SEPOLIA_CHAIN_ID ? (
        <button
          type="button"
          className="secondary"
          disabled={switching}
          onClick={() => switchChain({ chainId: SEPOLIA_CHAIN_ID })}
        >
          {switching ? "Switching…" : "Switch to Sepolia"}
        </button>
      ) : (
        <>
          <dl className="facts compact">
            <div>
              <dt>Recipient</dt>
              <dd className="mono">{address}</dd>
            </div>
            <div>
              <dt>Bundled allocation</dt>
              <dd>{leaf === undefined ? "No leaf" : `${formatEth(BigInt(leaf.amount))} ETH`}</dd>
            </div>
            <div>
              <dt>Onchain claimed</dt>
              <dd>{claimed === undefined ? "…" : claimed ? "yes" : "no"}</dd>
            </div>
            <div>
              <dt>Finalized</dt>
              <dd>{finalized === undefined ? "…" : finalized ? "yes" : "no"}</dd>
            </div>
          </dl>

          {leaf === undefined ? (
            <p className="notice warn">The connected address is not a recipient in the Merkle tree.</p>
          ) : finalized !== true ? (
            <p className="notice">Waiting for the operator to finalize the result.</p>
          ) : claimed === true ? (
            <p className="notice success">This allocation has already been claimed.</p>
          ) : (
            <button type="button" onClick={onClaim} disabled={writing || claimState === "pending"}>
              {writing || claimState === "pending"
                ? "Claiming…"
                : `Claim ${formatEth(BigInt(leaf.amount))} ETH`}
            </button>
          )}

          {hash !== undefined ? (
            <p className="mono small">
              tx {hash} · {claimState}
            </p>
          ) : null}
          {claimState === "success" ? (
            <p className="notice success">Claim confirmed (receipt.status === success).</p>
          ) : null}
          {error !== undefined ? <p className="notice error">{error}</p> : null}
        </>
      )}
    </section>
  );
}
