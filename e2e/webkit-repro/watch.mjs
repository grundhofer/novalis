// Load one page in a bare WebKitGTK window and watch its AT-SPI tree for 20s.
//
// The whole observation is: how many accessible nodes does the page have, and
// does that number stay put. A single reading cannot answer the second half —
// the collapse happens after the page is first exposed — so this samples.
//
//   node e2e/webkit-repro/watch.mjs table.html
//
// Prints a series per page. A page that goes to a handful of nodes and stays
// there has vanished from the accessibility tree.
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import xa11y from "@crowecawcaw/xa11y";

const { App, setDefaultTimeout } = xa11y;
setDefaultTimeout(20);

const page = resolve(process.argv[2] ?? "table.html");
const host = resolve(import.meta.dirname, "host.py");
const SAMPLES = 12;
const EVERY_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn("python3", [host, page], { stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", (d) => process.stdout.write(`  [host] ${d}`));
child.stderr.on("data", (d) => process.stdout.write(`  [host!] ${d}`));

try {
  await sleep(3000);
  const app = await App.byPid(child.pid, { timeout: 30 });

  const series = [];
  let sawButton = null;
  for (let i = 0; i < SAMPLES; i++) {
    const tree = await app.dump().catch(() => "");
    series.push(tree.split("\n").length);
    // The button is plain page content: if it is gone, the PAGE is gone, not
    // just the table.
    const has = tree.includes("A button");
    if (sawButton === null) sawButton = has;
    else if (sawButton && !has) {
      console.log(`  page content disappeared at sample ${i + 1}`);
      sawButton = false;
    }
    await sleep(EVERY_MS);
  }

  const peak = Math.max(...series);
  const last = series[series.length - 1];
  console.log(`\n  page:   ${page.split("/").pop()}`);
  console.log(`  nodes:  [${series.join(", ")}]`);
  console.log(`  peak ${peak} -> final ${last}`);
  if (last < peak / 2) {
    console.log("  RESULT: the page collapsed out of the AT-SPI tree and did not recover");
    process.exitCode = 3;
  } else {
    console.log("  RESULT: the tree held");
  }
  console.log("\n----- final tree -----");
  console.log((await app.dump().catch(() => "")).split("\n").slice(0, 60).join("\n"));
} catch (e) {
  console.error("watch failed:", e.message);
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
}
