/**
 * Verify every proof in data/merkle.json against the committed root.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { getAddress, isAddress } from "viem";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const merklePath = resolve(here, "..", "data", "merkle.json");
  const raw = JSON.parse(readFileSync(merklePath, "utf8")) as unknown;
  if (!isRecord(raw)) throw new Error("merkle.json must be an object");
  const root = raw["root"];
  const leavesRaw = raw["leaves"];
  if (typeof root !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(root)) {
    throw new Error("merkle.json root must be a bytes32 hex string");
  }
  if (!Array.isArray(leavesRaw)) throw new Error("merkle.json leaves must be an array");

  let sum = 0n;
  const seen = new Set<string>();
  for (const [index, value] of leavesRaw.entries()) {
    if (!isRecord(value)) throw new Error(`leaves[${index}] must be an object`);
    const nodeId = value["nodeId"];
    const recipient = value["recipient"];
    const amount = value["amount"];
    const proof = value["proof"];
    if (typeof nodeId !== "string") throw new Error(`leaves[${index}].nodeId missing`);
    if (typeof recipient !== "string" || !isAddress(recipient)) {
      throw new Error(`leaves[${index}].recipient invalid`);
    }
    if (typeof amount !== "string" || !/^\d+$/.test(amount)) {
      throw new Error(`leaves[${index}].amount invalid`);
    }
    if (!Array.isArray(proof) || !proof.every((item) => typeof item === "string")) {
      throw new Error(`leaves[${index}].proof invalid`);
    }
    const key = recipient.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate recipient in leaves: ${key}`);
    seen.add(key);

    const valid = StandardMerkleTree.verify(
      root as `0x${string}`,
      ["address", "uint256"],
      [getAddress(recipient), amount],
      proof as `0x${string}`[],
    );
    if (!valid) {
      throw new Error(`Proof failed for ${nodeId} (${recipient}, ${amount} wei)`);
    }
    sum += BigInt(amount);
  }

  const totalPot = raw["totalPot"];
  if (typeof totalPot === "string" && sum.toString() !== totalPot) {
    throw new Error(
      `Leaf sum ${sum.toString()} wei does not equal totalPot ${totalPot} wei`,
    );
  }

  process.stdout.write(`All ${leavesRaw.length} proofs valid.\n`);
  process.stdout.write(`Root: ${root}\n`);
  process.stdout.write(`Leaf sum: ${sum.toString()} wei\n`);
}

try {
  main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`verify-merkle: ${message}\n`);
  process.exitCode = 1;
}
