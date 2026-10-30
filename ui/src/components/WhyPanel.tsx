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
      <div className="why-heading">
        <div>
          <p className="eyebrow">Why did I get this much?</p>
          <h2>{node.name}</h2>
          <p className="mono muted">{node.recipient}</p>
        </div>
        <div className="allocation-badge">
          <strong>{formatEth(allocation)} ETH</strong>
          <span>{formatPercent(allocation, totalPot)} of pot</span>
        </div>
      </div>

      <dl className="facts">
        <div>
          <dt>Parent</dt>
          <dd>{parent === undefined ? "root (no parent)" : parent.name}</dd>
        </div>
        <div>
          <dt>Parent allocation</dt>
          <dd>{parentAllocation === null ? "—" : `${formatEth(parentAllocation)} ETH`}</dd>
        </div>
        <div>
          <dt>Received</dt>
          <dd>{formatEth(BigInt(entry.receivedWei))} ETH</dd>
        </div>
        <div>
          <dt>Keep fraction</dt>
          <dd>{formatBps(BigInt(entry.keepBps))} ({entry.keepBps} bps)</dd>
        </div>
        <div>
          <dt>Passed to children</dt>
          <dd>{formatEth(BigInt(entry.passedWei))} ETH</dd>
        </div>
        <div>
          <dt>Your allocation</dt>
          <dd>{formatEth(allocation)} ETH</dd>
        </div>
      </dl>

      {entry.contributions.length > 1 ? (
        <div className="contributions">
          <h3>Incoming contributions</h3>
          <p className="muted">
            This node is reachable from more than one parent. The first parent is used for the
            weight explanation; a later visit adds its share without re-entering the subtree.
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

      <div className="scores">
        <h3>Sibling Bradley-Terry scores</h3>
        <p className="muted">
          Each winning judgment adds 1, each equal adds 0.5 to both. If a pair has no judgment,
          it contributes 0.5 to both. Scores are normalized to weights that sum to 1.
        </p>
        {entry.siblings.length === 0 ? (
          <p>No siblings: this node receives 100% of what its parent passes down.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Node</th>
                <th>Wins</th>
                <th>Weight</th>
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

      <div className="judgments">
        <h3>Signed judgments used for this sibling set</h3>
        {relevantJudgments.length === 0 ? (
          <p>No direct judgments for this sibling set; equal weights were used.</p>
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

      <div className="formula">
        <h3>Exact formula</h3>
        <p className="mono">{entry.formula}</p>
        <p className="muted">
          Recomputed with BigInt wei. Sibling weights are WAD values (1.0 ={" "}
          {WAD.toString()} wei-denominated weight units) derived from data/judgments.json.
          The full trace is bundled from data/trace.json.
        </p>
      </div>
    </div>
  );
}
