import { useState } from "react";
import { allocationByNode, judgments, nodeById, totalPot, traceByNode } from "../data";
import {
  formatBps,
  formatEth,
  formatPercent,
  formatWad,
  shortAddress,
  shortHash,
} from "../format";

const WAD = 1_000_000_000_000_000_000n;

export interface WhyPanelProps {
  nodeId: string;
}

export function WhyPanel({ nodeId }: WhyPanelProps) {
  const [showDetails, setShowDetails] = useState(false);

  const node = nodeById.get(nodeId);
  const entry = traceByNode.get(nodeId);
  if (node === undefined || entry === undefined) {
    return <p>No allocation data for {nodeId}.</p>;
  }

  const allocation = allocationByNode.get(nodeId) ?? 0n;
  const parent = entry.parentId === null ? undefined : nodeById.get(entry.parentId);
  const parentAllocation =
    entry.parentAllocationWei === null ? null : BigInt(entry.parentAllocationWei);
  const siblingIds = new Set(entry.siblings.map((sibling) => sibling.nodeId));
  const relevantJudgments = judgments.filter(
    (judgment) => siblingIds.has(judgment.packageA) && siblingIds.has(judgment.packageB),
  );

  return (
    <div className="why-panel">
      {/* Header */}
      <div className="why-heading">
        <div>
          <p className="eyebrow">Allocation breakdown</p>
          <h2>{node.name}</h2>
          <p className="mono muted">{node.recipient}</p>
        </div>
        <div className="allocation-badge">
          <strong>{formatEth(allocation)} ETH</strong>
          <span>{formatPercent(allocation, totalPot)} of pot</span>
        </div>
      </div>

      {/* Simple key facts — always visible */}
      <dl className="facts">
        <div>
          <dt>Parent</dt>
          <dd>{parent === undefined ? "Root (top-level)" : parent.name}</dd>
        </div>
        <div>
          <dt>Received from parent</dt>
          <dd>{parentAllocation === null ? "—" : `${formatEth(parentAllocation)} ETH`}</dd>
        </div>
        <div>
          <dt>Keeps</dt>
          <dd>{formatEth(BigInt(entry.receivedWei) - BigInt(entry.passedWei))} ETH ({formatBps(BigInt(entry.keepBps))})</dd>
        </div>
        <div>
          <dt>Passed to dependencies</dt>
          <dd>{formatEth(BigInt(entry.passedWei))} ETH</dd>
        </div>
        <div>
          <dt>Final allocation</dt>
          <dd style={{ color: "var(--accent-2)", fontWeight: 700 }}>{formatEth(allocation)} ETH</dd>
        </div>
        <div>
          <dt>Share of pot</dt>
          <dd>{formatPercent(allocation, totalPot)}</dd>
        </div>
      </dl>

      {/* Multiple contributions note */}
      {entry.contributions.length > 1 ? (
        <div className="contributions">
          <p className="muted small">
            ℹ️ This node is reachable from multiple parents — its total allocation sums contributions from each path.
          </p>
          <ul>
            {entry.contributions.map((contribution, index) => (
              <li key={`${entry.nodeId}-contribution-${index}`}>
                <span>{contribution.parentId ?? "root"}</span>
                <span className="mono">{formatEth(BigInt(contribution.amountWei))} ETH</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Collapsible technical details */}
      <button
        type="button"
        className="toggle-details"
        onClick={() => setShowDetails((v) => !v)}
      >
        {showDetails ? "▲ Hide technical details" : "▼ Show technical details"}
      </button>

      {showDetails && (
        <div className="technical-details">
          {/* Sibling weights */}
          <div className="scores">
            <h3>Sibling weights (Bradley-Terry)</h3>
            <p className="muted small">
              Each winning judgment adds 1, each equal adds 0.5. Scores are normalized to weights summing to 1.
            </p>
            {entry.siblings.length === 0 ? (
              <p className="muted small">No siblings — this node gets 100% of what its parent passes down.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Node</th>
                    <th>Wins (WAD)</th>
                    <th>Weight (WAD)</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.siblings.map((sibling) => (
                    <tr key={sibling.nodeId} className={sibling.nodeId === nodeId ? "selected-row" : ""}>
                      <td>{nodeById.get(sibling.nodeId)?.name ?? sibling.nodeId}</td>
                      <td className="mono">{formatWad(BigInt(sibling.winsWad))}</td>
                      <td className="mono">{formatWad(BigInt(sibling.weightWad))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Signed judgments */}
          <div className="judgments">
            <h3>Signed judgments for this sibling group</h3>
            {relevantJudgments.length === 0 ? (
              <p className="muted small">No direct judgments — equal weights were used.</p>
            ) : (
              <ul>
                {relevantJudgments.map((judgment, index) => (
                  <li key={`${judgment.signature}-${index}`}>
                    <span className="mono">
                      {judgment.packageA} vs {judgment.packageB}
                    </span>
                    <span className="preference">{judgment.preferred}</span>
                    <span className="mono muted">
                      {shortAddress(judgment.jurorId)} · {shortHash(judgment.signature)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Exact formula */}
          <div className="formula">
            <h3>Exact formula</h3>
            <p className="mono">{entry.formula}</p>
            <p className="muted small">
              All arithmetic uses BigInt wei. Weights are WAD values (1.0 = {WAD.toString()} wei units) from data/judgments.json. Full trace from data/trace.json.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
