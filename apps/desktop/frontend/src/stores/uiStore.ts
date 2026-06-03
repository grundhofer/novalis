import { create } from "zustand";

import type { MainView } from "../components/Sidebar";
import { useVault } from "./vaultStore";

interface UiState {
  /** The top-level view being shown (notes / tasks / calendar). */
  view: MainView;
  /** Where to return to when the user drilled into a note from elsewhere
   *  (e.g. a Kanban card). null = no pending "Back" affordance. */
  returnView: MainView | null;

  /** Switch the top-level view. A deliberate switch clears any pending "Back"
   *  target — the user chose where to be. */
  setView: (view: MainView) => void;
  /** Open a note and jump to the Notes view, remembering where we came from so
   *  the editor can offer a "Back" button. */
  openNoteFrom: (path: string, from: MainView) => void;
  /** Return to the remembered view (if any) and clear the Back affordance. */
  goBack: () => void;
}

export const useUi = create<UiState>((set, get) => ({
  view: "notes",
  returnView: null,

  setView: (view) => set({ view, returnView: null }),

  openNoteFrom: (path, from) => {
    set({ view: "notes", returnView: from });
    void useVault.getState().openNote(path); // openNote flushes pending edits first
  },

  // Following links within the note view goes through vaultStore.openNote
  // directly (not this store), so the Back target survives a reading session
  // and one click still returns to where the user started.
  goBack: () => set({ view: get().returnView ?? "notes", returnView: null }),
}));
