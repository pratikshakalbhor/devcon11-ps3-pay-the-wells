/**
 * Jury-weighted dependency allocation.
 *
 * Pipeline: graph + EIP-712 judgments -> Bradley-Terry weights -> recursive
 * pot allocation. All money is BigInt wei; this file contains no float math.
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatEther,
  getAddress,
  isAddress,
  parseEther,
  verifyTypedData,
} from "viem";
import type { Address } from "viem";
import {
  JUDGMENT_DOMAIN,
  JUDGMENT_TYPES,
  judgmentMessage,
} from "./eip712.js";
import type {
  AllocationEntry,
  AllocationFile,
  Graph,
  GraphEdge,
  GraphNode,
  Judgment,
  Preference,
  TraceContribution,
  TraceEntry,
  TraceFile,
  TraceSibling,
} from "./types.js";

const WAD = 1_000_000_000_000_000_000n;
const BPS_DENOMINATOR = 10_000n;
const MAX_DEPTH = 100;

interface WeightResult {
  weights: Map<string, bigint>;
  scores: Map<string, bigint>;
}

interface Cli {
  graph: string;
  judgments: string;
  out: string;
  trace: string;
  potEth: string;
  keepBps: bigint;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function parseCli(): Cli {
  const keepRaw = arg("keep-bps") ?? "5000";
  if (!/^\d+$/.test(keepRaw)) {
    throw new Error(`--keep-bps must be an integer, got "${keepRaw}"`);
  }
  const keepBps = BigInt(keepRaw);
  if (keepBps < 0n || keepBps > BPS_DENOMINATOR) {
    throw new Error(`--keep-bps must be between 0 and ${BPS_DENOMINATOR}`);
  }
  const potEth = arg("pot") ?? "10";
  if (!/^\d+(\.\d+)?$/.test(potEth)) {
    throw new Error(`--pot must be a decimal ETH amount, got "${potEth}"`);
  }
  return {
    graph: arg("graph") ?? "data/graph.json",
    judgments: arg("judgments") ?? "data/judgments.json",
    out: arg("out") ?? "data/allocations.json",
    trace: arg("trace") ?? "data/trace.json",
    potEth,
    keepBps,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseGraph(raw: unknown): Graph {
  if (!isRecord(raw)) throw new Error("graph.json must be an object");
  if (!Array.isArray(raw["nodes"])) throw new Error("graph.nodes must be an array");
  if (!Array.isArray(raw["edges"])) throw new Error("graph.edges must be an array");

  const nodes: GraphNode[] = raw["nodes"].map((value, index) => {
    if (!isRecord(value)) throw new Error(`graph.nodes[${index}] must be an object`);
    const id = value["id"];
    const name = value["name"];
    const recipient = value["recipient"];
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`graph.nodes[${index}].id must be a non-empty string`);
    }
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`graph.nodes[${index}].name must be a non-empty string`);
    }
    if (typeof recipient !== "string" || !isAddress(recipient)) {
      throw new Error(`graph.nodes[${index}].recipient must be an address`);
    }
    return { id, name, recipient: getAddress(recipient) };
  });

  const edges: GraphEdge[] = raw["edges"].map((value, index) => {
    if (!isRecord(value)) throw new Error(`graph.edges[${index}] must be an object`);
    const from = value["from"];
    const to = value["to"];
    if (typeof from !== "string" || typeof to !== "string") {
      throw new Error(`graph.edges[${index}] must have string from/to`);
    }
    return { from, to };
  });

  const ids = new Set<string>();
  const recipients = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) throw new Error(`Duplicate node id: ${node.id}`);
    if (recipients.has(node.recipient.toLowerCase())) {
      throw new Error(`Duplicate recipient: ${node.recipient}`);
    }
    ids.add(node.id);
    recipients.add(node.recipient.toLowerCase());
  }
  for (const edge of edges) {
    if (!ids.has(edge.from)) throw new Error(`Edge from unknown node: ${edge.from}`);
    if (!ids.has(edge.to)) throw new Error(`Edge to unknown node: ${edge.to}`);
    if (edge.from === edge.to) throw new Error(`Self edge is not supported: ${edge.from}`);
  }
  if (nodes.length === 0) throw new Error("Graph must contain at least one node");
  return { nodes, edges };
}

function parseJudgments(raw: unknown, nodeIds: Set<string>): Judgment[] {
  if (!Array.isArray(raw)) throw new Error("judgments.json must be an array");
  return raw.map((value, index) => {
    if (!isRecord(value)) throw new Error(`judgments[${index}] must be an object`);
    const jurorId = value["jurorId"];
    const packageA = value["packageA"];
    const packageB = value["packageB"];
    const preferred = value["preferred"];
    const signature = value["signature"];
    if (typeof jurorId !== "string" || !isAddress(jurorId)) {
      throw new Error(`judgments[${index}].jurorId must be an address`);
    }
    if (typeof packageA !== "string" || !nodeIds.has(packageA)) {
      throw new Error(`judgments[${index}].packageA is not a graph node`);
    }
    if (typeof packageB !== "string" || !nodeIds.has(packageB)) {
      throw new Error(`judgments[${index}].packageB is not a graph node`);
    }
    if (
      preferred !== "A" &&
      preferred !== "B" &&
      preferred !== "equal"
    ) {
      throw new Error(`judgments[${index}].preferred must be A, B, or equal`);
    }
    if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      throw new Error(`judgments[${index}].signature must be a 65-byte hex signature`);
    }
    return {
      jurorId: getAddress(jurorId),
      packageA,
      packageB,
      preferred: preferred as Preference,
      signature: signature as `0x${string}`,
    };
  });
}

async function verifyJudgments(judgments: Judgment[]): Promise<void> {
  for (const [index, judgment] of judgments.entries()) {
    const valid = await verifyTypedData({
      address: judgment.jurorId as Address,
      domain: JUDGMENT_DOMAIN,
      types: JUDGMENT_TYPES,
      primaryType: "Judgment",
      message: judgmentMessage(
        judgment.packageA,
        judgment.packageB,
        judgment.preferred,
      ),
      signature: judgment.signature,
    });
    if (!valid) {
      throw new Error(
        `Judgment ${index} signature does not recover to ${judgment.jurorId}`,
      );
    }
  }
}

function buildChildren(graph: Graph): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const node of graph.nodes) children.set(node.id, []);
  for (const edge of graph.edges) {
    const list = children.get(edge.from);
    if (list === undefined) throw new Error(`Unknown edge source: ${edge.from}`);
    if (!list.includes(edge.to)) list.push(edge.to);
  }
  return children;
}

function computeWeights(
  judgments: Judgment[],
  children: string[],
): WeightResult {
  const scores = new Map<string, bigint>();
  for (const child of children) scores.set(child, 0n);

  for (let i = 0; i < children.length; i += 1) {
    const a = children[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < children.length; j += 1) {
      const b = children[j];
      if (b === undefined) continue;
      const relevant: Judgment[] = judgments.filter(
        (judgment) =>
          (judgment.packageA === a && judgment.packageB === b) ||
          (judgment.packageA === b && judgment.packageB === a),
      );
      if (relevant.length === 0) {
        // No signal for this pair: treat it as an equal comparison.
        scores.set(a, (scores.get(a) ?? 0n) + WAD / 2n);
        scores.set(b, (scores.get(b) ?? 0n) + WAD / 2n);
        continue;
      }
      for (const judgment of relevant) {
        if (judgment.preferred === "equal") {
          scores.set(a, (scores.get(a) ?? 0n) + WAD / 2n);
          scores.set(b, (scores.get(b) ?? 0n) + WAD / 2n);
          continue;
        }
        const winner: string =
          judgment.preferred === "A" ? judgment.packageA : judgment.packageB;
        if (winner === a) {
          scores.set(a, (scores.get(a) ?? 0n) + WAD);
        } else if (winner === b) {
          scores.set(b, (scores.get(b) ?? 0n) + WAD);
        } else {
          throw new Error(`Judgment winner ${winner} is not in pair ${a}/${b}`);
        }
      }
    }
  }

  let total = 0n;
  for (const score of scores.values()) total += score;

  const weights = new Map<string, bigint>();
  if (total === 0n) {
    const base = WAD / BigInt(children.length);
    let assigned = 0n;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child === undefined) continue;
      const isLast = i === children.length - 1;
      const weight = isLast ? WAD - assigned : base;
      weights.set(child, weight);
      assigned += weight;
    }
  } else {
    let assigned = 0n;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child === undefined) continue;
      const score = scores.get(child) ?? 0n;
      const isLast = i === children.length - 1;
      const weight = isLast
        ? WAD - assigned
        : (score * WAD) / total;
      weights.set(child, weight);
      assigned += weight;
    }
  }

  return { weights, scores };
}

function splitByWeights(
  amount: bigint,
  children: string[],
  weights: Map<string, bigint>,
): Map<string, bigint> {
  const shares = new Map<string, bigint>();
  if (children.length === 0) return shares;
  let assigned = 0n;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child === undefined) continue;
    const isLast = i === children.length - 1;
    const weight = weights.get(child);
    if (weight === undefined) throw new Error(`Missing weight for ${child}`);
    const share = isLast ? amount - assigned : (amount * weight) / WAD;
    shares.set(child, share);
    assigned += share;
  }
  if (assigned !== amount) {
    throw new Error(`Internal split mismatch: ${assigned} != ${amount}`);
  }
  return shares;
}

function formatWad(value: bigint): string {
  const whole = value / WAD;
  const fraction = (value % WAD).toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${fraction}`;
}

function depthGuard(depth: number, nodeId: string): void {
  if (depth > MAX_DEPTH) {
    throw new Error(
      `Traversal depth ${depth} exceeded MAX_DEPTH ${MAX_DEPTH} at node ${nodeId}`,
    );
  }
}

async function main(): Promise<void> {
  const cli = parseCli();
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..");
  const graphPath = resolve(repoRoot, cli.graph);
  const judgmentsPath = resolve(repoRoot, cli.judgments);

  const graph = parseGraph(
    JSON.parse(readFileSync(graphPath, "utf8")) as unknown,
  );
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const judgments = parseJudgments(
    JSON.parse(readFileSync(judgmentsPath, "utf8")) as unknown,
    nodeIds,
  );
  await verifyJudgments(judgments);

  const childrenMap = buildChildren(graph);
  const indegree = new Map<string, number>();
  for (const node of graph.nodes) indegree.set(node.id, 0);
  for (const edge of graph.edges) {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }
  const roots = graph.nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  if (roots.length === 0) {
    throw new Error("Graph has no root (every node has an incoming edge)");
  }

  const weightsByParent = new Map<string, WeightResult>();
  for (const node of graph.nodes) {
    const children = childrenMap.get(node.id) ?? [];
    if (children.length > 0) {
      weightsByParent.set(
        node.id,
        computeWeights(judgments, children),
      );
    }
  }

  const pot = parseEther(cli.potEth);
  if (pot <= 0n) throw new Error("Pot must be greater than zero");

  const allocations = new Map<string, bigint>();
  const received = new Map<string, bigint>();
  const kept = new Map<string, bigint>();
  const passed = new Map<string, bigint>();
  const contributions = new Map<string, TraceContribution[]>();
  const primaryParent = new Map<string, string | null>();
  const visited = new Set<string>();

  for (const node of graph.nodes) {
    allocations.set(node.id, 0n);
    received.set(node.id, 0n);
    kept.set(node.id, 0n);
    passed.set(node.id, 0n);
    contributions.set(node.id, []);
  }

  const visit = (nodeId: string, amount: bigint, parentId: string | null, depth: number): void => {
    depthGuard(depth, nodeId);
    received.set(nodeId, (received.get(nodeId) ?? 0n) + amount);
    const list = contributions.get(nodeId);
    if (list === undefined) throw new Error(`Unknown node: ${nodeId}`);
    list.push({ parentId, amountWei: amount.toString() });

    if (visited.has(nodeId)) {
      // Cycle detected: allocate the incoming share, but do not re-enter.
      allocations.set(nodeId, (allocations.get(nodeId) ?? 0n) + amount);
      kept.set(nodeId, (kept.get(nodeId) ?? 0n) + amount);
      return;
    }
    visited.add(nodeId);
    primaryParent.set(nodeId, parentId);

    const children = childrenMap.get(nodeId) ?? [];
    let passAmount = 0n;
    if (children.length > 0 && amount > 0n) {
      passAmount = (amount * (BPS_DENOMINATOR - cli.keepBps)) / BPS_DENOMINATOR;
    }
    const keptAmount = amount - passAmount;
    allocations.set(nodeId, (allocations.get(nodeId) ?? 0n) + keptAmount);
    kept.set(nodeId, (kept.get(nodeId) ?? 0n) + keptAmount);
    passed.set(nodeId, (passed.get(nodeId) ?? 0n) + passAmount);

    if (passAmount === 0n) return;
    const result = weightsByParent.get(nodeId);
    if (result === undefined) {
      throw new Error(`Missing weight result for parent ${nodeId}`);
    }
    const shares = splitByWeights(passAmount, children, result.weights);
    for (const child of children) {
      const share = shares.get(child);
      if (share === undefined) throw new Error(`Missing share for ${child}`);
      visit(child, share, nodeId, depth + 1);
    }
  };

  if (roots.length === 1) {
    const root = roots[0];
    if (root === undefined) throw new Error("Missing root");
    visit(root, pot, null, 0);
  } else {
    const base = pot / BigInt(roots.length);
    let assigned = 0n;
    for (let i = 0; i < roots.length; i += 1) {
      const root = roots[i];
      if (root === undefined) continue;
      const isLast = i === roots.length - 1;
      const amount = isLast ? pot - assigned : base;
      assigned += amount;
      visit(root, amount, null, 0);
    }
  }

  let assertedSum = 0n;
  for (const amount of allocations.values()) assertedSum += amount;
  if (assertedSum !== pot) {
    const discrepancy = assertedSum > pot ? assertedSum - pot : pot - assertedSum;
    throw new Error(
      `Allocation sum mismatch: asserted ${assertedSum} wei vs pot ${pot} wei (discrepancy ${discrepancy} wei)`,
    );
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const allocationEntries: AllocationEntry[] = graph.nodes.map((node) => {
    const amount = allocations.get(node.id);
    if (amount === undefined) throw new Error(`Missing allocation for ${node.id}`);
    return {
      nodeId: node.id,
      recipient: node.recipient,
      allocationWei: amount.toString(),
    };
  });

  const traceEntries: TraceEntry[] = graph.nodes.map((node) => {
    const parentId = primaryParent.get(node.id) ?? null;
    const parentAllocation =
      parentId === null ? null : (allocations.get(parentId) ?? 0n);
    const weightResult =
      parentId === null ? undefined : weightsByParent.get(parentId);
    const siblings: TraceSibling[] =
      parentId === null || weightResult === undefined
        ? []
        : (childrenMap.get(parentId) ?? []).map((siblingId) => ({
            nodeId: siblingId,
            winsWad: (weightResult.scores.get(siblingId) ?? 0n).toString(),
            weightWad: (weightResult.weights.get(siblingId) ?? 0n).toString(),
          }));
    const receivedWei = received.get(node.id) ?? 0n;
    const passedWei = passed.get(node.id) ?? 0n;
    const allocationWei = allocations.get(node.id) ?? 0n;
    const siblingText =
      siblings.length === 0
        ? "no siblings"
        : siblings
            .map((sibling) => `${sibling.nodeId}=${formatWad(BigInt(sibling.weightWad))}`)
            .join(", ");
    const formula =
      parentId === null
        ? `root receives ${formatEther(receivedWei)} ETH; keeps ${formatEther(allocationWei)} ETH and passes ${formatEther(passedWei)} ETH to dependencies by weight [${siblingText}]`
        : `receives ${formatEther(receivedWei)} ETH from ${parentId}; keepFraction=${formatWad(cli.keepBps * (WAD / BPS_DENOMINATOR))}; keeps ${formatEther(allocationWei)} ETH; passes ${formatEther(passedWei)} ETH; sibling weights [${siblingText}]`;
    return {
      nodeId: node.id,
      parentId,
      parentAllocationWei: parentAllocation === null ? null : parentAllocation.toString(),
      receivedWei: receivedWei.toString(),
      keptWei: (kept.get(node.id) ?? 0n).toString(),
      passedWei: passedWei.toString(),
      allocationWei: allocationWei.toString(),
      keepBps: cli.keepBps.toString(),
      contributions: contributions.get(node.id) ?? [],
      siblings,
      formula,
    };
  });

  const allocationFile: AllocationFile = {
    totalPot: pot.toString(),
    assertedSum: assertedSum.toString(),
    potMatches: true,
    keepBps: cli.keepBps.toString(),
    allocations: allocationEntries,
  };
  const traceFile: TraceFile = {
    totalPot: pot.toString(),
    keepBps: cli.keepBps.toString(),
    roots,
    entries: traceEntries,
  };

  mkdirSync(dirname(resolve(repoRoot, cli.out)), { recursive: true });
  writeFileSync(
    resolve(repoRoot, cli.out),
    `${JSON.stringify(allocationFile, null, 2)}\n`,
    "utf8",
  );
  mkdirSync(dirname(resolve(repoRoot, cli.trace)), { recursive: true });
  writeFileSync(
    resolve(repoRoot, cli.trace),
    `${JSON.stringify(traceFile, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(`Verified ${judgments.length} EIP-712 jury judgments\n`);
  process.stdout.write(`Roots: ${roots.join(", ")}\n`);
  for (const entry of allocationEntries) {
    const node = nodeById.get(entry.nodeId);
    process.stdout.write(
      `${entry.nodeId.padEnd(16)} ${formatEther(BigInt(entry.allocationWei)).padStart(
        20,
      )} ETH  ${node?.recipient ?? ""}\n`,
    );
  }
  process.stdout.write(
    `Allocation sum ${assertedSum.toString()} wei == pot ${pot.toString()} wei (potMatches=true)\n`,
  );
  process.stdout.write(`Wrote ${cli.out} and ${cli.trace}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`compute-weights: ${message}\n`);
  process.exitCode = 1;
});
