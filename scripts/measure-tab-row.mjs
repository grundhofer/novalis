#!/usr/bin/env node
// Measures the tab row, its fades and the preview switch in WebKit
// (ADR-0051 #67–#70).
// jsdom computes no layout (ADR-0011), and the review pictures of the
// rebuild never showed a classic scroll bar: a wide window, no tab row that
// overflowed. With "Show scroll bars: Always" (or a mouse attached) the bar
// took 17 px of the 32 px row and the switch slid below the tabs' names.
//
// The built UI (apps/desktop/ui/dist) is served on 127.0.0.1 and loaded into
// a WKWebView (scripts/webkit/harness.swift) with a stand-in for the shell
// (scripts/webkit/stub.js): ten tabs, the last one current. Light and dark,
// 100 % and 200 % root font, classic and overlay scroll bars. For each it
// checks:
//   - the row shows no scroll bar, and it does overflow
//   - the row is no higher than its tabs
//   - the switch's word stands on the tabs' names (±0.5 px), off state
//   - the switch stays inside the row with air above; at 100 % it is 24 px
//   - scrolled to its end, the row fades out at its start only (#70)
// A picture of each case goes to the output folder.
//
// Usage: node scripts/measure-tab-row.mjs [out-dir]
// macOS only (swiftc, WebKit, screencapture). Build the UI first:
// `pnpm --dir apps/desktop/ui build`. A window floats over the screen while
// it measures. Not part of `just check`: the CI runners have no screen to
// trust for this. Exits 1 when a check fails, 2 when it cannot run.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "apps/desktop/ui/dist");
const out = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), "tab-row-")));

if (process.platform !== "darwin") {
  console.error("measure-tab-row: macOS only");
  process.exit(2);
}
if (!existsSync(join(dist, "index.html"))) {
  console.error("measure-tab-row: no build; run `pnpm --dir apps/desktop/ui build` first");
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const harness = join(out, "harness");
try {
  execFileSync("swiftc", ["-O", join(root, "scripts/webkit/harness.swift"), "-o", harness], { stdio: "inherit" });
} catch {
  console.error("measure-tab-row: swiftc could not build scripts/webkit/harness.swift");
  process.exit(2);
}

// One expression for the harness: null until the row stands, overflows and
// the fonts are in; then the numbers, relative to the row's top.
const MEASURE = `(() => {
  const head = document.querySelector(".nv-doc-head");
  const list = head && head.querySelector(".sb-doc-tabs");
  const tab = list && list.querySelector('.sb-doc-tabs__tab[aria-selected="true"]');
  const button = head && head.querySelector(".nv-doc-head__tools > button");
  if (!tab || !button) return null;
  // Layout first: it is what starts the font loads; measured is the row in
  // its own fonts, never the fallback's.
  const overflows = list.scrollWidth > list.clientWidth;
  if (!overflows || document.fonts.status !== "loaded") return null;
  const top = head.getBoundingClientRect().top;
  const middle = (el) => {
    const text = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    const range = document.createRange();
    range.selectNodeContents(text);
    const box = range.getBoundingClientRect();
    return (box.top + box.bottom) / 2 - top;
  };
  const rect = (el) => { const box = el.getBoundingClientRect(); return { top: box.top - top, bottom: box.bottom - top, height: box.height }; };
  const style = getComputedStyle(list);
  return {
    row: rect(head).height,
    tab: rect(tab).height,
    hairline: parseFloat(style.borderBottomWidth),
    bar: list.offsetHeight - list.clientHeight - parseFloat(style.borderBottomWidth),
    overflows,
    names: middle(tab),
    word: middle(button),
    button: rect(button),
    pressed: button.getAttribute("aria-pressed"),
    more: list.dataset.nvMore ?? "",
    fadeStart: getComputedStyle(list, "::before").opacity,
    fadeEnd: getComputedStyle(list, "::after").opacity,
  };
})()`;
writeFileSync(join(out, "measure.js"), MEASURE);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  let file = resolve(dist, `.${path}`);
  if (file !== dist && !file.startsWith(dist + sep)) return void response.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) return void response.writeHead(404).end();
  response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  response.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const url = `http://127.0.0.1:${server.address().port}/`;

const failures = [];
const near = (a, b, by) => Math.abs(a - b) <= by;
for (const theme of ["light", "dark"]) {
  for (const font of ["100%", "200%"]) {
    for (const bars of ["Always", "WhenScrolling"]) {
      const name = `${theme}-${font.replace("%", "")}-${bars}`;
      const stub = join(out, `stub-${name}.js`);
      writeFileSync(
        stub,
        `window.__NV_THEME = ${JSON.stringify(theme)}; window.__NV_ROOT_FONT = ${JSON.stringify(font)};\n` +
          readFileSync(join(root, "scripts/webkit/stub.js"), "utf8"),
      );
      // The server runs in this process, so the harness runs beside it.
      const run = await new Promise((done) => {
        const child = spawn(harness, [url, join(out, `${name}.png`), "1280", "800", join(out, "measure.js"), stub, "-AppleShowScrollBars", bars]);
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d));
        child.stderr.on("data", (d) => (stderr += d));
        child.on("error", (error) => done({ code: -1, stdout, stderr: String(error) }));
        child.on("close", (code) => done({ code, stdout, stderr }));
      });
      if (run.code !== 0) {
        failures.push(`${name}: the harness failed (${run.code}) ${run.stderr.trim()}`);
        continue;
      }
      if (!existsSync(join(out, `${name}.png`))) failures.push(`${name}: no picture was taken`);
      const m = JSON.parse(run.stdout.trim().split("\n").pop());
      const fail = (what) => failures.push(`${name}: ${what}`);
      if (!m.overflows) fail("the row does not overflow, nothing measured");
      if (m.bar !== 0) fail(`the row shows a scroll bar of ${m.bar} px`);
      if (m.row > m.tab + m.hairline + 0.5) fail(`the row is ${m.row} px, its tabs ${m.tab} px`);
      if (m.button.top < 1) fail(`the switch touches the line above the row (${m.button.top} px)`);
      if (m.pressed !== "false") fail(`the switch is pressed (${m.pressed}); measured is the off state`);
      if (!near(m.word, m.names, 0.5)) fail(`the switch's word stands at ${m.word.toFixed(1)} px, the names at ${m.names.toFixed(1)} px`);
      if (m.button.top < 0 || m.button.bottom > m.row) fail(`the switch (${m.button.top}–${m.button.bottom} px) leaves the row (0–${m.row} px)`);
      // The current tab is the last, so the row stands at its end: tabs lie
      // beyond its start only, and only the start's fade shows (#70).
      if (m.more !== "start" || m.fadeStart !== "1" || m.fadeEnd !== "0")
        fail(`the fades say "${m.more}" (start ${m.fadeStart}, end ${m.fadeEnd}), not "start" (1, 0)`);
      if (font === "100%" && m.button.height !== 24) fail(`the switch is ${m.button.height} px high, not 24`);
      console.log(
        `${name.padEnd(22)} row ${m.row} px, bar ${m.bar} px, names ${m.names.toFixed(1)} px, word ${m.word.toFixed(1)} px, switch ${m.button.height} px at ${m.button.top}–${m.button.bottom}`,
      );
    }
  }
}
server.close();
console.log(`pictures: ${out}`);
if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log("measure-tab-row: all checks passed");
