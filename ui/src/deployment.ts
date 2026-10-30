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
  proposeTx: "0xddb460b7e1a54e75592c2fff453930bc37ebf9d7d4a8d3380ff50231f3cf298a",
  merkleRoot: "0xb13209fed9a8fdd42612dc6cd4fdddc8fda9c677152938a73d18c25af71b916e",
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
