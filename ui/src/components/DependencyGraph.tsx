import type { KeyboardEvent } from "react";
import type { Graph } from "../../../scripts/types";
import { allocationByNode, nodeById, totalPot } from "../data";
import { formatEth, formatPercent, shortAddress } from "../format";

const NODE_WIDTH = 168;
const NODE_HEIGHT = 86;
const VIEW_WIDTH = 760;
const VIEW_HEIGHT = 486;

interface Point {
  x: number;
  y: number;
}

const FIXED_POSITIONS: Record<string, Point> = {
  "event-app": { x: 380, y: 18 },
  "qr-tickets": { x: 120, y: 138 },
  "hindi-i18n": { x: 380, y: 138 },
  "wallet-wrapper": { x: 640, y: 138 },
  "qr-core": { x: 120, y: 258 },
  "wallet-core": { x: 640, y: 258 },
  "i18n-base": { x: 380, y: 378 },
};

function fallbackPositions(graph: Graph): Map<string, Point> {
  const positions = new Map<string, Point>();
  const index = new Map(graph.nodes.map((node, i) => [node.id, i] as const));
  const slots = [120, 380, 640];
  graph.nodes.forEach((node, i) => {
    const slot = slots[i % slots.length] ?? 380;
    positions.set(node.id, { x: slot, y: 18 + (index.get(node.id) ?? 0) * 0 });
  });
  return positions;
}

function findCycleEdges(graph: Graph): Set<string> {
  const children = new Map<string, string[]>();
  for (const node of graph.nodes) children.set(node.id, []);
  for (const edge of graph.edges) {
    const list = children.get(edge.from);
    if (list !== undefined) list.push(edge.to);
  }
  const cycle = new Set<string>();
  const visit = (nodeId: string, path: Set<string>): void => {
    for (const child of children.get(nodeId) ?? []) {
      const key = `${nodeId}->${child}`;
      if (path.has(child)) {
        cycle.add(key);
      } else {
        path.add(child);
        visit(child, path);
        path.delete(child);
      }
    }
  };
  for (const node of graph.nodes) {
    visit(node.id, new Set([node.id]));
  }
  for (const edge of graph.edges) {
    const key = `${edge.from}->${edge.to}`;
    const reverse = `${edge.to}->${edge.from}`;
    if (cycle.has(reverse)) cycle.add(key);
  }
  return cycle;
}

function wrapName(name: string): string[] {
  const words = name.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length > 26 && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) lines.push(current);
  if (lines.length <= 2) return lines;
  return [lines[0] ?? "", `${(lines[1] ?? "").slice(0, 23)}…`];
}

function edgePath(from: Point, to: Point, isCycle: boolean): string {
  const x1 = from.x;
  const y1 = from.y + NODE_HEIGHT;
  const x2 = to.x;
  const y2 = to.y;
  if (isCycle) {
    return `M ${x1 + NODE_WIDTH / 2 - 8} ${y1 - 26} C 748 300, 748 ${y2 + 40}, ${x2 + NODE_WIDTH / 2 - 8} ${y2 + 26}`;
  }
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

export interface DependencyGraphProps {
  graph: Graph;
  selectedId: string;
  onSelect: (nodeId: string) => void;
}

export function DependencyGraph({ graph, selectedId, onSelect }: DependencyGraphProps) {
  const fallback = fallbackPositions(graph);
  const cycleEdges = findCycleEdges(graph);

  const position = (nodeId: string): Point => {
    const fixed = FIXED_POSITIONS[nodeId];
    if (fixed !== undefined) return fixed;
    return fallback.get(nodeId) ?? { x: 380, y: 200 };
  };

  const onKeyDown = (event: KeyboardEvent<SVGGElement>, nodeId: string): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(nodeId);
    }
  };

  return (
    <div className="graph-scroll">
      <svg
        className="graph-svg"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label="Dependency graph of the Devcon event app"
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#5b6478" />
          </marker>
          <marker
            id="arrow-cycle"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#e05d6f" />
          </marker>
        </defs>

        {graph.edges.map((edge) => {
          const from = position(edge.from);
          const to = position(edge.to);
          const key = `${edge.from}->${edge.to}`;
          const isCycle = cycleEdges.has(key);
          return (
            <path
              key={key}
              d={edgePath(from, to, isCycle)}
              className={isCycle ? "edge edge-cycle" : "edge"}
              markerEnd={isCycle ? "url(#arrow-cycle)" : "url(#arrow)"}
            >
              <title>
                {edge.from} depends on {edge.to}
                {isCycle ? " (cycle edge: traversal will not re-enter)" : ""}
              </title>
            </path>
          );
        })}

        {graph.nodes.map((node) => {
          const at = position(node.id);
          const allocation = allocationByNode.get(node.id) ?? 0n;
          const lines = wrapName(node.name);
          const selected = node.id === selectedId;
          return (
            <g
              key={node.id}
              className={selected ? "node node-selected" : "node"}
              transform={`translate(${at.x - NODE_WIDTH / 2}, ${at.y})`}
              onClick={() => onSelect(node.id)}
              onKeyDown={(event) => onKeyDown(event, node.id)}
              role="button"
              tabIndex={0}
              aria-label={`${node.name}: ${formatEth(allocation)} ETH, ${formatPercent(allocation, totalPot)} of pot`}
            >
              <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx={12} />
              {lines.map((line, index) => (
                <text key={`${node.id}-name-${index}`} x={NODE_WIDTH / 2} y={20 + index * 13} className="node-name">
                  {line}
                </text>
              ))}
              <text x={NODE_WIDTH / 2} y={55} className="node-amount">
                {formatEth(allocation)} ETH · {formatPercent(allocation, totalPot)}
              </text>
              <text x={NODE_WIDTH / 2} y={72} className="node-recipient">
                {shortAddress(node.recipient)}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="legend">
        <span className="legend-line" /> dependency flow
        <span className="legend-line legend-cycle" /> cycle edge (visited-set stops re-entry)
      </p>
    </div>
  );
}

export function selectedNodeName(nodeId: string): string {
  return nodeById.get(nodeId)?.name ?? nodeId;
}
