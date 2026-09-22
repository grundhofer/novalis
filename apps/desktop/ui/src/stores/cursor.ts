import { create } from "zustand";

/**
 * Where the editor's cursor is, for the status bar (PLAN.md §5.3 "words ·
 * line:col · cloud state"): the main cursor's line and column, how many
 * characters are selected over all ranges, and how many cursors there are.
 * The editor writes it on every selection change, only when a value moved.
 */
export interface Cursor {
  path: string;
  line: number;
  column: number;
  selected: number;
  cursors: number;
}

interface CursorStore {
  cursor: Cursor | null;
  set: (next: Cursor) => void;
  clear: (path: string) => void;
}

export const useCursor = create<CursorStore>((set, get) => ({
  cursor: null,
  set: (next) => {
    const now = get().cursor;
    if (
      now &&
      now.path === next.path &&
      now.line === next.line &&
      now.column === next.column &&
      now.selected === next.selected &&
      now.cursors === next.cursors
    ) {
      return;
    }
    set({ cursor: next });
  },
  clear: (path) => {
    if (get().cursor?.path === path) set({ cursor: null });
  },
}));
