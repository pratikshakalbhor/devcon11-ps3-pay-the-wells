import "dotenv/config";
import { getAddress, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  JUDGMENT_DOMAIN,
  JUDGMENT_TYPES,
  judgmentMessage,
  type SignedJudgment,
} from "./eip712.js";
import type { Preference } from "./types.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value;
}

function required(name: string): string {
  const value = arg(name);
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing --${name}`);
  }
  return value;
}

function parsePreference(value: string): Preference {
  if (value === "A" || value === "B" || value === "equal") return value;
  throw new Error(`Invalid --prefer "${value}" (expected A, B, or equal)`);
}

function parseKeyEnv(): string {
  const envName = arg("key-env") ?? "TEST_JUROR_PRIVATE_KEY";
  const raw = process.env[envName];
  if (raw === undefined || raw.length === 0) {
    throw new Error(
      `Environment variable ${envName} is required (test-only key; never commit it)`,
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(`${envName} must be a 32-byte hex private key`);
  }
  return raw;
}

async function main(): Promise<void> {
  const packageA = required("a");
  const packageB = required("b");
  const preferred = parsePreference(required("prefer"));
  const account = privateKeyToAccount(parseKeyEnv() as `0x${string}`);

  const signature = await account.signTypedData({
    domain: JUDGMENT_DOMAIN,
    types: JUDGMENT_TYPES,
    primaryType: "Judgment",
    message: judgmentMessage(packageA, packageB, preferred),
  });

  if (!isAddress(account.address)) {
    throw new Error("Derived juror address is invalid");
  }

  const judgment: SignedJudgment = {
    jurorId: getAddress(account.address),
    packageA,
    packageB,
    preferred,
    signature,
  };

  process.stdout.write(`${JSON.stringify(judgment, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`sign-judgment: ${message}\n`);
  process.exitCode = 1;
});
