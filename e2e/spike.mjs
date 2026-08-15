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

// CommonJS package (no "type", no "exports" map), so named ESM imports are at
// the mercy of Node's cjs-module-lexer — it resolves `App` but not
// `setDefaultTimeout`, which fails at load with a SyntaxError. Default-import
// the namespace and destructure instead; that always works for CJS.
import xa11y from "@crowecawcaw/xa11y";

const { App, setDefaultTimeout } = xa11y;

const BINARY = process.argv[2];
if (!BINARY) {
  console.error("usage: node spike.mjs <path-to-novalis-binary>");
  process.exit(2);
}
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
  // By PID, not by name. The a11y tree registers the app under its BINARY name
  // (`novalis-desktop`), not tauri.conf.json's productName (`Novalis`) — at
  // least on Linux, and there is no reason to assume the three platforms agree.
  // We spawned the process, so its pid is exact and needs no per-OS guesswork.
  try {
    app = await App.byPid(child.pid, { timeout: 30 });
    record(2, `xa11y finds the application by pid (${child.pid})`, true, `name=${app.name}`);
  } catch (e) {
    record(2, `xa11y finds the application by pid (${child.pid})`, false, e.message);
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
  //
  // Assert on STRUCTURE, not on text. The first version looked for strings
  // ("Notes", "Search") and reported a false negative on Linux: AT-SPI exposes
  // our buttons by name but leaves the `static_text` leaves empty, where the
  // macOS AX provider carries their values. A `web_area` plus at least one
  // button named by our own UI is the portable form of "we are inside the DOM".
  let dump = "";
  if (app) {
    try {
      dump = await app.dump();
      const hasWebArea = /\bweb_area\b/.test(dump);
      const ourButtons = (await app.locator("button").elements().catch(() => []))
        .map((e) => e.name)
        .filter(Boolean);
      record(
        3,
        "accessibility tree contains webview DOM, not just a window frame",
        hasWebArea && ourButtons.length > 0,
        `tree: ${dump.split("\n").length} nodes | web_area: ${hasWebArea} | named buttons: ${ourButtons.length}`,
      );
      console.log("\n----- accessibility tree -----");
      console.log(dump.split("\n").slice(0, 250).join("\n"));
      console.log("----- end tree -----");
    } catch (e) {
      record(3, "accessibility tree contains webview DOM", false, e.message);
    }
  }

  // ── 3b ── get past onboarding ───────────────────────────────────────────
  // Seeding `lastVault` boots the app into the workspace, but the onboarding
  // modal is keyed on localStorage in the webview's own profile, which no
  // pre-seed can reach. Dismissing it is both a prerequisite and a genuine
  // first E2E assertion — it is the app's real entry path.
  if (app) {
    try {
      const dismiss = ["Explore on my own", "Close", "Continue"];
      let clicked = null;
      for (const name of dismiss) {
        const hits = await app.locator(`button[name='${name}']`).elements().catch(() => []);
        if (hits.length) {
          await app.locator(`button[name='${name}']`).press();
          clicked = name;
          break;
        }
      }
      await sleep(3000);
      record(
        "3b",
        "onboarding can be dismissed through the a11y tree",
        clicked !== null,
        clicked ? `pressed "${clicked}"` : "no onboarding button found (already dismissed?)",
      );
      console.log("\n----- tree AFTER dismissing onboarding -----");
      console.log((await app.dump()).split("\n").slice(0, 250).join("\n"));
      console.log("----- end tree -----");
    } catch (e) {
      record("3b", "onboarding can be dismissed through the a11y tree", false, e.message);
    }
  }

  // ── 4 ── what is addressable, and which role is the editor? ─────────────
  // The frontend has zero data-testid and its aria-labels are i18n-driven, so
  // this probe is really asking: what can we select TODAY, before adding any —
  // and, critically, what ROLE does a ProseMirror contenteditable surface as on
  // each platform. That mapping is not documented anywhere; it has to be read
  // off a real tree.
  const EDITABLE_ROLES = ["text_area", "document", "text_field", "web_area", "section", "group"];
  if (app) {
    for (const sel of ["button", "text_field", "text_area", "document", "heading", "group"]) {
      try {
        const els = await app.locator(sel).elements();
        const named = els.filter((e) => e.name).slice(0, 10).map((e) => `${e.role}:${e.name}`);
        console.log(`      ${sel.padEnd(11)} ${els.length} found` + (named.length ? ` — ${named.join(" | ")}` : ""));
      } catch (e) {
        console.log(`      ${sel.padEnd(11)} error: ${e.message}`);
      }
    }
    // Anything the provider reports as editable is the real prize — print the
    // whole set rather than picking one, so a failed run still teaches us the
    // mapping.
    try {
      const all = await app.locator("*").elements().catch(() => []);
      const editable = all
        .filter((e) => e.editable === true || (e.actions ?? []).includes("set_value"))
        .map((e) => `${e.role}:${e.name ?? ""}`);
      console.log(`      EDITABLE-flagged: ${editable.length ? editable.join(" | ") : "none"}`);
    } catch (e) {
      console.log(`      editable scan failed: ${e.message}`);
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
      // Prefer whatever the provider itself flags editable; only then fall back
      // to role guesses. The note-list filter box ("Filter notes…") is also a
      // text_field, and an earlier run happily typed the marker into it — so
      // anything that looks like a search/filter field is excluded by name.
      const all = await app.locator("*").elements().catch(() => []);
      const isFilter = (n) => /filter|search|suche/i.test(n ?? "");
      let target =
        all.find((e) => (e.editable === true || (e.actions ?? []).includes("set_value")) && !isFilter(e.name)) ?? null;
      if (!target) {
        for (const role of ["text_area", "document"]) {
          const hit = all.find((e) => e.role === role && !isFilter(e.name));
          if (hit) {
            target = hit;
            break;
          }
        }
      }
      if (!target) throw new Error("no editable element found (see the role dump above)");
      const sel = `${target.role}${target.name ? `[name='${target.name}']` : ""}`;
      console.log(`      typing into: ${sel} (editable=${target.editable})`);
      await app.locator(sel).focus();
      await app.locator(sel).typeText(MARKER);
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
