#!/usr/bin/env node
/**
 * Guardrail: money code must stay in BigInt. Fail if float parsing or an
 * `1e18` literal (including division by 1e18) appears in scripts or UI source.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const roots = [resolve(repoRoot, "scripts"), resolve(repoRoot, "ui", "src")];

const patterns = [
  { name: "Number()", regex: /\bNumber\s*\(/ },
  { name: "parseFloat()", regex: /\bparseFloat\s*\(/ },
  { name: "1e18 literal/division", regex: /\b1e18\b/i },
];

function walk(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      files.push(...walk(full));
    } else if (/\.(ts|tsx|mts)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

const findings = [];
for (const root of roots) {
  for (const file of walk(root)) {
    const source = readFileSync(file, "utf8");
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        if (pattern.regex.test(line)) {
          findings.push(
            `${relative(repoRoot, file)}:${index + 1}: ${pattern.name}: ${line.trim()}`,
          );
        }
      }
    });
  }
}

if (findings.length > 0) {
  process.stderr.write("source-scan: forbidden float money operations found\n");
  for (const finding of findings) process.stderr.write(`  ${finding}\n`);
  process.exit(1);
}

process.stdout.write("source-scan: clean (no Number(), parseFloat(), or 1e18)\n");
