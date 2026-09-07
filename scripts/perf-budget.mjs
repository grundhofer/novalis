#!/usr/bin/env node
// Perf budget gate (PLAN.md §11.3). Reads the JSON printed by
// `cargo run --release -p novalis-core --example perf` and holds each measured
// row to docs/BUDGET.json.
//
// CI thresholds are budget x ciNoiseFactor, because a shared runner is noisy
// and a gate that fires on noise gets ignored. The raw numbers are kept in the
// job artifact, so a slow drift is still visible even while the gate passes.
//
// This gate covers only what the core can measure: the cold cache scan and
// time to first search result on a 10k-note vault. Everything about the app
// needs instrumentation that does not exist yet, so the harness lists those
// rows under `unmeasured` and this script prints them. That is deliberate: the
// job used to run `cargo bench` with no bench targets and report success, which
// read as coverage it never had.
//
// Usage: node scripts/perf-budget.mjs <perf.json>
// Exits 1 on a breach, a missing input, or a measured key with no budget.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const budgetFile = join(root, "docs/BUDGET.json");

const fail = (message) => {
  console.error(`perf-budget: ${message}`);
  process.exit(1);
};

const input = process.argv[2];
if (!input) fail("usage: node scripts/perf-budget.mjs <perf.json>");
if (!existsSync(input)) fail(`${input} not found; run the perf example first`);
if (!existsSync(budgetFile)) fail(`${budgetFile} not found`);

let measurement;
let budget;
try {
  measurement = JSON.parse(readFileSync(input, "utf8"));
} catch (error) {
  fail(`${input} is not valid JSON: ${error.message}`);
}
try {
  budget = JSON.parse(readFileSync(budgetFile, "utf8"));
} catch (error) {
  fail(`${budgetFile} is not valid JSON: ${error.message}`);
}

const measured = measurement.measured;
if (!measured || typeof measured !== "object" || Object.keys(measured).length === 0) {
  fail("no `measured` object in the input: the harness produced nothing to gate on");
}

const factor = budget.ciNoiseFactor;
if (typeof factor !== "number" || factor <= 0) {
  fail("docs/BUDGET.json has no usable ciNoiseFactor");
}

const perMetric = budget.ciFactors ?? {};
console.log(
  `perf-budget: ${measurement.notesIndexed ?? "?"} notes indexed, thresholds are budget x ${factor} unless docs/BUDGET.json overrides`,
);

let breached = false;
let overBudget = 0;
for (const [key, value] of Object.entries(measured)) {
  if (typeof value !== "number") fail(`measured.${key} is not a number`);
  const limit = budget[key];
  // A measured row with no budget is a bug in one file or the other, and
  // silently skipping it is how a gate stops gating.
  if (typeof limit !== "number") fail(`measured.${key} has no budget in docs/BUDGET.json`);
  const metricFactor = typeof perMetric[key] === "number" ? perMetric[key] : factor;
  const threshold = limit * metricFactor;
  const over = value > threshold;
  breached ||= over;
  // A row can pass a deliberately loose CI threshold and still be over the
  // real budget. Saying so is the point: the wide threshold exists for runner
  // noise, not to make the number look good.
  const noteworthy = !over && value > limit;
  if (noteworthy) overBudget += 1;
  console.log(
    `  ${over ? "OVER" : "ok  "}  ${key.padEnd(36)} ${String(value).padStart(6)} / ${String(threshold).padStart(6)} (budget ${limit}, x${metricFactor})${noteworthy ? "  <- over the real budget on this runner" : ""}`,
  );
}

if (overBudget > 0) {
  console.log(
    `\nperf-budget: ${overBudget} row(s) passed the CI threshold while exceeding the real budget. That is expected on a shared runner; compare the artifact against a developer machine before trusting it.`,
  );
}

const unmeasured = Array.isArray(measurement.unmeasured) ? measurement.unmeasured : [];
if (unmeasured.length > 0) {
  console.log(`\nperf-budget: ${unmeasured.length} budget(s) still unmeasured — this job does not cover them:`);
  for (const row of unmeasured) console.log(`  --    ${String(row.budget).padEnd(36)} ${row.why}`);
}

if (breached) {
  fail("budget exceeded (docs/BUDGET.json); investigate before tagging a release");
}
console.log(
  overBudget > 0
    ? "\nperf-budget: within CI thresholds, but see the row(s) flagged above"
    : "\nperf-budget: measured rows within budget",
);
