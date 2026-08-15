// Progressive probes against the real, running app. Every probe runs and
// reports even when an earlier one failed — a partial answer is still an
// answer, and the tree dump from probe 3 is useful precisely on the runs where
// probe 5 does not work yet.
//
// Exit code is 0 unless the harness itself broke. Probe outcomes are reported,
// not thrown: this is a spike whose job is to produce a verdict, not a gate.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

import { App, setDefaultTimeout } from "@crowecawcaw/xa11y";

const BINARY = process.argv[2];
if (!BINARY) {
  console.error("usage: node spike.mjs <path-to-novalis-binary>");
  process.exit(2);
}
const APP_NAME = "Novalis"; // tauri.conf.json productName
const VAULT = resolve(process.env.NOVALIS_E2E_VAULT ?? join(import.meta.dirname, ".tmp-vault"));
const NOTE = join(VAULT, "Spike.md");

setDefaultTimeout(30);

const results = [];
function record(n, title, ok, detail) {
  results.push({ n, title, ok, detail });
  console.log(`\n${ok ? "PASS" : "FAIL"}  probe ${n}: ${title}`);
  if (detail) console.log(indent(String(detail), "      "));
}
const indent = (s, p) => s.split("\n").map((l) => p + l).join("\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let child;
let app;

try {
  // ── 1 ── the process starts and stays up ────────────────────────────────
  child = spawn(BINARY, [], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const log = [];
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));
  let exited = null;
  child.on("exit", (code, signal) => {
    exited = `exit=${code} signal=${signal}`;
  });

  // The window is created in setup(); the vault opens on a background thread
  // right after, so give both a moment before asking the a11y tree about it.
  await sleep(8000);
  record(1, "app process starts and stays up", exited === null, exited ?? `pid ${child.pid}`);
  if (exited) console.log(indent(log.join("").slice(-3000), "      "));

  // ── 2 ── xa11y sees the application at all ──────────────────────────────
  try {
    app = await App.byName(APP_NAME, { timeout: 30 });
    record(2, `xa11y finds the application by name ("${APP_NAME}")`, true, `name=${app.name}`);
  } catch (e) {
    record(2, `xa11y finds the application by name ("${APP_NAME}")`, false, e.message);
    // Fall back to whatever IS visible — the name may simply differ per OS.
    try {
      const all = await App.list();
      console.log(indent(`visible apps: ${all.map((a) => a.name).join(", ")}`, "      "));
    } catch (e2) {
      console.log(indent(`App.list() also failed: ${e2.message}`, "      "));
    }
  }

  // ── 3 ── THE DECIDING PROBE: is the webview DOM in the tree? ────────────
  // If only a window frame appears, no amount of selector work rescues this
  // approach and the WebDriver route becomes the fallback.
  let dump = "";
  if (app) {
    try {
      dump = await app.dump();
      // Text that can ONLY come from our React UI, not from a window frame.
      const markers = ["Spike", "Notes", "Search", "Settings"];
      const hits = markers.filter((m) => dump.includes(m));
      record(
        3,
        "accessibility tree contains webview DOM, not just a window frame",
        hits.length > 0,
        `tree: ${dump.split("\n").length} nodes | UI markers found: ${hits.join(", ") || "NONE"}`,
      );
      console.log("\n----- accessibility tree (first 200 lines) -----");
      console.log(dump.split("\n").slice(0, 200).join("\n"));
      console.log("----- end tree -----");
    } catch (e) {
      record(3, "accessibility tree contains webview DOM", false, e.message);
    }
  }

  // ── 4 ── named elements from our own UI are addressable ─────────────────
  // The frontend has zero data-testid and 87 i18n-driven aria-labels, so this
  // probe is really asking: what can we select TODAY, before adding any.
  if (app && dump) {
    for (const sel of ["button", "text_field", "text_area", "document", "group"]) {
      try {
        const els = await app.locator(sel).elements();
        const named = els.filter((e) => e.name).slice(0, 8).map((e) => `${e.role}:${e.name}`);
        console.log(`      ${sel.padEnd(11)} ${els.length} found` + (named.length ? ` — ${named.join(", ")}` : ""));
      } catch (e) {
        console.log(`      ${sel.padEnd(11)} error: ${e.message}`);
      }
    }
    record(4, "our UI elements are enumerable by role", true, "see roles above");
  }

  // ── 5 ── text typed into the editor reaches disk ────────────────────────
  // The whole programme rests on this: OS-level synthetic input is the thing
  // the webview-plugin approaches cannot do faithfully for ProseMirror.
  const MARKER = `spike-typed-${Date.now()}`;
  if (app) {
    try {
      const before = readFileSync(NOTE, "utf8");
      // The editor is a contenteditable; roles differ per platform provider, so
      // try the plausible ones rather than guessing one.
      let target = null;
      for (const sel of ["text_area", "document", "text_field", "group[name*='editor']"]) {
        const els = await app.locator(sel).elements().catch(() => []);
        if (els.length) {
          target = { sel, el: els[0] };
          break;
        }
      }
      if (!target) throw new Error("no editable-looking element found");
      console.log(`      typing into: ${target.sel} (role=${target.el.role} name=${target.el.name})`);
      await app.locator(target.sel).focus();
      await app.locator(target.sel).typeText(MARKER);
      // Autosave debounce is 600 ms by default (EditorPane), plus the write.
      await sleep(4000);
      const after = readFileSync(NOTE, "utf8");
      record(
        5,
        "typed text reaches the note on disk",
        after.includes(MARKER),
        after === before ? "file unchanged" : `file changed by ${after.length - before.length} chars`,
      );
    } catch (e) {
      record(5, "typed text reaches the note on disk", false, e.message);
    }
  }
} catch (e) {
  console.error("\nharness error:", e);
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) child.kill("SIGTERM");
  console.log("\n===== SPIKE VERDICT =====");
  for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.n}. ${r.title}`);
  const decisive = results.find((r) => r.n === 3);
  console.log(
    `\n  Deciding probe (3): ${decisive ? (decisive.ok ? "webview DOM IS reachable" : "webview DOM NOT reachable") : "did not run"}`,
  );
  console.log(`  Platform: ${platform()} | home: ${homedir()}`);
}
