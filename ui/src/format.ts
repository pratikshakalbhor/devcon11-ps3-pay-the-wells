import { formatEther } from "viem";

const WAD = 1_000_000_000_000_000_000n;
const BPS = 10_000n;

/** Format wei as ETH, trimmed to at most 6 decimal places. BigInt only. */
export function formatEth(wei: bigint): string {
  const raw = formatEther(wei);
  const parts = raw.split(".");
  const whole = parts[0] ?? "0";
  const fraction = (parts[1] ?? "").slice(0, 6).replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

/** Allocation as a percentage of the pot, with two decimals. BigInt only. */
export function formatPercent(part: bigint, total: bigint): string {
  if (total === 0n) return "0.00%";
  const basisPoints = (part * BPS) / total;
  const whole = basisPoints / 100n;
  const fraction = (basisPoints % 100n).toString().padStart(2, "0");
  return `${whole.toString()}.${fraction}%`;
}

/** Format a WAD weight as a readable decimal (4 places). */
export function formatWad(wad: bigint): string {
  const whole = wad / WAD;
  const fraction = (wad % WAD).toString().padStart(18, "0").slice(0, 4);
  return `${whole.toString()}.${fraction}`;
}

export function formatBps(keepBps: bigint): string {
  const whole = keepBps / BPS;
  const fraction = (keepBps % BPS).toString().padStart(4, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole.toString()}.${fraction}` : whole.toString();
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function shortHash(hash: string): string {
  return hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : hash;
}
