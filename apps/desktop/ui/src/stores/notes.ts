import { create } from "zustand";

import { commands, unwrap } from "../ipc/client";

/**
 * Every note path in the vault.
 *
 * Quick-open, `[[` completion and the board's note picker all need the whole
 * list, and the tree only knows the folders that have been opened. One
 * `list_notes` walk fills this; it is refreshed after a create, rename or
 * trash, and by a watcher batch that added or removed a `.md` file — never on
 * a timer (PLAN.md §2.3 rule 12).
 */

interface NotesState {
  paths: string[];
  loaded: boolean;
  refresh: () => Promise<void>;
  clear: () => void;
}

export const useNotes = create<NotesState>((set) => ({
  paths: [],
  loaded: false,

  refresh: async () => {
    const paths = await unwrap(commands.listNotes());
    set({ paths, loaded: true });
  },

  clear: () => set({ paths: [], loaded: false }),
}));
