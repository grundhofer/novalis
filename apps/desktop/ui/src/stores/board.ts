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
  type PositionDto,
} from "../ipc/client";
import { useUi } from "./ui";
import { useVault } from "./vault";

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

/**
 * The drag payload types of ADR-0019, distinct from the `text/plain` a file
 * row carries: the tree tells a board, a card and a file apart by
 * `dataTransfer.types`, so a file dropped on a board row and a board dropped
 * on a folder both do nothing. The pane sets the card type, the tree sets the
 * board type and reads both; one place names them.
 */
export const BOARD_DRAG_TYPE = "application/x-novalis-board";
export const CARD_DRAG_TYPE = "application/x-novalis-card";
/**
 * A file row of the tree, beside its `text/plain` path (ADR-0040): dropped
 * on a note, it becomes a link there.
 */
export const ENTRY_DRAG_TYPE = "application/x-novalis-entry";

export interface BoardNotice {
  cards: number;
  columns: boolean;
}

interface BoardState {
  boards: BoardRefDto[];
  /**
   * The current board: the one last opened (tree, palette, a link, a
   * backlink), which the palette's card commands and `state.json`'s
   * `activeBoard` mean. `board` is its document, the same as `docs[slug]`.
   */
  slug: string | null;
  board: BoardDto | null;
  /**
   * Every board read so far, by slug: the boards view shows them all, one
   * under the other (ADR-0054).
   */
  docs: Record<string, BoardDto>;
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
  /**
   * `background` for a read no action of the user started (a watcher batch,
   * the boot): its failed tidy-up is then a failure without a trigger
   * (spec/02 §4.17, D102 (11)).
   */
  load: (slug: string, background?: boolean) => Promise<void>;
  /** Read one board into `docs` without making it current (ADR-0054). */
  read: (slug: string, background?: boolean) => Promise<void>;
  /** Read every listed board that was not read yet: the boards view shows all. */
  readAll: (background?: boolean) => Promise<void>;
  dismissNotice: (slug: string) => void;
  /**
   * Re-read boards after a watcher batch — the given ones, else every one
   * read so far; see `load`'s `background`.
   */
  refresh: (slugs?: string[]) => Promise<void>;
  /**
   * Re-read the list of boards. `setBoards` is what the vault open brings;
   * this is for a board that appeared or went since — `novalis board create`
   * from the CLI, or a sync client — which the watcher reports.
   */
  refreshList: () => Promise<void>;
  /**
   * One card write, on `slug`, else on the board that holds the card the op
   * names, else on the current board.
   */
  apply: (op: CardOpDto, slug?: string) => Promise<void>;
  createBoard: (slug: string, name: string) => Promise<void>;
  /** The column list of `slug`, else of the current board. */
  setColumns: (columns: ColumnDto[], slug?: string) => Promise<void>;
  /** The name of `slug`, else of the current board. */
  renameBoard: (name: string, slug?: string) => Promise<void>;
  /**
   * Collapse or expand a board in the boards view (ADR-0054): shown at
   * once, written to its `board.json`, taken back if the write fails.
   */
  setCollapsed: (slug: string, collapsed: boolean) => Promise<void>;
  /** The board of a read card, by id, else the current board. */
  boardOf: (id: string) => string | null;
  /**
   * Put a board among the boards (ADR-0019): after another one, or last. The
   * key is the shell's to compute, and the document the write returns does
   * not carry it — the list does, in the shell's order, so it is re-read.
   */
  placeBoard: (slug: string, place: PositionDto) => Promise<void>;
  /**
   * Move a card to another board (ADR-0019). The source is re-read without
   * the card, and the target if it was read before.
   */
  moveCardToBoard: (id: string, board: string) => Promise<void>;
  /** A board that went (ADR-0034): off the list, and out of the pane if shown. */
  forget: (slug: string) => void;
}

export const useBoard = create<BoardState>((set, get) => ({
  boards: [],
  slug: null,
  board: null,
  docs: {},
  busy: false,
  notices: {},

  // Called when a vault is opened: nothing of the previous vault's board may
  // outlive it — not the document the pane showed, and not a notice, since
  // the shell starts resolving afresh for the new vault. Opening a vault
  // used to reset the list only, so the pane kept showing the old vault's
  // board until the user picked one of the new vault's.
  setBoards: (boards) => set({ boards, slug: null, board: null, docs: {}, notices: {} }),

  load: async (slug, background = false) => {
    const previous = get().slug;
    set((s) => ({ busy: true, slug, board: s.docs[slug] ?? null }));
    try {
      take(await unwrap(commands.boardRead(slug)), background);
    } catch (error) {
      // The board that could not be read is not the active one. Left as it
      // was, the pane kept showing the previous board while every write went
      // to this slug, and at boot the missing board was saved back to
      // `state.json` and failed again at every start. The UI's `activeBoard`
      // follows, because the callers set it before they call this — but only
      // the slug: a board the watcher re-reads while the editor is showing
      // (`hideBoard`, stores/tabs.ts) must not come back over the note.
      set((s) => ({ slug: previous, board: previous === null ? null : (s.docs[previous] ?? null) }));
      if (previous === null) useUi.getState().setActiveBoard(null);
      else useUi.setState({ activeBoard: previous });
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

  read: async (slug, background = false) => {
    take(await unwrap(commands.boardRead(slug)), background);
  },

  readAll: async (background = false) => {
    const { boards, docs } = get();
    await Promise.all(boards.filter((b) => !docs[b.slug]).map((b) => get().read(b.slug, background)));
  },

  refresh: async (slugs) => {
    const { slug: current, docs } = get();
    const wanted = slugs ?? [...new Set([...Object.keys(docs), ...(current ? [current] : [])])];
    // The current board through `load`, which rolls it back when it cannot
    // be read; the others are only re-read.
    await Promise.all(wanted.map((slug) => (slug === current ? get().load(slug, true) : get().read(slug, true))));
  },

  refreshList: async () => {
    const root = useVault.getState().vault?.root;
    const boards = await unwrap(commands.boardList());
    // A batch from the previous vault can resolve after Open Vault… replaced
    // the list; its answer is about a vault that is no longer open.
    if (useVault.getState().vault?.root !== root) return;
    // The shell lists boards in display order (keyed ones first, ADR-0019).
    set({ boards });
  },

  apply: async (op, target) => {
    const slug = target ?? ("id" in op ? get().boardOf(op.id) : get().slug);
    if (!slug) return;
    await unwrap(commands.cardWrite(slug, op));
    // One re-read after the write: the card store is small, and re-reading is
    // how a replayed conflict becomes visible without a second source of truth.
    await (slug === get().slug ? get().load(slug) : get().read(slug));
  },

  createBoard: async (slug, name) => {
    const ref = await unwrap(commands.boardCreate(slug, name));
    // The watcher may have listed it already (`refreshList`); once is enough.
    // A new board has no key, so it belongs after the keyed ones, by name —
    // which is where `board_list` would put it (ADR-0019).
    set((s) => ({
      boards: s.boards.some((b) => b.slug === ref.slug)
        ? s.boards
        : [...s.boards.filter((b) => b.order !== null), ...[...s.boards.filter((b) => b.order === null), ref].sort((a, b) => a.name.localeCompare(b.name))],
    }));
    await get().load(ref.slug);
  },

  setColumns: async (columns, target) => {
    const slug = target ?? get().slug;
    if (!slug) return;
    take(await unwrap(commands.boardWrite(slug, null, columns, null, null)), false);
  },

  renameBoard: async (name, target) => {
    const slug = target ?? get().slug;
    if (!slug) return;
    take(await unwrap(commands.boardWrite(slug, name, null, null, null)), false);
    set((s) => ({ boards: s.boards.map((b) => (b.slug === slug ? { ...b, name } : b)) }));
  },

  setCollapsed: async (slug, collapsed) => {
    const shown = (value: boolean) =>
      set((s) => {
        const doc = s.docs[slug];
        if (!doc) return s;
        const next = { ...doc, collapsed: value };
        return { docs: { ...s.docs, [slug]: next }, ...(s.slug === slug ? { board: next } : {}) };
      });
    shown(collapsed);
    try {
      take(await unwrap(commands.boardWrite(slug, null, null, null, collapsed)), false);
    } catch (error) {
      shown(!collapsed);
      throw error;
    }
  },

  boardOf: (id) => {
    const { docs, slug } = get();
    return Object.values(docs).find((doc) => doc.cards.some((card) => card.id === id))?.slug ?? slug;
  },

  placeBoard: async (slug, place) => {
    await unwrap(commands.boardWrite(slug, null, null, place, null));
    // `refreshList` keeps its vault guard: a place that resolves after Open
    // Vault… is about a list that is no longer shown.
    await get().refreshList();
  },

  forget: (slug) =>
    set((s) => {
      const docs = { ...s.docs };
      delete docs[slug];
      return {
        boards: s.boards.filter((b) => b.slug !== slug),
        docs,
        ...(s.slug === slug ? { slug: null, board: null } : {}),
      };
    }),

  moveCardToBoard: async (id, board) => {
    const from = get().boardOf(id);
    // Dropped on its own board's row: nowhere to go.
    if (!from || from === board) return;
    await unwrap(commands.cardWrite(from, { kind: "moveToBoard", id, board }));
    await get().refresh([from, ...(get().docs[board] ? [board] : [])]);
  },
}));

/**
 * A document the shell returned: into `docs`, and `board` when it is the
 * current one; what its first read resolved into `notices`.
 */
function take(board: BoardDto, background: boolean): void {
  useBoard.setState((s) => ({
    docs: { ...s.docs, [board.slug]: board },
    ...(s.slug === board.slug ? { board } : {}),
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
    useUi.getState().showMessage(errorKey(error), errorValues(error), background);
  }
}
