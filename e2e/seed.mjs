// Put the app into a known state BEFORE it starts, so the spike never has to
// drive the first-run flow.
//
// The first screen (VaultGate) offers "Open vault" and "Take Tour", and both
// end in a native folder dialog — `pick_vault_folder` -> `blocking_pick_folder`
// (apps/desktop/src-tauri/src/commands.rs). A native NSOpenPanel / GTK
// FileChooser / IFileDialog is not part of the webview, so no webview-level
// driver can click it. There IS a recent-vaults list that needs no dialog, but
// it is empty on a fresh CI profile. So: seed the last-vault setting, which
// lib.rs:381 reads in `setup()` and opens on a background thread.
//
// SAFETY. `settings.json` is a REAL user file — it holds `aiConnections` and
// `aiEmbedding` alongside the vault list, and nothing else backs it up. This
// script therefore refuses to touch a developer's own config directory unless
// it is told to, and even then it MERGES rather than replaces. Learned the hard
// way: an earlier version overwrote a live settings.json on a dev machine.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

const HERE = import.meta.dirname;
const IDENTIFIER = "com.novalis.desktop"; // tauri.conf.json

/** Where Tauri's `app_config_dir()` resolves for this identifier. */
function realAppConfigDir() {
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", IDENTIFIER);
    case "win32":
      return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), IDENTIFIER);
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), IDENTIFIER);
  }
}

const explicitDir = process.env.NOVALIS_E2E_CONFIG_DIR;
const onCi = process.env.CI === "true";
const cfgDir = explicitDir ? resolve(explicitDir) : realAppConfigDir();

if (!explicitDir && !onCi) {
  console.error(
    [
      "refusing to write to a real app config directory:",
      `  ${cfgDir}`,
      "",
      "That file holds your AI connections and vault list, and nothing backs it up.",
      "Set NOVALIS_E2E_CONFIG_DIR to a throwaway directory to run this locally:",
      "",
      "  NOVALIS_E2E_CONFIG_DIR=/tmp/novalis-e2e-config node e2e/seed.mjs",
      "",
      "On the app side, point the binary at it the same way Tauri resolves it",
      "(XDG_CONFIG_HOME on Linux, HOME on macOS) — see e2e/README.md.",
    ].join("\n"),
  );
  process.exit(2);
}

const vault = resolve(process.env.NOVALIS_E2E_VAULT ?? join(HERE, ".tmp-vault"));

// A pristine copy every run: the spike types into the fixture, so a reused
// vault would make the "did it reach disk" assertion pass on the last run's
// leftovers.
rmSync(vault, { recursive: true, force: true });
mkdirSync(vault, { recursive: true });
cpSync(join(HERE, "fixtures", "vault"), vault, { recursive: true });

// `ensure_features_stamp` (crates/novalis-core/src/vault/config.rs:113) rewrites
// a vault's features to the legacy all-on profile when `prefs_version` is below
// PREFS_VERSION and the vault has content — which would switch on the embedding
// model, AI and sync behind our backs. Stamping the current version short-
// circuits that at the `existing.prefs_version >= PREFS_VERSION` check, and
// every other field is `#[serde(default)]`, so this one key is the whole file.
// `Preferences` is ALSO `#[serde(rename_all = "camelCase")]`
// (models/preferences.rs:7), so the key is `prefsVersion`. Writing
// `prefs_version` is silently ignored, `prefs_version` stays 0, and the stamp
// fires anyway — which is exactly what happened, and the app said so in a log
// line nobody was reading: "vault predates the feature flags — enabling the
// legacy all-on profile". Caught only after this script started streaming the
// app's own output instead of discarding it.
mkdirSync(join(vault, ".novalis"), { recursive: true });
writeFileSync(join(vault, ".novalis", "config.json"), JSON.stringify({ prefsVersion: 1 }, null, 2));

// `Settings` is `#[serde(rename_all = "camelCase")]` (settings.rs:33), so the
// JSON key is `lastVault`, NOT `last_vault`. Writing the snake_case form is
// silently ignored — serde skips unknown fields — and the app would boot to
// VaultGate with no hint as to why.
const settingsPath = join(cfgDir, "settings.json");
let settings = {};
try {
  settings = JSON.parse(readFileSync(settingsPath, "utf8"));
} catch {
  /* missing or unparseable: start from an empty object */
}
settings.lastVault = vault;

mkdirSync(cfgDir, { recursive: true });
writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

console.log(`seeded vault:    ${vault}`);
console.log(`seeded settings: ${settingsPath} (lastVault only; other keys preserved)`);
