/**
 * Build an OpenZeppelin StandardMerkleTree from data/allocations.json.
 * Leaf encoding: [address recipient, uint256 amount].
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import {
  formatEther,
  getAddress,
  isAddress,
  parseEther,
} from "viem";
import type { AllocationFile, MerkleFile, MerkleLeaf } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readAllocations(path: string): AllocationFile {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isRecord(raw)) throw new Error("allocations.json must be an object");
  if (!Array.isArray(raw["allocations"])) {
    throw new Error("allocations.json allocations must be an array");
  }
  const totalPot = raw["totalPot"];
  const assertedSum = raw["assertedSum"];
  if (typeof totalPot !== "string") throw new Error("totalPot must be a string");
  if (typeof assertedSum !== "string") throw new Error("assertedSum must be a string");
  if (raw["potMatches"] !== true) throw new Error("potMatches must be true");

  const allocations = raw["allocations"].map((value, index) => {
    if (!isRecord(value)) throw new Error(`allocations[${index}] must be an object`);
    const nodeId = value["nodeId"];
    const recipient = value["recipient"];
    const allocationWei = value["allocationWei"];
    if (typeof nodeId !== "string" || nodeId.length === 0) {
      throw new Error(`allocations[${index}].nodeId must be a string`);
    }
    if (typeof recipient !== "string" || !isAddress(recipient)) {
      throw new Error(`allocations[${index}].recipient must be an address`);
    }
    if (typeof allocationWei !== "string" || !/^\d+$/.test(allocationWei)) {
      throw new Error(`allocations[${index}].allocationWei must be an integer string`);
    }
    return {
      nodeId,
      recipient: getAddress(recipient),
      allocationWei,
    };
  });

  return {
    totalPot,
    assertedSum,
    potMatches: true,
    keepBps: typeof raw["keepBps"] === "string" ? raw["keepBps"] : "0",
    allocations,
  };
}

function main(): void {
  const potArg = process.argv[2] ?? "10";
  if (!/^\d+(\.\d+)?$/.test(potArg)) {
    throw new Error(`Total pot must be a decimal ETH amount, got "${potArg}"`);
  }
  const pot = parseEther(potArg);

  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..");
  const allocationsPath = resolve(repoRoot, "data", "allocations.json");
  const file = readAllocations(allocationsPath);

  let sum = 0n;
  const seen = new Set<string>();
  for (const allocation of file.allocations) {
    const amount = BigInt(allocation.allocationWei);
    if (amount <= 0n) {
      throw new Error(`Allocation for ${allocation.nodeId} must be > 0`);
    }
    const key = allocation.recipient.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate recipient in Merkle leaves: ${key}`);
    seen.add(key);
    sum += amount;
  }

  if (sum !== pot) {
    const discrepancy = sum > pot ? sum - pot : pot - sum;
    throw new Error(
      `Merkle sum mismatch: allocations ${sum} wei vs CLI pot ${pot} wei (discrepancy ${discrepancy} wei)`,
    );
  }
  if (BigInt(file.totalPot) !== pot || BigInt(file.assertedSum) !== pot) {
    throw new Error(
      `allocations.json totalPot/assertedSum (${file.totalPot}/${file.assertedSum}) does not equal CLI pot ${pot}`,
    );
  }

  const values: string[][] = file.allocations.map((allocation) => [
    allocation.recipient,
    allocation.allocationWei,
  ]);
  const tree = StandardMerkleTree.of(values, ["address", "uint256"]);

  const leaves: MerkleLeaf[] = file.allocations.map((allocation, index) => ({
    nodeId: allocation.nodeId,
    recipient: allocation.recipient,
    amount: allocation.allocationWei,
    proof: tree.getProof(index) as `0x${string}`[],
  }));

  const merkle: MerkleFile = {
    root: tree.root as `0x${string}`,
    leafCount: leaves.length,
    totalPot: pot.toString(),
    leaves,
  };

  const outPath = resolve(repoRoot, "data", "merkle.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(merkle, null, 2)}\n`, "utf8");

  process.stdout.write(`Pot: ${formatEther(pot)} ETH (${pot.toString()} wei)\n`);
  process.stdout.write(`Merkle root: ${merkle.root}\n`);
  process.stdout.write(`Leaf count: ${merkle.leafCount}\n`);
  process.stdout.write(`Sum of leaves == pot exactly (${sum.toString()} wei)\n`);
  process.stdout.write(`Wrote data/merkle.json\n`);
}

try {
  main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`build-merkle: ${message}\n`);
  process.exitCode = 1;
}
