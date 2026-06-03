import { create } from "zustand";

import { api, type ConflictFile, type ResolveConflictRequest } from "../ipc/api";
import { useVault } from "./vaultStore";

// Sync-conflict files (e.g. OneDrive "Note (1).md") detected in the vault. The
// backend does all the work (scan / diff / resolve); this store just holds the
// current list and re-scans after a resolution or a watcher event.
interface ConflictState {
  conflicts: ConflictFile[];
  scan: () => Promise<void>;
  resolve: (req: ResolveConflictRequest) => Promise<void>;
}

export const useConflicts = create<ConflictState>((set) => ({
  conflicts: [],

  scan: async () => {
    try {
      set({ conflicts: await api.listConflicts() });
    } catch {
      // noVault (engine not ready yet) — keep the current list.
    }
  },

  resolve: async (req) => {
    await api.resolveConflict(req);
    set({ conflicts: await api.listConflicts() });
    // A "promote"/"both" resolution changes files on disk; refresh the tree.
    await useVault.getState().refreshTree();
  },
}));
