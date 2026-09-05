import { create } from "zustand";

import { useEditorSave } from "./editorSave";
import { useVault } from "./vault";

/**
 * Open tabs, the back/forward history and the reopen-closed stack.
 *
 * A tab is just a path: the buffer and its save state live in `editorSave`.
 * Closing flushes the buffer first and never blocks (D19).
 */

const MAX_CLOSED = 20;
const MAX_HISTORY = 100;

interface TabsState {
  tabs: string[];
  active: string | null;
  closed: string[];
  history: string[];
  historyIndex: number;

  restore: (tabs: string[], active: string | null) => void;
  open: (path: string, options?: { background?: boolean }) => Promise<void>;
  activate: (path: string) => Promise<void>;
  close: (path: string) => Promise<void>;
  closeActive: () => Promise<void>;
  reopenClosed: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  goto: (index: number) => Promise<void>;
  back: () => Promise<void>;
  forward: () => Promise<void>;
  rename: (from: string, to: string) => void;
}

export const useTabs = create<TabsState>((set, get) => ({
  tabs: [],
  active: null,
  closed: [],
  history: [],
  historyIndex: -1,

  restore: (tabs, active) => set({ tabs, active, history: active ? [active] : [], historyIndex: active ? 0 : -1 }),

  open: async (path, options) => {
    await useEditorSave.getState().open(path);
    set((s) => ({ tabs: s.tabs.includes(path) ? s.tabs : [...s.tabs, path] }));
    if (options?.background) return;
    await get().activate(path);
    // Opening from quick-open or a link should show where the note lives.
    useVault.getState().select(path);
    void useVault.getState().reveal(path);
  },

  activate: async (path) => {
    const previous = get().active;
    if (previous && previous !== path) await useEditorSave.getState().save(previous);
    set((s) => {
      if (s.active === path) return s;
      const history = [...s.history.slice(0, s.historyIndex + 1), path].slice(-MAX_HISTORY);
      return { active: path, history, historyIndex: history.length - 1 };
    });
  },

  close: async (path) => {
    await useEditorSave.getState().close(path);
    set((s) => {
      const index = s.tabs.indexOf(path);
      const tabs = s.tabs.filter((t) => t !== path);
      const active =
        s.active === path ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : s.active;
      return {
        tabs,
        active,
        closed: [path, ...s.closed.filter((p) => p !== path)].slice(0, MAX_CLOSED),
        history: s.history.filter((p) => p !== path),
        historyIndex: Math.max(-1, s.historyIndex - 1),
      };
    });
  },

  closeActive: async () => {
    const active = get().active;
    if (active) await get().close(active);
  },

  reopenClosed: async () => {
    const [path, ...rest] = get().closed;
    if (!path) return;
    set({ closed: rest });
    await get().open(path);
  },

  next: async () => {
    const { tabs, active } = get();
    if (tabs.length === 0) return;
    const index = active ? tabs.indexOf(active) : -1;
    await get().activate(tabs[(index + 1) % tabs.length] as string);
  },

  previous: async () => {
    const { tabs, active } = get();
    if (tabs.length === 0) return;
    const index = active ? tabs.indexOf(active) : 0;
    await get().activate(tabs[(index - 1 + tabs.length) % tabs.length] as string);
  },

  goto: async (index) => {
    const target = get().tabs[index - 1];
    if (target) await get().activate(target);
  },

  back: async () => {
    const { history, historyIndex } = get();
    if (historyIndex <= 0) return;
    const path = history[historyIndex - 1];
    if (!path) return;
    set({ historyIndex: historyIndex - 1 });
    await useEditorSave.getState().open(path);
    set((s) => ({ active: path, tabs: s.tabs.includes(path) ? s.tabs : [...s.tabs, path] }));
  },

  forward: async () => {
    const { history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;
    const path = history[historyIndex + 1];
    if (!path) return;
    set({ historyIndex: historyIndex + 1 });
    await useEditorSave.getState().open(path);
    set((s) => ({ active: path, tabs: s.tabs.includes(path) ? s.tabs : [...s.tabs, path] }));
  },

  rename: (from, to) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t === from ? to : t)),
      active: s.active === from ? to : s.active,
      history: s.history.map((t) => (t === from ? to : t)),
    })),
}));
