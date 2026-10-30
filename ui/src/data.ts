import graphJson from "../../data/graph.json";
import judgmentsJson from "../../data/judgments.json";
import allocationsJson from "../../data/allocations.json";
import merkleJson from "../../data/merkle.json";
import traceJson from "../../data/trace.json";
import type {
  AllocationFile,
  Graph,
  Judgment,
  MerkleFile,
  TraceFile,
} from "../../scripts/types";

export const graph = graphJson as unknown as Graph;
export const judgments = judgmentsJson as unknown as Judgment[];
export const allocations = allocationsJson as unknown as AllocationFile;
export const merkle = merkleJson as unknown as MerkleFile;
export const trace = traceJson as unknown as TraceFile;

export const allocationByNode = new Map(
  allocations.allocations.map((entry) => [entry.nodeId, BigInt(entry.allocationWei)] as const),
);
export const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));
export const traceByNode = new Map(trace.entries.map((entry) => [entry.nodeId, entry] as const));
export const totalPot = BigInt(allocations.totalPot);
