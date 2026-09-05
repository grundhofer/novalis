#!/usr/bin/env node
// The i18n gate (PLAN.md §5.8), run by `pnpm i18n:check` and by ci.yml.
//
// Three checks, no dependencies:
//   1. Catalog shape — both files are flat `namespace.key` string maps, with no
//      empty values.
//   2. Parity — the same key set, the same `{{placeholders}}` per key, and a
//      complete `_one`/`_other` pair wherever either exists (de and en have
//      exactly these two CLDR plural categories).
//   3. Drift — every key the code asks for exists. Both halves are scanned:
//      `t("…")` in the UI and `cat.t("…")` in the Rust shell, since the native
//      menu reads the same catalogs.
// Keys that no caller uses are listed but do not fail: the catalog is written
// ahead of the code it serves.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const catalogs = { en: join(root, "i18n/en.json"), de: join(root, "i18n/de.json") };
const sources = [join(root, "apps/desktop/ui/src"), join(root, "apps/desktop/src-tauri/src")];
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".rs"]);

const problems = [];
const fail = (message) => problems.push(message);

function loadCatalog(locale, path) {
  if (!existsSync(path)) {
    fail(`${path} is missing`);
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error.message}`);
    return null;
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") fail(`${locale}: "${key}" is not a string (catalogs are flat)`);
    else if (value.trim() === "") fail(`${locale}: "${key}" is empty`);
  }
  return parsed;
}

const en = loadCatalog("en", catalogs.en);
const de = loadCatalog("de", catalogs.de);
if (!en || !de) {
  for (const problem of problems) console.error(`i18n-check: ${problem}`);
  process.exit(1);
}

// 2. Parity.
for (const key of Object.keys(en)) if (!(key in de)) fail(`de.json is missing "${key}"`);
for (const key of Object.keys(de)) if (!(key in en)) fail(`en.json is missing "${key}" (en is canonical)`);

const placeholders = (value) => new Set([...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
for (const [key, value] of Object.entries(en)) {
  if (!(key in de)) continue;
  const left = placeholders(value);
  const right = placeholders(de[key]);
  for (const name of left) if (!right.has(name)) fail(`de "${key}" is missing {{${name}}}`);
  for (const name of right) if (!left.has(name)) fail(`de "${key}" has an extra {{${name}}}`);
}

for (const catalog of [
  ["en", en],
  ["de", de],
]) {
  const [locale, map] = catalog;
  for (const key of Object.keys(map)) {
    const match = /^(.*)_(one|other)$/.exec(key);
    if (!match) continue;
    const partner = `${match[1]}_${match[2] === "one" ? "other" : "one"}`;
    if (!(partner in map)) fail(`${locale}: "${key}" has no "${partner}" (both CLDR categories are required)`);
  }
}

// 3. Drift.
const used = new Set();
const walk = (dir) => {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (CODE_EXTENSIONS.has(extname(entry))) {
      // `t("key")` in the UI and `cat.t("key")` in the Rust shell are the same
      // shape. Nothing else counts as a use: a bare string that happens to look
      // like a key (a command id, a CSS class) is not one.
      const text = readFileSync(path, "utf8");
      for (const match of text.matchAll(/(?:^|[^\w])t\(\s*"([a-zA-Z][\w.]*)"/g)) used.add(match[1]);
    }
  }
};
for (const dir of sources) walk(dir);

const missing = [...used].filter((key) => !(key in en) && !(`${key}_other` in en));
for (const key of missing) fail(`code asks for "${key}", which is in neither catalog`);

const unused = Object.keys(en)
  .filter((key) => !key.endsWith("_one"))
  .map((key) => key.replace(/_other$/, ""))
  .filter((key) => !used.has(key));

if (problems.length > 0) {
  for (const problem of problems) console.error(`i18n-check: ${problem}`);
  process.exit(1);
}

console.log(`i18n-check: ${Object.keys(en).length} keys, en/de in parity, ${used.size} referenced in code`);
if (unused.length > 0) {
  console.log(`i18n-check: ${unused.length} key(s) not referenced yet:`);
  for (const key of unused) console.log(`  ${key}`);
}
