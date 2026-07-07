// keymapStore invariants: rebind updates the in-memory map AND persists the
// override (a fresh loadKeymap sees it); rebinding to null — or reset() —
// restores the defaults. No ipc involved; the keymap is device-local
// localStorage state.
import { beforeEach, describe, expect, it, vi } from "vitest";

// The store seeds its state from localStorage at module-eval time; Node has no
// DOM Storage (see aiStore.test.ts for the getter-only accessor detail).
const storage = vi.hoisted(() => {
  const backing = new Map<string, string>();
  const stub = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
    key: () => null,
    length: 0,
  };
  Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true });
  return stub;
});

import { DEFAULT_KEYMAP, loadKeymap } from "../../lib/keybindings";

const { useKeymap } = await import("../keymapStore");

beforeEach(() => {
  storage.clear();
  useKeymap.setState({ keymap: loadKeymap() });
});

describe("keymapStore", () => {
  it("rebind overrides one chord, persists it, and leaves the rest at default", () => {
    useKeymap.getState().rebind("search", "mod+shift+k");

    expect(useKeymap.getState().keymap.search).toBe("mod+shift+k");
    expect(useKeymap.getState().keymap["command-palette"]).toBe(
      DEFAULT_KEYMAP["command-palette"],
    );
    // Persisted device-locally: a fresh load (new session) sees the override.
    expect(loadKeymap().search).toBe("mod+shift+k");
  });

  it("rebind(null) restores that action's default", () => {
    useKeymap.getState().rebind("search", "mod+shift+k");
    useKeymap.getState().rebind("search", null);

    expect(useKeymap.getState().keymap.search).toBe(DEFAULT_KEYMAP.search);
    expect(loadKeymap().search).toBe(DEFAULT_KEYMAP.search);
  });

  it("reset restores every default", () => {
    useKeymap.getState().rebind("search", "mod+shift+k");
    useKeymap.getState().rebind("new-note", "mod+alt+n");

    useKeymap.getState().reset();

    expect(useKeymap.getState().keymap).toEqual(DEFAULT_KEYMAP);
    expect(loadKeymap()).toEqual(DEFAULT_KEYMAP);
  });
});
