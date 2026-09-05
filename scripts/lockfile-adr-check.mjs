#!/usr/bin/env node
// Minimalism gate for dependencies (PLAN.md §11.5, D26): a pull request that
// adds a NEW top-level package to Cargo.lock or pnpm-lock.yaml must cite an
// ADR (`ADR-NNNN`) in its body. Version bumps of existing packages pass.
//
// "Top-level" means a direct dependency of a workspace member:
//   Cargo.lock      the `dependencies` of every [[package]] without a `source`
//                   (workspace members), minus the members themselves
//   pnpm-lock.yaml  every name under `importers.<pkg>.{dependencies,
//                   devDependencies,optionalDependencies}` that is not a
//                   `link:` to another workspace package
//
// Inputs come from the environment, never from argv or interpolation:
//   BASE_SHA  the PR base commit (must be fetched; ci.yml does `git fetch`)
//   PR_BODY   the PR description
// Without BASE_SHA (not a pull request) the check is skipped with a message.
// Exits 1 when new packages appear and PR_BODY has no ADR reference.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseSha = (process.env.BASE_SHA ?? "").trim();
const prBody = process.env.PR_BODY ?? "";

if (!baseSha) {
  console.log("lockfile-adr-check: BASE_SHA not set (not a pull request); skipped");
  process.exit(0);
}

const atBase = (file) => {
  try {
    return execFileSync("git", ["show", `${baseSha}:${file}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return ""; // the file did not exist at the base commit
  }
};

const firstToken = (s) => s.trim().replace(/^["']|["']$/g, "").split(/\s+/)[0];

export function cargoTopLevel(lock) {
  const packages = [];
  let current = null;
  for (const raw of lock.split("\n")) {
    const line = raw.trim();
    if (line === "[[package]]") {
      current = { name: null, source: null, dependencies: [] };
      packages.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("[")) {
      current = null;
      continue;
    }
    if (line.startsWith("name = ")) current.name = firstToken(line.slice("name = ".length));
    else if (line.startsWith("source = ")) current.source = firstToken(line.slice("source = ".length));
    else if (line.startsWith("dependencies = [")) {
      current.dependencies = [];
      current.inDependencies = !line.endsWith("]");
      for (const m of line.slice("dependencies = [".length).matchAll(/"([^"]+)"/g)) current.dependencies.push(firstToken(m[1]));
    } else if (current.inDependencies) {
      if (line === "]") current.inDependencies = false;
      else for (const m of line.matchAll(/"([^"]+)"/g)) current.dependencies.push(firstToken(m[1]));
    }
  }
  const members = new Set(packages.filter((p) => p.name && !p.source).map((p) => p.name));
  const top = new Set();
  for (const p of packages) {
    if (!members.has(p.name)) continue;
    for (const dep of p.dependencies) if (!members.has(dep)) top.add(dep);
  }
  return top;
}

export function pnpmTopLevel(lock) {
  const top = new Set();
  const lines = lock.split("\n");
  const indent = (s) => s.length - s.trimStart().length;
  let i = lines.findIndex((l) => l === "importers:");
  if (i < 0) return top;
  let section = null; // dependencies | devDependencies | optionalDependencies
  let name = null;
  let linked = false;
  const flush = () => {
    if (name && section && !linked) top.add(name);
    name = null;
    linked = false;
  };
  for (i += 1; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    const depth = indent(raw);
    if (depth === 0) break; // next top-level key
    const text = raw.trim();
    if (depth === 2) { flush(); section = null; continue; } // importer path
    if (depth === 4) { flush(); section = /^(dependencies|devDependencies|optionalDependencies):$/.test(text) ? text.slice(0, -1) : null; continue; }
    if (depth === 6 && section && text.endsWith(":")) { flush(); name = text.slice(0, -1).replace(/^['"]|['"]$/g, ""); continue; }
    if (depth === 8 && name) {
      const m = text.match(/^version:\s*(.+)$/);
      if (m && firstToken(m[1]).startsWith("link:")) linked = true;
    }
  }
  flush();
  return top;
}

const lockfiles = [
  { file: "Cargo.lock", topLevel: cargoTopLevel },
  { file: "pnpm-lock.yaml", topLevel: pnpmTopLevel },
];

const added = [];
for (const { file, topLevel } of lockfiles) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  const before = topLevel(atBase(file));
  const after = topLevel(readFileSync(path, "utf8"));
  for (const name of [...after].sort()) if (!before.has(name)) added.push({ file, name });
}

if (added.length === 0) {
  console.log("lockfile-adr-check: no new top-level packages");
  process.exit(0);
}

const hasAdr = /\bADR-\d{4}\b/.test(prBody);
console.log(`lockfile-adr-check: ${added.length} new top-level package(s):`);
for (const { file, name } of added) console.log(`  ${file.padEnd(16)} ${name}`);
if (hasAdr) {
  console.log(`lockfile-adr-check: PR body cites ${prBody.match(/\bADR-\d{4}\b/)[0]}; ok`);
  process.exit(0);
}
console.error("lockfile-adr-check: a new dependency needs an owner decision. Record it as docs/decisions/NNNN-*.md with the owner's quoted yes and cite ADR-NNNN in the PR body (PLAN.md §11.5).");
process.exit(1);
