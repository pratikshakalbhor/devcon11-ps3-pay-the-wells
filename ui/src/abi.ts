import { getAddress, isAddress, parseAbi } from "viem";
import type { Address } from "viem";

export const SEPOLIA_CHAIN_ID = 11155111;

export const deepFundingAbi = parseAbi([
  "function operator() view returns (address)",
  "function merkleRoot() view returns (bytes32)",
  "function totalPot() view returns (uint256)",
  "function proposedAt() view returns (uint256)",
  "function finalized() view returns (bool)",
  "function hasOpenDispute() view returns (bool)",
  "function jurors(address juror) view returns (bool)",
  "function claimed(address recipient) view returns (bool)",
  "function dispute(string reason)",
  "function claim(uint256 amount, bytes32[] proof)",
  "event Disputed(address indexed juror, string reason)",
  "event Claimed(address indexed recipient, uint256 amount)",
]);

const configured = import.meta.env.VITE_CONTRACT_ADDRESS;
export const CONTRACT_ADDRESS: Address | null =
  typeof configured === "string" && isAddress(configured)
    ? getAddress(configured)
    : null;
