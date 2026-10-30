/**
 * Data-level checks that run under `npm test`. These complement the Foundry
 * tests: cycle presence, exact BigInt conservation, Merkle proofs, and juror
 * signatures over the committed sample data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { verifyTypedData, type Address } from "viem";
import {
  JUDGMENT_DOMAIN,
  JUDGMENT_TYPES,
  judgmentMessage,
} from "./eip712.js";
import type { AllocationFile, Graph, Judgment, MerkleFile } from "./types.js";

const repoRoot = resolve(import.meta.dirname, "..");
const graph = JSON.parse(
  readFileSync(resolve(repoRoot, "data", "graph.json"), "utf8"),
) as Graph;
const allocations = JSON.parse(
  readFileSync(resolve(repoRoot, "data", "allocations.json"), "utf8"),
) as AllocationFile;
const merkle = JSON.parse(
  readFileSync(resolve(repoRoot, "data", "merkle.json"), "utf8"),
) as MerkleFile;
const judgments = JSON.parse(
  readFileSync(resolve(repoRoot, "data", "judgments.json"), "utf8"),
) as Judgment[];

test("sample graph contains the qr-core <-> i18n-base cycle", () => {
  const children = new Map<string, string[]>();
  for (const node of graph.nodes) children.set(node.id, []);
  for (const edge of graph.edges) children.get(edge.from)?.push(edge.to);

  let found = false;
  const candidates = ["qr-core", "i18n-base"];
  for (const start of candidates) {
    const visit = (nodeId: string, path: Set<string>): void => {
      for (const child of children.get(nodeId) ?? []) {
        if (child === start) {
          found = true;
          return;
        }
        if (path.has(child)) continue;
        path.add(child);
        visit(child, path);
        path.delete(child);
      }
    };
    visit(start, new Set([start]));
  }
  assert.equal(found, true, "expected qr-core and i18n-base to be mutually reachable");
});

test("allocation sum equals the pot exactly (BigInt)", () => {
  const pot = BigInt(allocations.totalPot);
  let sum = 0n;
  for (const entry of allocations.allocations) sum += BigInt(entry.allocationWei);
  assert.equal(sum, pot);
  assert.equal(BigInt(allocations.assertedSum), pot);
  assert.equal(allocations.potMatches, true);
});

test("every Merkle proof verifies and leaves sum to the pot", () => {
  let sum = 0n;
  for (const leaf of merkle.leaves) {
    const valid = StandardMerkleTree.verify(
      merkle.root,
      ["address", "uint256"],
      [leaf.recipient, leaf.amount],
      leaf.proof,
    );
    assert.equal(valid, true, `proof failed for ${leaf.nodeId}`);
    sum += BigInt(leaf.amount);
  }
  assert.equal(merkle.leafCount, merkle.leaves.length);
  assert.equal(sum, BigInt(merkle.totalPot));
});

test("all committed jury judgments verify against their juror address", async () => {
  assert.ok(judgments.length > 0);
  for (const judgment of judgments) {
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
    assert.equal(valid, true, `bad signature for ${judgment.packageA}/${judgment.packageB}`);
  }
});
