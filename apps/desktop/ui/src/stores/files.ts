import { create } from "zustand";

import { commands, unwrap } from "../ipc/client";
import { isSupported } from "../lib/fileTypes";
import { isNote } from "../lib/paths";

/**
 * Every listed file in the vault, and the notes among them.
 *
 * Quick-open needs the files; `[[` completion and link resolution the notes
 * (ADR-0022: a note is `.md`, everything the tree lists is a file); and the
 * tree only knows the folders that have been opened. One `list_files` walk
 * fills both — the shell hands over every regular file it finds and the
 * file-type table decides what is kept, so an unlisted `.go` never reaches a
 * pool. Refreshed after a create, rename or trash, and by a watcher batch
 * that added or removed a listed file — never on a timer (PLAN.md §2.3 rule
 * 12).
 */

interface FilesState {
  files: string[];
  notes: string[];
  loaded: boolean;
  refresh: () => Promise<void>;
  clear: () => void;
}

export const useFiles = create<FilesState>((set) => ({
  files: [],
  notes: [],
  loaded: false,

  refresh: async () => {
    const files = (await unwrap(commands.listFiles())).filter(isSupported);
    set({ files, notes: files.filter(isNote), loaded: true });
  },

  clear: () => set({ files: [], notes: [], loaded: false }),
}));
