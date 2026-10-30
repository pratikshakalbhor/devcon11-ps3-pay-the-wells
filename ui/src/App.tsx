import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { CONTRACT_ADDRESS, SEPOLIA_CHAIN_ID } from "./abi";
import { ClaimPanel } from "./components/ClaimPanel";
import { DependencyGraph } from "./components/DependencyGraph";
import { DisputePanel } from "./components/DisputePanel";
import { OnchainStatus } from "./components/OnchainStatus";
import { WhyPanel } from "./components/WhyPanel";
import { graph, merkle, totalPot } from "./data";
import { etherscanAddress } from "./deployment";
import { formatEth, shortAddress, shortHash } from "./format";

function WalletBar() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const connector = connectors[0];

  if (!isConnected) {
    return (
      <button
        type="button"
        className="secondary"
        disabled={connector === undefined || isPending}
        onClick={() => {
          if (connector !== undefined) connect({ connector });
        }}
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  return (
    <div className="wallet">
      <span className="mono small">{shortAddress(address ?? "")}</span>
      {chainId !== SEPOLIA_CHAIN_ID ? (
        <button
          type="button"
          className="danger"
          disabled={switching}
          onClick={() => switchChain({ chainId: SEPOLIA_CHAIN_ID })}
        >
          {switching ? "Switching…" : "Switch to Sepolia"}
        </button>
      ) : (
        <span className="pill">Sepolia</span>
      )}
      <button type="button" className="ghost" onClick={() => disconnect()}>
        Disconnect
      </button>
    </div>
  );
}

export default function App() {
  const [selectedId, setSelectedId] = useState("event-app");

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Road to Devcon XI · Problem 3</p>
          <h1>Pay the Wells</h1>
          <p className="lede">
            Retro-funding for Kavya's Devcon event app. Each project in the dependency graph gets
            rewarded based on how the jury ranked it. Click a node to see exactly how its share was calculated.
          </p>
        </div>
        <WalletBar />
      </header>

      <section className="stats">
        <div>
          <span>Total pot</span>
          <strong>{formatEth(totalPot)} ETH</strong>
        </div>
        <div>
          <span>Merkle root</span>
          <strong className="mono">{shortHash(merkle.root)}</strong>
        </div>
        <div>
          <span>Leaves</span>
          <strong>{merkle.leafCount}</strong>
        </div>
        <div>
          <span>Contract</span>
          <strong className="mono">
            {CONTRACT_ADDRESS === null ? (
              "not deployed"
            ) : (
              <a href={etherscanAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">
                {shortAddress(CONTRACT_ADDRESS)} ↗
              </a>
            )}
          </strong>
        </div>
      </section>

      <OnchainStatus />

      <main>
        <section className="card graph-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Dependency graph</p>
              <h2>Where the pot flows</h2>
            </div>
            <p className="muted small">
              Tap any node to see how its allocation was calculated. Dashed red edges indicate a circular dependency.
            </p>
          </div>
          <DependencyGraph graph={graph} selectedId={selectedId} onSelect={setSelectedId} />
        </section>

        <section className="card">
          <WhyPanel nodeId={selectedId} />
        </section>

        <div className="panel-grid">
          <DisputePanel />
          <ClaimPanel />
        </div>
      </main>

      <footer>
        <p>
          Data sources: graph, judgments, allocations, merkle tree, and trace — all computed offchain and bundled with the app.
        </p>
      </footer>
    </div>
  );
}
