/**
 * Shared offchain types for the Pay the Wells pipeline.
 *
 * All monetary values are decimal strings containing wei. Nothing in this
 * codebase converts money to IEEE-754 floats.
 */

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export interface GraphNode {
  id: string;
  name: string;
  recipient: Address;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type Preference = "A" | "B" | "equal";

/** A juror's EIP-712 signed pairwise comparison. */
export interface Judgment {
  jurorId: string;
  packageA: string;
  packageB: string;
  preferred: Preference;
  signature: Hex;
}

export interface AllocationEntry {
  nodeId: string;
  recipient: Address;
  allocationWei: string;
}

export interface AllocationFile {
  totalPot: string;
  assertedSum: string;
  potMatches: true;
  keepBps: string;
  allocations: AllocationEntry[];
}

export interface TraceSibling {
  nodeId: string;
  winsWad: string;
  weightWad: string;
}

export interface TraceContribution {
  parentId: string | null;
  amountWei: string;
}

export interface TraceEntry {
  nodeId: string;
  parentId: string | null;
  parentAllocationWei: string | null;
  receivedWei: string;
  keptWei: string;
  passedWei: string;
  allocationWei: string;
  keepBps: string;
  contributions: TraceContribution[];
  siblings: TraceSibling[];
  formula: string;
}

export interface TraceFile {
  totalPot: string;
  keepBps: string;
  roots: string[];
  entries: TraceEntry[];
}

export interface MerkleLeaf {
  nodeId: string;
  recipient: Address;
  amount: string;
  proof: Hex[];
}

export interface MerkleFile {
  root: Hex;
  leafCount: number;
  totalPot: string;
  leaves: MerkleLeaf[];
}
