import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { CONTRACT_ADDRESS, SEPOLIA_CHAIN_ID } from "./abi";
import { ClaimPanel } from "./components/ClaimPanel";
import { DependencyGraph } from "./components/DependencyGraph";
import { DisputePanel } from "./components/DisputePanel";
import { WhyPanel } from "./components/WhyPanel";
import { graph, merkle, totalPot } from "./data";
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
            Retro-funding for Kavya's Devcon event app, weighted by jury comparisons across a
            dependency graph. Claims are Merkle-based, the dispute window is 48 hours, and the
            traversal is cycle-safe.
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
            {CONTRACT_ADDRESS === null ? "not deployed" : shortAddress(CONTRACT_ADDRESS)}
          </strong>
        </div>
      </section>

      <main>
        <section className="card graph-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Dependency graph</p>
              <h2>Where the pot flows</h2>
            </div>
            <p className="muted small">
              Tap a node to see the exact allocation math. Dashed red edges are the
              <span className="mono"> qr-core ↔ i18n-base </span>
              cycle; the DFS visited-set stops re-entry.
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
          Offchain inputs: data/graph.json, data/judgments.json, data/allocations.json,
          data/merkle.json, data/trace.json. All amount arithmetic is BigInt wei; no floats.
        </p>
        <p className="muted small">
          Sample graph contains the deliberate cycle qr-core → i18n-base → qr-core. The
          offchain DFS records the first visit and skips re-entry while still allocating the
          incoming share, so the pot is conserved exactly.
        </p>
      </footer>
    </div>
  );
}
