#!/usr/bin/env node
// Guards the four version stamps (PLAN.md §11.4). VERSION is the source;
// `just bump` propagates it. This script only reads.
//   VERSION
//   Cargo.toml                             -> [workspace.package] version
//   package.json                           -> version
//   apps/desktop/src-tauri/tauri.conf.json -> version
// Prints all four and exits 1 on any mismatch or missing file. No dependencies.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const stamps = [
  { file: "VERSION", extract: (text) => text.trim() || null },
  {
    file: "Cargo.toml",
    label: "Cargo.toml [workspace.package]",
    // First `version = "…"` after the [workspace.package] section header.
    extract: (text) =>
      text.match(/^\[workspace\.package\][^[]*?^version\s*=\s*"([^"]+)"/ms)?.[1] ?? null,
  },
  { file: "package.json", extract: (text) => JSON.parse(text).version ?? null },
  {
    file: "apps/desktop/src-tauri/tauri.conf.json",
    extract: (text) => JSON.parse(text).version ?? null,
  },
];

const rows = stamps.map(({ file, label, extract }) => {
  const path = join(root, file);
  if (!existsSync(path)) return { label: label ?? file, value: null, why: "missing file" };
  try {
    const value = extract(readFileSync(path, "utf8"));
    return { label: label ?? file, value, why: value ? null : "no version field" };
  } catch (error) {
    return { label: label ?? file, value: null, why: `unreadable: ${error.message}` };
  }
});

const values = rows.map((row) => row.value);
const inSync = values.every(Boolean) && new Set(values).size === 1;

if (!inSync) {
  console.error("Version stamps are out of sync (fix with `just bump <version>`):");
  for (const { label, value, why } of rows) {
    console.error(`  ${label.padEnd(40)} ${value ?? `NOT FOUND (${why})`}`);
  }
  process.exit(1);
}

console.log(`Version stamps in sync: ${values[0]}`);
