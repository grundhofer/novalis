// Progressive probes against the real, running app. Every probe runs and
// reports even when an earlier one failed — a partial answer is still an
// answer, and the tree dumps are useful precisely on the runs where the last
// probe does not work yet.
//
// Exit code is 0 unless the harness itself broke. Probe outcomes are reported,
// not thrown: this is a spike whose job is to produce a verdict, not a gate.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { platform } from "node:os";
import { join, resolve } from "node:path";

// CommonJS package (no "type", no "exports" map), so named ESM imports are at
// the mercy of Node's cjs-module-lexer — it resolves `App` but not
// `setDefaultTimeout`, which fails at load with a SyntaxError. Default-import
// the namespace and destructure instead; that always works for CJS.
import xa11y from "@crowecawcaw/xa11y";

const { App, inputSim, setDefaultTimeout } = xa11y;

// `inputSim` is a factory, not an instance: `inputSim()` returns the
// InputSim carrying click/typeText/press. Calling `inputSim.click(...)`
// fails with "is not a function", which cost a full CI round.
const sim = inputSim();

const BINARY = process.argv[2];
if (!BINARY) {
  console.error("usage: node spike.mjs <path-to-novalis-binary>");
  process.exit(2);
}
const VAULT = resolve(process.env.NOVALIS_E2E_VAULT ?? join(import.meta.dirname, ".tmp-vault"));
const NOTE = join(VAULT, "Spike.md");
const MARKER = `spike-typed-${Date.now()}`;

setDefaultTimeout(30);

const results = [];
const indent = (s, p) => String(s).split("\n").map((l) => p + l).join("\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function record(n, title, ok, detail) {
  results.push({ n, title, ok });
  console.log(`\n${ok ? "PASS" : "FAIL"}  probe ${n}: ${title}`);
  if (detail) console.log(indent(detail, "      "));
}
async function dumpTree(app, label) {
  const t = await app.dump();
  console.log(`\n----- ${label} (${t.split("\n").length} nodes) -----`);
  console.log(t.split("\n").slice(0, 220).join("\n"));
  console.log("----- end -----");
  return t;
}
/** Poll until `check(tree)` holds. A fixed sleep is not enough: an 8s wait gave
 *  macOS a 4-node tree on one run and a complete one on the next. */
async function waitForTree(app, check, { timeoutMs = 60000, label = "" } = {}) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    last = await app.dump().catch(() => "");
    if (check(last)) return last;
    await sleep(1000);
  }
  console.log(`      waitForTree timed out after ${timeoutMs}ms${label ? ` (${label})` : ""}`);
  return last;
}

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
  await sleep(3000);
  record(1, "app process starts and stays up", exited === null, exited ?? `pid ${child.pid}`);
  if (exited) console.log(indent(log.join("").slice(-3000), "      "));

  // ── 2 ── xa11y sees the application ─────────────────────────────────────
  // By PID, not by name: the tree registers the app under its BINARY name
  // (`novalis-desktop`), not tauri.conf.json's productName. We spawned it, so
  // the pid is exact and needs no per-OS guesswork.
  try {
    app = await App.byPid(child.pid, { timeout: 45 });
    record(2, `xa11y finds the application by pid (${child.pid})`, true, `name=${app.name}`);
  } catch (e) {
    record(2, `xa11y finds the application by pid (${child.pid})`, false, e.message);
    const all = await App.list().catch(() => []);
    console.log(indent(`visible apps: ${all.map((a) => a.name).join(", ")}`, "      "));
  }

  // ── 3 ── THE DECIDING PROBE: is the webview DOM in the tree? ────────────
  // Assert on STRUCTURE, not on text: AT-SPI names our buttons but leaves the
  // `static_text` leaves empty, where the macOS AX provider carries their
  // values, so a text-based check reports a false negative on Linux.
  if (app) {
    try {
      const tree = await waitForTree(app, (t) => /\bweb_area\b/.test(t) && /button "[^"]+"/.test(t), {
        label: "web_area with a named button",
      });
      await dumpTree(app, "tree at startup");
      const buttons = (await app.locator("button").elements().catch(() => [])).filter((e) => e.name);
      record(
        3,
        "accessibility tree contains webview DOM, not just a window frame",
        /\bweb_area\b/.test(tree) && buttons.length > 0,
        `web_area: ${/\bweb_area\b/.test(tree)} | named buttons: ${buttons.length}`,
      );
    } catch (e) {
      record(3, "accessibility tree contains webview DOM", false, e.message);
    }
  }

  // ── 4 ── get past onboarding into the workspace ─────────────────────────
  // Seeding `lastVault` boots the app past VaultGate, but the onboarding modal
  // is keyed on localStorage in the webview's own profile, which no pre-seed
  // can reach. Clicking it is both a prerequisite and a real E2E assertion.
  if (app) {
    try {
      let clicked = null;
      // "Close" is deliberately NOT in this list. On Windows the app tree is
      // a subtree of Edge's and the window frame contributes its own
      // button "Close" — pressing that would kill the app mid-run and look
      // like a product failure. Our own two buttons are enough.
      for (const name of ["Explore on my own", "Continue"]) {
        if ((await app.locator(`button[name='${name}']`).elements().catch(() => [])).length) {
          await app.locator(`button[name='${name}']`).press();
          clicked = name;
          break;
        }
      }
      // The workspace is up once the sidebar exists.
      const tree = await waitForTree(app, (t) => t.includes("Main navigation"), { label: "workspace" });
      await dumpTree(app, "tree after dismissing onboarding");
      record(
        4,
        "onboarding dismisses and the workspace renders",
        tree.includes("Main navigation"),
        clicked ? `pressed "${clicked}"` : "no onboarding button found (already dismissed?)",
      );
    } catch (e) {
      record(4, "onboarding dismisses and the workspace renders", false, e.message);
    }
  }

  // ── 5 ── open the fixture note ──────────────────────────────────────────
  // The file tree lists it as `group "Spike.md"`, not a button, so element
  // `press()` may not apply — click it at the OS level instead.
  if (app) {
    try {
      // Role and name both differ per provider: Linux exposes it as
      // `group "Spike.md"`, Windows as `tree_item "Spike"`. Match on the
      // name prefix across every role rather than pinning either shape.
      const all = await app.locator("*").elements().catch(() => []);
      // File-tree rows now carry an explicit `aria-label` ("Note: <path>"),
      // which is the only name form all three providers agree on — macOS
      // names nothing from `title`, which is what the row relied on before.
      const hit =
        all.find((e) => /^Note: .*Spike\.md$/.test(e.name ?? "")) ??
        all.find((e) => /^Spike(\.md)?$/.test(e.name ?? ""));
      if (!hit) throw new Error("no element named Spike/Spike.md in the tree");
      console.log(`      opening: role=${hit.role} name=${JSON.stringify(hit.name)}`);
      await sim.click(hit);
      // The editor mounts asynchronously; wait for the note's own text.
      const tree = await waitForTree(app, (t) => t.includes("Spike") && !t.includes("Welcome to Novalis"), {
        label: "note open",
      });
      await dumpTree(app, "tree with the note open");
      record(5, "the fixture note opens from the file tree", true, `tree has ${tree.split("\n").length} nodes`);
    } catch (e) {
      record(5, "the fixture note opens from the file tree", false, e.message);
    }
  }

  // ── 6 ── THE PROGRAMME'S REAL QUESTION: does typing reach disk? ─────────
  // Element-level `typeText` is the wrong tool here and the last run said so
  // outright — Windows answered "Text value not supported for this element",
  // and no platform flags a ProseMirror contenteditable as editable at all.
  // `inputSim` is OS-level synthetic input (CGEvent / SendInput / AT-SPI), so
  // the keystrokes are trusted and travel the same path a user's do. That is
  // exactly what a ProseMirror editor needs and what an in-webview
  // `execCommand('insertText')` cannot give.
  if (app) {
    try {
      const before = readFileSync(NOTE, "utf8");
      // Click by COORDINATES, not by element. The editor region carries no
      // accessible name — giving it one is real work on the app side, and the
      // point of this spike is to find out whether that work would pay off
      // before doing it. The tree is also transient right here: opening the
      // note collapsed it to 6 nodes with a single `unknown` on the last run,
      // so an element reference taken now may be stale by the time it is used.
      //
      // A coordinate is immune to both. The sidebar occupies the left third,
      // so 70% across and halfway down lands in the note body.
      // The note body now carries an accessible name (`aria-label` on a
      // role=region wrapper in EditorPane), so aim at the element. The
      // coordinate fallback stays for the case where the name is missing —
      // it is what distinguished "the click missed" from "ProseMirror
      // refused" while there was nothing to aim at.
      const named = (await app.locator("*").elements().catch(() => [])).find((e) =>
        /^Note body/.test(e.name ?? ""),
      );
      let clickTarget;
      if (named) {
        clickTarget = named;
        console.log(`      clicking named region: ${named.role} ${JSON.stringify(named.name)}`);
      } else {
        const area =
          (await app.locator("web_area").elements().catch(() => []))[0] ??
          (await app.locator("window").elements().catch(() => []))[0];
        const b = area?.bounds;
        if (!b) throw new Error("no named editor region and no bounds to fall back on");
        clickTarget = [Math.round(b.x + b.width * 0.7), Math.round(b.y + b.height * 0.5)];
        console.log(`      no named region; falling back to coordinate ${JSON.stringify(clickTarget)}`);
      }
      await sim.click(clickTarget);
      await sleep(800);
      // Type at the end of the document so nothing existing is overwritten.
      // Modifier names are capitalised — "Ctrl"/"Meta", not "ctrl"/"cmd" — and
      // the binding rejects an unknown one by throwing SYNCHRONOUSLY, so a
      // trailing `.catch()` never sees it. try/catch, and keep going: landing
      // mid-document still proves whether keystrokes arrive at all.
      try {
        await sim.chord("End", [platform() === "darwin" ? "Meta" : "Ctrl"]);
      } catch (e) {
        console.log(`      could not jump to end (${e.message}); typing at the caret instead`);
      }
      await sleep(300);
      await sim.typeText(MARKER);
      // EditorPane debounces at 600ms, then the write goes through saveNote.
      await sleep(5000);
      const after = readFileSync(NOTE, "utf8");
      record(
        6,
        "text typed at the OS level reaches the note on disk",
        after.includes(MARKER),
        after === before
          ? "file unchanged"
          : `file changed by ${after.length - before.length} chars; contains marker: ${after.includes(MARKER)}`,
      );
      if (!after.includes(MARKER)) {
        console.log(indent(`--- note on disk ---\n${after.slice(0, 800)}`, "      "));
      }
    } catch (e) {
      record(6, "text typed at the OS level reaches the note on disk", false, e.message);
    }
  }
} catch (e) {
  console.error("\nharness error:", e);
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) child.kill("SIGTERM");
  console.log("\n===== SPIKE VERDICT =====");
  for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.n}. ${r.title}`);
  const dom = results.find((r) => r.n === 3);
  const typed = results.find((r) => r.n === 6);
  console.log(`\n  webview DOM reachable: ${dom ? (dom.ok ? "YES" : "NO") : "not run"}`);
  console.log(`  typing reaches disk:   ${typed ? (typed.ok ? "YES" : "NO") : "not run"}`);
  console.log(`  Platform: ${platform()}`);
}
