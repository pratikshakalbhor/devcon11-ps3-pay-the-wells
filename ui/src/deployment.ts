import type { Address, Hex } from "viem";

/** Etherscan base URL for Sepolia. */
export const ETHERSCAN_BASE = "https://sepolia.etherscan.io";

export interface DeploymentRecord {
  address: Address;
  deployTx: Hex;
  proposeTx: Hex;
  merkleRoot: Hex;
}

/**
 * Public record of the current Sepolia deployment, used only to render explorer
 * links. Keep in sync with deployments/sepolia.json and README.md.
 */
export const KNOWN_DEPLOYMENT: DeploymentRecord = {
  address: "0xc02f9570f0B7DAB6B12B7ba6d453e5e302A4ec22",
  deployTx: "0x1d55a2cd8b4ad599fb8ec0760739671dde86a9bfbc92504171e944c061114542",
  proposeTx: "0x4076712e3115f78836dec89c86c455731c5717279de76539b94e78fe3aa602c4",
  merkleRoot: "0xe0a4e24507e6da90b6f5c165c46af2ae4a1a12c3cb4ad4804debfbb86bd6c477",
};

export function etherscanAddress(address: string): string {
  return `${ETHERSCAN_BASE}/address/${address}`;
}

export function etherscanTx(hash: string): string {
  return `${ETHERSCAN_BASE}/tx/${hash}`;
}

/** True when the configured contract matches the recorded deployment. */
export function isKnownDeployment(address: string | null | undefined): boolean {
  return (
    typeof address === "string" &&
    address.toLowerCase() === KNOWN_DEPLOYMENT.address.toLowerCase()
  );
}
