/**
 * TEST-ONLY helper that regenerates data/judgments.json from the juror key in
 * .env. The private key is never written here; only signatures are committed.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import {
  JUDGMENT_DOMAIN,
  JUDGMENT_TYPES,
  judgmentMessage,
  type SignedJudgment,
} from "./eip712.js";
import type { Preference } from "./types.js";

interface Comparison {
  packageA: string;
  packageB: string;
  preferred: Preference;
}

const COMPARISONS: Comparison[] = [
  { packageA: "qr-tickets", packageB: "hindi-i18n", preferred: "A" },
  { packageA: "hindi-i18n", packageB: "wallet-wrapper", preferred: "A" },
  { packageA: "qr-tickets", packageB: "wallet-wrapper", preferred: "equal" },
];

async function main(): Promise<void> {
  const raw = process.env["TEST_JUROR_PRIVATE_KEY"];
  if (raw === undefined || !/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error("TEST_JUROR_PRIVATE_KEY must be set in .env for sample generation");
  }
  const account = privateKeyToAccount(raw as `0x${string}`);

  const judgments: SignedJudgment[] = [];
  for (const comparison of COMPARISONS) {
    const signature = await account.signTypedData({
      domain: JUDGMENT_DOMAIN,
      types: JUDGMENT_TYPES,
      primaryType: "Judgment",
      message: judgmentMessage(
        comparison.packageA,
        comparison.packageB,
        comparison.preferred,
      ),
    });
    judgments.push({
      jurorId: account.address,
      packageA: comparison.packageA,
      packageB: comparison.packageB,
      preferred: comparison.preferred,
      signature,
    });
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(here, "..", "data", "judgments.json");
  writeFileSync(outPath, `${JSON.stringify(judgments, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Wrote ${judgments.length} judgments signed by ${account.address} to ${outPath}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`make-sample-judgments: ${message}\n`);
  process.exitCode = 1;
});
