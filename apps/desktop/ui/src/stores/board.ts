import { create } from "zustand";

import {
  commands,
  unwrap,
  type BoardDto,
  type BoardRefDto,
  type CardOpDto,
  type ColumnDto,
} from "../ipc/client";

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

interface BoardState {
  boards: BoardRefDto[];
  slug: string | null;
  board: BoardDto | null;
  busy: boolean;

  setBoards: (boards: BoardRefDto[]) => void;
  load: (slug: string) => Promise<void>;
  refresh: () => Promise<void>;
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

  setBoards: (boards) => set({ boards }),

  load: async (slug) => {
    set({ busy: true, slug });
    try {
      set({ board: await unwrap(commands.boardRead(slug)) });
    } finally {
      set({ busy: false });
    }
  },

  refresh: async () => {
    const slug = get().slug;
    if (slug) await get().load(slug);
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
