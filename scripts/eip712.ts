import type { Address, Hex } from "viem";
import type { Preference } from "./types.js";

/**
 * EIP-712 domain for jury judgments. The domain is intentionally chain-scoped
 * but not contract-scoped: judgments are produced before the Sepolia contract
 * exists, and the offchain verifier is the source of truth for the tally.
 */
export const JUDGMENT_DOMAIN = {
  name: "DeepFunding",
  version: "1",
  chainId: 11155111,
} as const;

export const JUDGMENT_TYPES = {
  Judgment: [
    { name: "packageA", type: "string" },
    { name: "packageB", type: "string" },
    { name: "preferred", type: "string" },
  ],
} as const;

export interface JudgmentMessage {
  packageA: string;
  packageB: string;
  preferred: Preference;
}

export interface SignedJudgment {
  jurorId: Address;
  packageA: string;
  packageB: string;
  preferred: Preference;
  signature: Hex;
}

export function judgmentMessage(
  packageA: string,
  packageB: string,
  preferred: Preference,
): JudgmentMessage {
  return { packageA, packageB, preferred };
}
