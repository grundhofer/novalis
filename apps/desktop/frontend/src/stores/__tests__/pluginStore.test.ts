// The plugin RPC path guard. A capability such as `notes:write` names a KIND
// of access, not a SCOPE — before this guard existed, a plugin holding it could
// write `.novalis/plugins/<id>/main.js` (auto-loaded into a Worker on the next
// vault open), `.novalis/config.json` (the feature flags that enable plugins in
// the first place) or `.git/config` (the remote the whole vault is pushed to).
// The same rule is enforced in Rust by `vault_fs::vault_note_rel`; this is the
// frontend half, where plugins actually cross the boundary.
import { describe, expect, it } from "vitest";

import type { PluginInfo } from "../../ipc/api";
import { PLUGIN_API_VERSION, PLUGIN_CAPABILITIES } from "../../ipc/bindings";
import { apiVersionOf, CAP, assertNotePath, missingCapability } from "../pluginStore";

const PLUGIN = "evil";

function plugin(
  capabilities: string[],
  grantedCapabilities: string[],
  manifest: Partial<PluginInfo["manifest"]> = {},
): PluginInfo {
  return {
    manifest: { id: PLUGIN, name: "Evil", capabilities, ...manifest },
    enabled: true,
    grantedCapabilities,
  };
}

describe("assertNotePath", () => {
  it("accepts ordinary note paths", () => {
    expect(assertNotePath(PLUGIN, "note.md")).toBe("note.md");
    expect(assertNotePath(PLUGIN, "folder/sub/note.md")).toBe("folder/sub/note.md");
    expect(assertNotePath(PLUGIN, "Ordner mit Leerzeichen/Notiz — ü.md")).toContain(".md");
  });

  it.each([
    ".novalis/plugins/evil/main.js",
    ".novalis/plugins/evil/plugin.json",
    ".novalis/plugins-enabled.json",
    ".novalis/config.json",
    ".git/config",
    "notes/.hidden/x.md",
    ".hidden.md",
  ])("rejects the hidden path %s", (path) => {
    expect(() => assertNotePath(PLUGIN, path)).toThrow(/hidden segment/);
  });

  it("rejects backslash-separated hidden segments too", () => {
    // Path parsing must not depend on the host separator: a Windows-style
    // separator would otherwise slip a dot-segment past a `/`-only split.
    expect(() => assertNotePath(PLUGIN, ".novalis\\plugins\\evil\\main.js")).toThrow(
      /hidden segment/,
    );
    expect(() => assertNotePath(PLUGIN, "notes\\.hidden\\x.md")).toThrow(/hidden segment/);
  });

  it.each(["shell.sh", "notes/script.js", "note", "note.md.js"])(
    "rejects the non-markdown path %s",
    (path) => {
      expect(() => assertNotePath(PLUGIN, path)).toThrow(/must end in \.md/);
    },
  );

  it.each([["", "empty"], [undefined, "undefined"], [null, "null"], [42, "number"]])(
    "rejects a %s path (%s)",
    (path, _kind) => {
      expect(() => assertNotePath(PLUGIN, path)).toThrow(/non-empty string/);
    },
  );

  it("names the plugin in the error so the user can tell who tried", () => {
    expect(() => assertNotePath("suspicious-plugin", ".git/config")).toThrow(
      /suspicious-plugin/,
    );
  });
});

// The capability check. Before the grant store existed this gated host calls on
// `manifest.capabilities` alone — the plugin's own file — so a plugin that
// listed everything got everything, and PLUGINS.md described that as a
// permission model. A capability now needs both halves: asked for AND granted.
describe("missingCapability", () => {
  it("allows a call whose capability is both requested and granted", () => {
    expect(missingCapability(plugin(["notes:read"], ["notes:read"]), "notes.get")).toBeNull();
  });

  it("refuses a capability the manifest asks for but the user never granted", () => {
    // The whole point: a manifest cannot grant itself anything.
    expect(missingCapability(plugin(["notes:write"], []), "notes.create")).toBe("notes:write");
    expect(missingCapability(plugin(["search"], ["notes:read"]), "search")).toBe("search");
  });

  it("refuses a capability that was granted but is no longer requested", () => {
    // A stale grant is not access either — the intersection is symmetric, so
    // trimming a manifest narrows the plugin immediately.
    expect(missingCapability(plugin([], ["tasks:write"]), "tasks.create")).toBe("tasks:write");
  });

  it("allows methods that need no capability, and refuses unknown methods elsewhere", () => {
    // `notify` is not in CAP: it never reaches the host API, it only posts a
    // toast, so there is nothing to gate.
    expect(CAP["notify"]).toBeUndefined();
    expect(missingCapability(plugin([], []), "notify")).toBeNull();
  });

  it("enforces exactly the capability set Rust documents", () => {
    // The Rust docs used to name a `notify` capability that was never enforced
    // and omit `tasks:write`, which was — a plugin author reading them wrote a
    // plugin that failed at runtime. Both sides now come from one constant.
    const enforced = new Set(Object.values(CAP).filter((c) => c !== null));
    expect([...enforced].sort()).toEqual([...PLUGIN_CAPABILITIES].sort());
  });
});

describe("apiVersionOf", () => {
  it("takes the manifest's declared version", () => {
    expect(apiVersionOf(plugin([], [], { apiVersion: 7 }))).toBe(7);
  });

  it("treats a manifest without apiVersion as API 1", () => {
    // Every manifest written before the field existed targeted API 1, so the
    // fallback is that literal — not the current version, which would wave
    // those plugins through a future breaking change.
    expect(apiVersionOf(plugin([], []))).toBe(1);
  });

  it("is compatible with this build today", () => {
    expect(PLUGIN_API_VERSION).toBe(1);
  });
});
