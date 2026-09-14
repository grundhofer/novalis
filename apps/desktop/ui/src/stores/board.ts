import { create } from "zustand";

import {
  commands,
  errorKey,
  errorValues,
  NovalisError,
  unwrap,
  type BoardDto,
  type BoardRefDto,
  type CardOpDto,
  type ColumnDto,
} from "../ipc/client";
import { useUi } from "./ui";

/**
 * The Kanban pane (PLAN.md §8).
 *
 * Every card write is one replayable field change through `card_write`; the
 * store never computes an order key (fractional indexing lives in
 * `novalis_core::boards::order`) and never writes a note to update a card
 * (§2.3 rule 10). Because the writes are field-level and replayed on conflict,
 * a board that changed under us never raises a banner (§5.3 step 5) — we just
 * take the document the write returns.
 */

export interface BoardNotice {
  cards: number;
  columns: boolean;
}

interface BoardState {
  boards: BoardRefDto[];
  slug: string | null;
  board: BoardDto | null;
  busy: boolean;
  /**
   * Per board, what its first read after the vault was opened resolved
   * (§8.4): how many cards, and whether `board.json` itself. The shell
   * reports that on the one read that resolves and on no other, so it is
   * kept here: the first version showed it from the board document, and the
   * refresh that follows the shell's own renames replaced the document with
   * one that had nothing to say.
   */
  notices: Record<string, BoardNotice>;

  setBoards: (boards: BoardRefDto[]) => void;
  load: (slug: string) => Promise<void>;
  dismissNotice: (slug: string) => void;
  refresh: () => Promise<void>;
  /**
   * Re-read the list of boards. `setBoards` is what the vault open brings;
   * this is for a board that appeared or went since — `novalis board create`
   * from the CLI, or a sync client — which the watcher reports.
   */
  refreshList: () => Promise<void>;
  apply: (op: CardOpDto) => Promise<void>;
  createBoard: (slug: string, name: string) => Promise<void>;
  setColumns: (columns: ColumnDto[]) => Promise<void>;
  renameBoard: (name: string) => Promise<void>;
}

export const useBoard = create<BoardState>((set, get) => ({
  boards: [],
  slug: null,
  board: null,
  busy: false,
  notices: {},

  // Called when a vault is opened: nothing of the previous vault's board may
  // outlive it — not the document the pane showed, and not a notice, since
  // the shell starts resolving afresh for the new vault. Opening a vault
  // used to reset the list only, so the pane kept showing the old vault's
  // board until the user picked one of the new vault's.
  setBoards: (boards) => set({ boards, slug: null, board: null, notices: {} }),

  load: async (slug) => {
    const previous = get().slug;
    set({ busy: true, slug });
    try {
      const board = await unwrap(commands.boardRead(slug));
      set((s) => ({
        board,
        notices:
          board.resolvedConflicts > 0 || board.resolvedColumns
            ? {
                ...s.notices,
                [board.slug]: { cards: board.resolvedConflicts, columns: board.resolvedColumns },
              }
            : s.notices,
      }));
      // Not a failed command — the board came back — but a failed tidy-up is
      // reported the same way, because silence is how it went unnoticed.
      if (board.resolveError) {
        const error = new NovalisError(board.resolveError);
        useUi.getState().showToast(errorKey(error), errorValues(error));
      }
    } catch (error) {
      // The board that could not be read is not the active one. Left as it
      // was, the pane kept showing the previous board while every write went
      // to this slug, and at boot the missing board was saved back to
      // `state.json` and failed again at every start. The UI's `activeBoard`
      // follows, because the callers set it before they call this.
      set({ slug: previous });
      useUi.getState().setActiveBoard(previous);
      throw error;
    } finally {
      set({ busy: false });
    }
  },

  dismissNotice: (slug) =>
    set((s) => {
      const notices = { ...s.notices };
      delete notices[slug];
      return { notices };
    }),

  refresh: async () => {
    const slug = get().slug;
    if (slug) await get().load(slug);
  },

  refreshList: async () => {
    const boards = await unwrap(commands.boardList());
    set({ boards: [...boards].sort((a, b) => a.name.localeCompare(b.name)) });
  },

  apply: async (op) => {
    const slug = get().slug;
    if (!slug) return;
    await unwrap(commands.cardWrite(slug, op));
    // One re-read after the write: the card store is small, and re-reading is
    // how a replayed conflict becomes visible without a second source of truth.
    await get().load(slug);
  },

  createBoard: async (slug, name) => {
    const ref = await unwrap(commands.boardCreate(slug, name));
    set((s) => ({ boards: [...s.boards, ref].sort((a, b) => a.name.localeCompare(b.name)) }));
    await get().load(ref.slug);
  },

  setColumns: async (columns) => {
    const slug = get().slug;
    if (!slug) return;
    set({ board: await unwrap(commands.boardWrite(slug, null, columns)) });
  },

  renameBoard: async (name) => {
    const slug = get().slug;
    if (!slug) return;
    const board = await unwrap(commands.boardWrite(slug, name, null));
    set((s) => ({
      board,
      boards: s.boards.map((b) => (b.slug === slug ? { ...b, name } : b)),
    }));
  },
}));
