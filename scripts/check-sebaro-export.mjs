#!/usr/bin/env node
// Guards the sebaro design export (ADR-0051 #37). apps/desktop/ui/src/sebaro
// is written by sebaroDesign's export tool and never edited by hand; its
// manifest sebaro-export.json lists every exported file with its sha256.
// This script does what that tool's `--verify DIR --files-only` does, without
// shipping the tool or needing python3:
//   - every file the manifest lists exists and has the recorded sha256
//   - no other file is in the folder
// Dotfiles and anything in a dot directory (.DS_Store) are not looked at, as
// the export tool does not. The tool only warns about a file it does not own;
// here it fails, because a clean export never leaves one behind (it removes
// what it no longer exports) and a warning would pass CI unseen.
// Source drift (sebaroDesign moved on) is not checked: that needs a
// sebaroDesign checkout and the tool's full `--verify`.
//
// Usage: node scripts/check-sebaro-export.mjs [export-dir]
// The directory defaults to the app's export folder; the argument exists to
// test the check on a copy. Exits 1 on drift, 2 on an unreadable manifest.
// No dependencies.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(process.argv[2] ?? join(root, "apps/desktop/ui/src/sebaro"));
const MANIFEST = "sebaro-export.json";
const FORMAT = "1.0"; // of sebaro-export.json; a new format means re-reading this script
const FIX = "re-export with sebaroDesign's export_system.py (CLAUDE.md, generated files); never edit the folder by hand";

const inRepo = relative(root, dir);
const shown = inRepo.startsWith("..") ? dir : inRepo || ".";

const fail = (message, code = 2) => {
  console.error(`check-sebaro-export: ${message}`);
  process.exit(code);
};

const manifestPath = join(dir, MANIFEST);
if (!existsSync(manifestPath)) fail(`${shown}/${MANIFEST} not found; not a sebaro export`);

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  fail(`${shown}/${MANIFEST} is not valid JSON: ${error.message}`);
}
if (manifest.format !== FORMAT) {
  fail(`${shown}/${MANIFEST} has format ${JSON.stringify(manifest.format)}, this check reads ${FORMAT}`);
}
if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
  fail(`${shown}/${MANIFEST} lists no files`);
}

// Files below dir, as forward-slash paths relative to it, without dotfiles
// and dot directories (the export tool's `visible_files`).
const visibleFiles = (base, prefix = "") => {
  const out = [];
  for (const name of readdirSync(base)) {
    if (name.startsWith(".")) continue;
    const path = join(base, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...visibleFiles(path, rel));
    else if (stat.isFile()) out.push(rel);
  }
  return out;
};

const problems = [];
const listed = new Set([MANIFEST]);
for (const entry of manifest.files) {
  const path = entry?.path;
  if (typeof path !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256 ?? "")) {
    fail(`${shown}/${MANIFEST} has a file entry without a path or sha256: ${JSON.stringify(entry)}`);
  }
  // Paths are relative and stay inside the folder.
  const full = resolve(dir, path);
  if (path.startsWith("/") || !full.startsWith(dir + sep)) {
    fail(`${shown}/${MANIFEST} lists a path outside the export: ${path}`);
  }
  listed.add(path);
  if (!existsSync(full) || !statSync(full).isFile()) {
    problems.push(["missing", path]);
  } else if (createHash("sha256").update(readFileSync(full)).digest("hex") !== entry.sha256) {
    problems.push(["edited", path]);
  }
}
for (const path of visibleFiles(dir)) {
  if (!listed.has(path)) problems.push(["not in the manifest", path]);
}

const source = [manifest.tool, manifest.sebaroDesign?.commit && `sebaroDesign ${manifest.sebaroDesign.commit.slice(0, 7)}`]
  .filter(Boolean)
  .join(", ");

if (problems.length > 0) {
  console.error(`check-sebaro-export: ${shown} differs from its ${MANIFEST} (${source}):`);
  for (const [what, path] of problems) console.error(`  ${`${what}:`.padEnd(21)} ${path}`);
  console.error(`${problems.length} problem(s); ${FIX}`);
  process.exit(1);
}

console.log(`sebaro export up to date: ${manifest.files.length} files match ${MANIFEST} (${source})`);
