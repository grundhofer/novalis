#!/usr/bin/env node
// Bundle budget gate (PLAN.md §11.3). Parses apps/desktop/ui/dist/index.html
// and holds the eager payload to docs/BUDGET.json. "Eager" is what the
// browser fetches before the app can paint:
//   <script type="module" src>, <link rel="modulepreload" href>, <link rel="stylesheet" href>
// Lazy chunks (dynamic import) are not counted. Fonts are every
// .woff2/.woff/.ttf/.otf under dist, raw bytes (woff2 is already compressed).
// Any http(s) src/href fails outright: nothing loads from a CDN (D10).
//
// The four keys read from docs/BUDGET.json (kB = 1024 bytes; other keys in
// that file belong to other gates and are ignored here):
//   "eagerJsGzipKb"        sum of eager JS, gzipped
//   "maxEagerChunkGzipKb"  largest single eager JS file, gzipped
//   "eagerCssKb"           sum of eager CSS, raw
//   "fontsKb"              sum of bundled font files, raw
// Exits 1 on any breach, missing input or unknown budget shape. No dependencies.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "apps/desktop/ui/dist");
const indexHtml = join(dist, "index.html");
const budgetFile = join(root, "docs/BUDGET.json");
const BUDGET_KEYS = ["eagerJsGzipKb", "maxEagerChunkGzipKb", "eagerCssKb", "fontsKb"];
const FONT_EXTENSIONS = new Set([".woff2", ".woff", ".ttf", ".otf"]);
const KB = 1024;

const fail = (message) => {
  console.error(`bundle-budget: ${message}`);
  process.exit(1);
};

if (!existsSync(indexHtml)) fail(`${indexHtml} not found; build the UI first (just check)`);
if (!existsSync(budgetFile)) {
  fail(`${budgetFile} not found; expected shape: {${BUDGET_KEYS.map((k) => ` "${k}": <number>`).join(",")} }`);
}

const budget = JSON.parse(readFileSync(budgetFile, "utf8"));
for (const key of BUDGET_KEYS) {
  if (typeof budget[key] !== "number" || !(budget[key] > 0)) {
    fail(`docs/BUDGET.json: "${key}" must be a positive number`);
  }
}

// Attributes of every <script> and <link> tag, in document order.
const tags = [];
for (const [, name, attrText] of readFileSync(indexHtml, "utf8").matchAll(/<(script|link)\b([^>]*)>/gi)) {
  const attrs = {};
  for (const m of attrText.matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  tags.push({ name: name.toLowerCase(), attrs });
}

const eagerJs = [];
const eagerCss = [];
for (const { name, attrs } of tags) {
  const rel = (attrs.rel ?? "").toLowerCase();
  if (name === "script" && attrs.src) eagerJs.push(attrs.src);
  else if (name === "link" && rel === "modulepreload" && attrs.href) eagerJs.push(attrs.href);
  else if (name === "link" && rel === "stylesheet" && attrs.href) eagerCss.push(attrs.href);
}

const resolveAsset = (ref) => {
  if (/^(https?:)?\/\//i.test(ref)) fail(`${ref} loads from the network; nothing may come from a CDN (D10)`);
  const file = join(dist, ref.replace(/^\.?\//, ""));
  if (!existsSync(file)) fail(`${ref} is referenced by index.html but missing from dist/`);
  return file;
};

const gzipBytes = (file) => gzipSync(readFileSync(file)).length;
const jsSizes = [...new Set(eagerJs)].map((ref) => ({ ref, bytes: gzipBytes(resolveAsset(ref)) }));
const cssSizes = [...new Set(eagerCss)].map((ref) => ({ ref, bytes: statSync(resolveAsset(ref)).size }));

const fontFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (FONT_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase())) {
      fontFiles.push({ ref: path.slice(dist.length + 1), bytes: statSync(path).size });
    }
  }
};
walk(dist);

const sum = (items) => items.reduce((total, { bytes }) => total + bytes, 0);
const largestJs = jsSizes.reduce((max, item) => (item.bytes > max.bytes ? item : max), { ref: "-", bytes: 0 });

const rows = [
  { metric: "eager JS (gzip)", bytes: sum(jsSizes), limitKb: budget.eagerJsGzipKb, detail: `${jsSizes.length} file(s)` },
  { metric: "largest eager JS chunk (gzip)", bytes: largestJs.bytes, limitKb: budget.maxEagerChunkGzipKb, detail: largestJs.ref },
  { metric: "eager CSS (raw)", bytes: sum(cssSizes), limitKb: budget.eagerCssKb, detail: `${cssSizes.length} file(s)` },
  { metric: "fonts (raw)", bytes: sum(fontFiles), limitKb: budget.fontsKb, detail: `${fontFiles.length} file(s)` },
];

let breached = false;
for (const { metric, bytes, limitKb, detail } of rows) {
  const kb = bytes / KB;
  const over = kb > limitKb;
  breached ||= over;
  console.log(`  ${over ? "OVER" : "ok  "}  ${metric.padEnd(32)} ${kb.toFixed(1).padStart(8)} kB / ${String(limitKb).padStart(4)} kB  ${detail}`);
}

if (breached) fail("budget exceeded (docs/BUDGET.json); re-measure and record the numbers in the PR, or trim the eager payload");
console.log("bundle-budget: within budget");
