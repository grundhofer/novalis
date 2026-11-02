#!/usr/bin/env node
// Measures the tab row, its fades and the tool row under it in WebKit
// (ADR-0051 #67–#70, #72–#74, #78).
// jsdom computes no layout (ADR-0011), and the review pictures of the
// rebuild never showed a classic scroll bar: a wide window, no tab row that
// overflowed. With "Show scroll bars: Always" (or a mouse attached) the bar
// took 17 px of the 32 px row and the switch slid below the tabs' names.
//
// The built UI (apps/desktop/ui/dist) is served on 127.0.0.1 and loaded into
// a WKWebView (scripts/webkit/harness.swift) with a stand-in for the shell
// (scripts/webkit/stub.js): ten notes, the last one current. Light and dark,
// 100 % and 200 % root font, classic and overlay scroll bars, the note in
// the editor and, with the preview switch pressed, in the preview. For each
// it checks:
//   - the tab row shows no scroll bar, and it does overflow
//   - the tab row is no higher than its tabs
//   - scrolled to its end, the tab row fades out at its start only (#70)
//   - the tool row (`.nv-doc-tools`) shows under it with its 14 tools
//   - every tool lies inside the row and the window, and clips nothing
//   - the tools of each line of the row share one middle (±0.5 px), and the
//     row has as much room above its tools as below them
//   - the switch's word stands on the word buttons' line (±0.5 px), off state
//   - the switch is as high as the word buttons, 32 px at 100 % (sebaro's
//     compact switch, #78)
//   - in the preview the switch is pressed, the ten format tools are off and
//     Find and the text size are not (#74), no tool has moved (±0.5 px) and
//     the switch kept its height (#78)
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

// One expression for the harness: null until the tab row stands, overflows,
// the fonts are in and the note's editor stands (by then a build with a tool
// row shows it); then the numbers, the tool row's relative to its top. For
// the preview (`window.__NV_STATE`) it first keeps the editor's numbers and
// presses the switch, then waits for the preview and measures again.
const MEASURE = `(() => {
  const head = document.querySelector(".nv-doc-head");
  const list = head && head.querySelector(".sb-doc-tabs");
  const tab = list && list.querySelector('.sb-doc-tabs__tab[aria-selected="true"]');
  if (!tab) return null;
  // Layout first: it is what starts the font loads; measured is the row in
  // its own fonts, never the fallback's.
  const overflows = list.scrollWidth > list.clientWidth;
  if (!overflows || document.fonts.status !== "loaded") return null;
  const before = window.__nvBefore;
  if (!before && !document.querySelector(".cm-content")) return null;
  // The middle of an element's first words, also inside a span of its own.
  const textMiddle = (el, top) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP));
    const text = walker.nextNode();
    if (!text) return null;
    const range = document.createRange();
    range.selectNodeContents(text);
    const box = range.getBoundingClientRect();
    return (box.top + box.bottom) / 2 - top;
  };
  const bar = document.querySelector(".nv-doc-tools");
  const toolRow = () => {
    if (!bar) return null;
    const box = bar.getBoundingClientRect();
    const style = getComputedStyle(bar);
    const pressed = bar.querySelector(":scope > [aria-pressed]");
    return {
      top: box.top - head.getBoundingClientRect().bottom,
      left: box.left,
      right: box.right,
      height: box.height,
      paddingTop: parseFloat(style.paddingTop),
      paddingBottom: parseFloat(style.paddingBottom),
      hairline: parseFloat(style.borderBottomWidth),
      window: document.documentElement.clientWidth,
      switchPressed: pressed ? pressed.getAttribute("aria-pressed") : null,
      tools: [...bar.querySelectorAll("button")].map((b) => {
        const r = b.getBoundingClientRect();
        return {
          name: b.getAttribute("aria-label") || b.textContent.trim(),
          kind: b === pressed ? "switch" : b.classList.contains("sb-icon-button") ? "icon" : "word",
          off: b.getAttribute("aria-disabled") === "true",
          top: r.top - box.top,
          bottom: r.bottom - box.top,
          left: r.left,
          right: r.right,
          height: r.height,
          text: textMiddle(b, box.top),
          clips: b.scrollWidth > b.clientWidth + 0.5 || b.scrollHeight > b.clientHeight + 0.5,
        };
      }),
    };
  };
  if (window.__NV_STATE === "preview" && !before) {
    const row = toolRow();
    if (!row) return { tabs: null, bar: null, before: null };
    window.__nvBefore = row;
    bar.querySelector(":scope > [aria-pressed]").click();
    return null;
  }
  if (before && (!document.querySelector(".preview-body") || document.fonts.status !== "loaded")) return null;
  const top = head.getBoundingClientRect().top;
  const style = getComputedStyle(list);
  return {
    tabs: {
      row: head.getBoundingClientRect().height,
      tab: tab.getBoundingClientRect().height,
      hairline: parseFloat(style.borderBottomWidth),
      bar: list.offsetHeight - list.clientHeight - parseFloat(style.borderBottomWidth),
      overflows,
      names: textMiddle(tab, top),
      more: list.dataset.nvMore ?? "",
      fadeStart: getComputedStyle(list, "::before").opacity,
      fadeEnd: getComputedStyle(list, "::after").opacity,
    },
    bar: toolRow(),
    before: before ?? null,
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

// The tool row of a note (DocTools.tsx): the switch, then the formats, Find
// and the text size; the formats are off while the preview shows (#74).
const TOOLS = 14;
const FORMATS = 10;

const failures = [];
const near = (a, b, by) => Math.abs(a - b) <= by;
for (const theme of ["light", "dark"]) {
  for (const font of ["100%", "200%"]) {
    for (const bars of ["Always", "WhenScrolling"]) {
      for (const state of ["editor", "preview"]) {
        const name = `${theme}-${font.replace("%", "")}-${bars}-${state}`;
        const stub = join(out, `stub-${name}.js`);
        writeFileSync(
          stub,
          `window.__NV_THEME = ${JSON.stringify(theme)}; window.__NV_ROOT_FONT = ${JSON.stringify(font)}; window.__NV_STATE = ${JSON.stringify(state)};\n` +
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
        const b = m.bar;
        if (!b) {
          fail("no tool row under the tabs (.nv-doc-tools)");
          continue;
        }
        const t = m.tabs;
        if (!t.overflows) fail("the tab row does not overflow, nothing measured");
        if (t.bar !== 0) fail(`the tab row shows a scroll bar of ${t.bar} px`);
        if (t.row > t.tab + t.hairline + 0.5) fail(`the tab row is ${t.row} px, its tabs ${t.tab} px`);
        // The current tab is the last, so the row stands at its end: tabs lie
        // beyond its start only, and only the start's fade shows (#70).
        if (t.more !== "start" || t.fadeStart !== "1" || t.fadeEnd !== "0")
          fail(`the fades say "${t.more}" (start ${t.fadeStart}, end ${t.fadeEnd}), not "start" (1, 0)`);

        if (!near(b.top, 0, 0.5)) fail(`the tool row stands ${b.top} px under the tab row, not right under it`);
        if (b.tools.length !== TOOLS) fail(`the tool row has ${b.tools.length} tools, not ${TOOLS}`);
        if (b.right > b.window + 0.5) fail(`the tool row ends at ${b.right} px, past the window's ${b.window}`);
        const inner = b.height - b.hairline;
        for (const tool of b.tools) {
          if (tool.top < -0.5 || tool.bottom > inner + 0.5 || tool.left < b.left - 0.5 || tool.right > b.right + 0.5)
            fail(`„${tool.name}“ (${tool.top}–${tool.bottom} px) leaves the row (0–${inner} px)`);
          if (tool.clips) fail(`„${tool.name}“ clips its content`);
        }
        // The row's lines: tools whose boxes share a stretch of height.
        const lines = [];
        for (const tool of [...b.tools].sort((x, y) => x.top - y.top)) {
          const line = lines.find((l) => tool.top < l.bottom && tool.bottom > l.top);
          if (line) {
            line.tools.push(tool);
            line.top = Math.min(line.top, tool.top);
            line.bottom = Math.max(line.bottom, tool.bottom);
          } else lines.push({ top: tool.top, bottom: tool.bottom, tools: [tool] });
        }
        for (const line of lines) {
          const middles = line.tools.map((x) => (x.top + x.bottom) / 2);
          if (Math.max(...middles) - Math.min(...middles) > 0.5)
            fail(`the tools of a line have middles from ${Math.min(...middles)} to ${Math.max(...middles)} px`);
        }
        const above = Math.min(...b.tools.map((x) => x.top));
        const below = inner - Math.max(...b.tools.map((x) => x.bottom));
        if (!near(above, below, 0.5)) fail(`the row has ${above} px above its tools and ${below} px below`);
        const swatch = b.tools.find((x) => x.kind === "switch");
        if (!swatch) fail("the tool row has no preview switch");
        const sameLine = b.tools.filter((x) => x.kind === "word" && swatch && lines.find((l) => l.tools.includes(swatch))?.tools.includes(x));
        let wordLine = "n/a";
        if (state === "editor" && swatch) {
          if (b.switchPressed !== "false") fail(`the switch is pressed (${b.switchPressed}); the editor's is the off state`);
          if (sameLine.length === 0) fail("no word button stands on the switch's line");
          for (const word of sameLine) {
            if (!near(word.text, swatch.text, 0.5))
              fail(`„${word.name}“ has its word at ${word.text.toFixed(2)} px, the switch at ${swatch.text.toFixed(2)} px`);
          }
          wordLine = sameLine.length ? `${Math.max(...sameLine.map((x) => Math.abs(x.text - swatch.text))).toFixed(2)} px off` : "none";
        }
        if (font === "100%" && swatch && swatch.height !== 32) fail(`the switch is ${swatch.height} px high, not 32`);
        const words = b.tools.filter((x) => x.kind === "word");
        if (words.length === 0) fail("the tool row has no word button");
        for (const word of words) {
          if (swatch && !near(word.height, swatch.height, 0.5))
            fail(`„${word.name}“ is ${word.height} px high, the switch ${swatch.height} px`);
        }
        let moved = 0;
        if (state === "preview") {
          if (b.switchPressed !== "true") fail(`the switch says ${b.switchPressed}, not pressed, in the preview`);
          const off = b.tools.filter((x) => x.off).map((x) => x.name);
          if (off.length !== FORMATS || b.tools.slice(1, 1 + FORMATS).some((x) => !x.off))
            fail(`in the preview ${off.length} tools are off (${off.join(", ")}), not the ${FORMATS} formats`);
          const was = m.before?.tools ?? [];
          if (was.length !== b.tools.length) fail(`the row had ${was.length} tools in the editor, ${b.tools.length} in the preview`);
          for (const [i, tool] of b.tools.entries()) {
            const w = was[i];
            if (!w) continue;
            const shift = Math.max(Math.abs(tool.left - w.left), Math.abs(tool.top - w.top), Math.abs(tool.right - w.right));
            moved = Math.max(moved, i === 0 ? Math.abs(tool.left - w.left) : shift);
            // The switch's own end may follow its word's weight; nothing after it may move.
            if (i === 0 ? !near(tool.left, w.left, 0.5) : shift > 0.5) fail(`„${tool.name}“ moved ${shift.toFixed(2)} px when the preview came`);
            // Pressed, the switch keeps its height (#78).
            if (i === 0 && !near(tool.height, w.height, 0.5)) fail(`the switch is ${tool.height} px pressed, ${w.height} px off`);
          }
          if (!near(b.height, m.before?.height ?? 0, 0.5)) fail(`the row is ${b.height} px in the preview, ${m.before?.height} px in the editor`);
        }
        console.log(
          `${name.padEnd(30)} tabs ${t.row} px (bar ${t.bar}), tools ${b.tools.length} on ${lines.length} line(s), row ${b.height} px, ` +
            `switch ${swatch?.height} px (words ${[...new Set(words.map((x) => x.height))].join("/")} px), room ${above}/${below} px, word line ${wordLine}` +
            (state === "preview" ? `, moved ≤ ${moved.toFixed(2)} px` : ""),
        );
      }
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
