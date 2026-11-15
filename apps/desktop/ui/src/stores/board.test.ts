import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, unwrap, type BoardDto, type CardOpDto } from "../ipc/client";
import { useBoard } from "./board";
import { useUi } from "./ui";
import { useVault } from "./vault";

// The store reaches the shell through `../ipc/client`; a store test has no
// Tauri to talk to, so the boundary is mocked and only the store's own logic
// runs (ADR-0011).
vi.mock("../ipc/client", () => ({
  commands: {
    boardRead: vi.fn(),
    boardList: vi.fn(),
    boardCreate: vi.fn(),
    boardWrite: vi.fn(),
    cardWrite: vi.fn(),
  },
  unwrap: vi.fn(),
  NovalisError: class extends Error {
    ipc: { code: string };
    constructor(ipc: { code: string }) {
      super(ipc.code);
      this.ipc = ipc;
    }
  },
  errorKey: (error: { ipc: { code: string } }) => `errors.${error.ipc.code}`,
  errorValues: () => ({}),
}));

function doc(overrides: Partial<BoardDto> = {}): BoardDto {
  return {
    slug: "plan",
    name: "Plan",
    columns: [],
    cards: [],
    cloudOnly: [],
    orphanCards: [],
    unreadable: [],
    resolvedConflicts: 0,
    resolvedColumns: false,
    resolveError: null,
    view: { collapsed: false, hiddenColumns: [], changedWithin: null, withLabel: null, withPriority: null, withAssignee: null, dueWithin: null, sort: null, sortReversed: false, labelTones: {} },
    ...overrides,
  };
}

describe("useBoard.load", () => {
  beforeEach(() => {
    useBoard.setState({ boards: [], slug: null, board: null, busy: false, notices: {} });
    useUi.setState({ message: null, activeBoard: null, boardVisible: false });
    vi.mocked(commands.boardRead).mockClear();
  });

  // The defect the first version had: §8.4 ran on every read and the count
  // came with the board document, so the refresh the shell's own renames
  // triggered replaced the document with one that said 0 — the notice lived
  // for one render. The shell now resolves on the first read only, and the
  // store keeps what that read said.
  it("keeps the notice from the read that resolved across the reads that follow", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce(doc({ resolvedConflicts: 2 }));
    await useBoard.getState().load("plan");
    expect(useBoard.getState().notices).toEqual({ plan: { cards: 2, columns: false } });

    vi.mocked(unwrap).mockResolvedValueOnce(doc());
    await useBoard.getState().refresh();
    expect(useBoard.getState().notices).toEqual({ plan: { cards: 2, columns: false } });
    expect(useBoard.getState().board?.resolvedConflicts).toBe(0);
  });

  // `resolve_board_conflicts` existed in the core and was called by nothing;
  // the same first read now runs it, and a merged column list is said too.
  it("keeps a resolved board.json the same way", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce(doc({ resolvedColumns: true }));
    await useBoard.getState().load("plan");
    expect(useBoard.getState().notices).toEqual({ plan: { cards: 0, columns: true } });
  });

  it("reports a failed resolution in the action zone instead of swallowing it", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce(
      doc({ resolveError: { code: "io", path: "boards/plan/cards", detail: "EACCES", name: null, candidates: [] } }),
    );
    await useBoard.getState().load("plan");
    expect(useUi.getState().message?.key).toBe("errors.io");
    expect(useBoard.getState().board?.slug).toBe("plan");
    expect(useBoard.getState().notices).toEqual({});
  });

  // D102 (11): the watcher's re-read is no action of the user, so its failed
  // tidy-up is a failure without a trigger.
  it("reports a failed resolution after a watcher refresh as a failure without a trigger", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce(doc());
    await useBoard.getState().load("plan");
    expect(useUi.getState().message).toBeNull();
    vi.mocked(unwrap).mockResolvedValueOnce(
      doc({ resolveError: { code: "io", path: "boards/plan/cards", detail: "EACCES", name: null, candidates: [] } }),
    );
    await useBoard.getState().refresh();
    expect(useUi.getState().message?.key).toBe("errors.io");
    expect(useUi.getState().message?.background).toBe(true);
  });

  // A failed read used to leave `slug` on the board that could not be read
  // while the pane still showed the previous one, so every write went to a
  // board the user was not looking at; at boot the missing board was saved
  // back and failed again at every start.
  it("rolls the active board back when a read fails", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce(doc());
    await useBoard.getState().load("plan");
    useUi.getState().setActiveBoard("plan");

    useUi.getState().setActiveBoard("gone");
    vi.mocked(unwrap).mockRejectedValueOnce(new Error("not_found"));
    await expect(useBoard.getState().load("gone")).rejects.toThrow("not_found");
    expect(useBoard.getState().slug).toBe("plan");
    expect(useBoard.getState().board?.slug).toBe("plan");
    expect(useUi.getState().activeBoard).toBe("plan");
    expect(useUi.getState().boardVisible).toBe(true);
    expect(useBoard.getState().busy).toBe(false);
  });

  // The editor is showing (the board was hidden by `tabs.activate`) when the
  // watcher re-reads the board and fails: the roll-back must not bring the
  // pane back over the note.
  it("keeps a hidden board hidden when a re-read fails", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce(doc());
    await useBoard.getState().load("plan");
    useUi.getState().setActiveBoard("plan");
    useUi.getState().hideBoard();

    vi.mocked(unwrap).mockRejectedValueOnce(new Error("parse"));
    await expect(useBoard.getState().load("plan")).rejects.toThrow("parse");
    expect(useUi.getState().activeBoard).toBe("plan");
    expect(useUi.getState().boardVisible).toBe(false);
  });

  it("forgets a board that is gone at boot, so the next start does not try again", async () => {
    useUi.getState().setActiveBoard("gone");
    vi.mocked(unwrap).mockRejectedValueOnce(new Error("not_found"));
    await expect(useBoard.getState().load("gone")).rejects.toThrow("not_found");
    expect(useBoard.getState().slug).toBeNull();
    expect(useUi.getState().activeBoard).toBeNull();
    expect(useUi.getState().boardVisible).toBe(false);
  });

  // Opening another vault used to reset the board list only: the pane kept
  // showing the previous vault's board until the user picked one of the new.
  it("drops the board, the slug and the notices when a vault is opened", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce(doc({ resolvedConflicts: 1 }));
    await useBoard.getState().load("plan");
    useBoard.getState().setBoards([{ slug: "plan", name: "Plan", order: null }]);
    const state = useBoard.getState();
    expect(state.boards).toEqual([{ slug: "plan", name: "Plan", order: null }]);
    expect(state.board).toBeNull();
    expect(state.slug).toBeNull();
    expect(state.notices).toEqual({});
  });
});

describe("useBoard.refreshList", () => {
  beforeEach(() => {
    useBoard.setState({ boards: [{ slug: "old", name: "Old", order: null }] });
    vi.mocked(commands.boardList).mockClear();
  });

  // A board created by the CLI or arriving by sync used to show in the tree
  // and the palette only after the vault was reopened: the list came with
  // `bootstrap()` and nothing re-read it. The watcher batch does now.
  it("re-reads the list from the shell, in the shell's order", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce([
      { slug: "zeta", name: "Zeta", order: "a0" },
      { slug: "alpha", name: "Alpha", order: null },
    ]);

    await useBoard.getState().refreshList();

    expect(commands.boardList).toHaveBeenCalledTimes(1);
    expect(useBoard.getState().boards).toEqual([
      { slug: "zeta", name: "Zeta", order: "a0" },
      { slug: "alpha", name: "Alpha", order: null },
    ]);
  });

  // A batch from the previous vault can resolve after Open Vault… replaced
  // the list with the new vault's.
  it("drops an answer that arrives after another vault was opened", async () => {
    useVault.setState({ vault: { root: "/a", name: "a", kind: "local", boards: [] } as never });
    let answer: (boards: unknown) => void = () => {};
    vi.mocked(unwrap).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const pending = useBoard.getState().refreshList();
    useVault.setState({ vault: { root: "/b", name: "b", kind: "local", boards: [] } as never });
    useBoard.getState().setBoards([{ slug: "b1", name: "B1", order: null }]);
    answer([{ slug: "a1", name: "A1", order: null }]);
    await pending;
    expect(useBoard.getState().boards).toEqual([{ slug: "b1", name: "B1", order: null }]);
  });
});

describe("useBoard.createBoard", () => {
  // `board_create` is not an own write: the watcher can list the new board
  // through `refreshList` before the create call returns.
  it("does not list a board twice when the watcher was first", async () => {
    useBoard.setState({ boards: [{ slug: "plan", name: "Plan", order: null }] });
    vi.mocked(unwrap).mockResolvedValueOnce({ slug: "plan", name: "Plan", order: null });
    vi.mocked(unwrap).mockResolvedValueOnce(doc());
    await useBoard.getState().createBoard("plan", "Plan");
    expect(useBoard.getState().boards).toEqual([{ slug: "plan", name: "Plan", order: null }]);
  });
});

// ADR-0019: the tree names the place, the shell computes the key and lists
// the boards in their order. The store never sorts the list itself.
describe("useBoard.placeBoard", () => {
  beforeEach(() => {
    useBoard.setState({
      boards: [
        { slug: "atlas", name: "Atlas", order: null },
        { slug: "zeta", name: "Zeta", order: null },
      ],
    });
    vi.mocked(commands.boardWrite).mockClear();
    vi.mocked(commands.boardList).mockClear();
  });

  it("writes the place and re-reads the list in the shell's order", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce(doc({ slug: "atlas", name: "Atlas" }));
    vi.mocked(unwrap).mockResolvedValueOnce([
      { slug: "zeta", name: "Zeta", order: "a0" },
      { slug: "atlas", name: "Atlas", order: "a1" },
    ]);

    await useBoard.getState().placeBoard("atlas", { kind: "after", id: "zeta" });

    expect(commands.boardWrite).toHaveBeenCalledWith("atlas", null, null, { kind: "after", id: "zeta" }, null);
    expect(commands.boardList).toHaveBeenCalledTimes(1);
    expect(useBoard.getState().boards).toEqual([
      { slug: "zeta", name: "Zeta", order: "a0" },
      { slug: "atlas", name: "Atlas", order: "a1" },
    ]);
  });

  it("places last the same way", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce(doc({ slug: "atlas", name: "Atlas" }));
    vi.mocked(unwrap).mockResolvedValueOnce([]);

    await useBoard.getState().placeBoard("atlas", { kind: "last" });

    expect(commands.boardWrite).toHaveBeenCalledWith("atlas", null, null, { kind: "last" }, null);
    expect(commands.boardList).toHaveBeenCalledTimes(1);
  });

  it("leaves the list alone when the write fails", async () => {
    vi.mocked(unwrap).mockRejectedValueOnce(new Error("io"));

    await expect(useBoard.getState().placeBoard("atlas", { kind: "last" })).rejects.toThrow("io");

    expect(commands.boardList).not.toHaveBeenCalled();
    expect(useBoard.getState().boards.map((b) => b.slug)).toEqual(["atlas", "zeta"]);
  });
});

// ADR-0019: the card goes to the other board's first column, last; the open
// board is re-read without it. The target is read when it is opened.
describe("useBoard.moveCardToBoard", () => {
  beforeEach(() => {
    useBoard.setState({ slug: "plan", board: doc(), busy: false });
    vi.mocked(commands.cardWrite).mockClear();
    vi.mocked(commands.boardRead).mockClear();
  });

  it("writes the move on the open board and re-reads it", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce({ id: "c1" });
    vi.mocked(unwrap).mockResolvedValueOnce(doc({ cards: [] }));

    await useBoard.getState().moveCardToBoard("c1", "atlas");

    expect(commands.cardWrite).toHaveBeenCalledWith("plan", { kind: "moveToBoard", id: "c1", board: "atlas" });
    expect(commands.boardRead).toHaveBeenCalledWith("plan");
    expect(useBoard.getState().board?.slug).toBe("plan");
  });

  it("does nothing when the card is dropped on the open board's own row", async () => {
    await useBoard.getState().moveCardToBoard("c1", "plan");

    expect(commands.cardWrite).not.toHaveBeenCalled();
    expect(commands.boardRead).not.toHaveBeenCalled();
  });

  it("does nothing when no board is open", async () => {
    useBoard.setState({ slug: null, board: null });

    await useBoard.getState().moveCardToBoard("c1", "atlas");

    expect(commands.cardWrite).not.toHaveBeenCalled();
    expect(commands.boardRead).not.toHaveBeenCalled();
  });
});

// ADR-0054: the view shows every board, so the store keeps every board read.
describe("useBoard with every board read", () => {
  beforeEach(() => {
    useBoard.setState({
      boards: [
        { slug: "plan", name: "Plan", order: null },
        { slug: "atlas", name: "Atlas", order: null },
      ],
      slug: "plan",
      board: null,
      docs: {},
      busy: false,
      notices: {},
    });
    useUi.setState({ message: null, activeBoard: "plan", boardVisible: true });
    vi.mocked(commands.boardRead).mockClear();
    vi.mocked(commands.boardWrite).mockClear();
    vi.mocked(commands.cardWrite).mockClear();
    vi.mocked(unwrap).mockReset();
  });

  it("reads every listed board not read yet, without changing the current one", async () => {
    useBoard.setState({ docs: { plan: doc() } });
    vi.mocked(unwrap).mockResolvedValueOnce(doc({ slug: "atlas", name: "Atlas" }));

    await useBoard.getState().readAll(true);

    expect(commands.boardRead).toHaveBeenCalledTimes(1);
    expect(commands.boardRead).toHaveBeenCalledWith("atlas");
    expect(Object.keys(useBoard.getState().docs).sort()).toEqual(["atlas", "plan"]);
    expect(useBoard.getState().slug).toBe("plan");
    expect(useBoard.getState().board).toBeNull();
  });

  it("writes a card op on the board that holds the card, and re-reads only that one", async () => {
    const card = { id: "c9", title: "x", column: "todo", order: "a0", notes: [] } as never;
    useBoard.setState({ docs: { plan: doc(), atlas: doc({ slug: "atlas", cards: [card] }) } });
    vi.mocked(unwrap).mockResolvedValueOnce({ id: "c9" });
    vi.mocked(unwrap).mockResolvedValueOnce(doc({ slug: "atlas", cards: [] }));

    await useBoard.getState().apply({ kind: "retitle", id: "c9", title: "y" });

    expect(commands.cardWrite).toHaveBeenCalledWith("atlas", { kind: "retitle", id: "c9", title: "y" });
    expect(commands.boardRead).toHaveBeenCalledWith("atlas");
    expect(useBoard.getState().slug).toBe("plan");
    expect(useBoard.getState().docs.atlas?.cards).toEqual([]);
  });

  it("writes an add on the board it names, else on the current one", async () => {
    useBoard.setState({ docs: { plan: doc(), atlas: doc({ slug: "atlas" }) } });
    vi.mocked(unwrap).mockResolvedValue(doc({ slug: "atlas" }));
    const add: CardOpDto = { kind: "add", title: "t", column: "todo", notes: [], position: { kind: "last" } };

    await useBoard.getState().apply(add, "atlas");
    expect(commands.cardWrite).toHaveBeenLastCalledWith("atlas", add);

    vi.mocked(unwrap).mockResolvedValue(doc());
    await useBoard.getState().apply(add);
    expect(commands.cardWrite).toHaveBeenLastCalledWith("plan", add);
  });

  it("changes the view at once, writes all of it, and takes it back when the write fails", async () => {
    useBoard.setState({ docs: { atlas: doc({ slug: "atlas" }) } });
    let finish: (value: unknown) => void = () => {};
    vi.mocked(unwrap).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)) as never);

    const write = useBoard.getState().setView("atlas", { collapsed: true });
    const collapsed = { ...doc().view, collapsed: true };
    expect(useBoard.getState().docs.atlas?.view).toEqual(collapsed);
    expect(commands.boardWrite).toHaveBeenCalledWith("atlas", null, null, null, collapsed);
    finish(doc({ slug: "atlas", view: collapsed }));
    await write;

    vi.mocked(unwrap).mockRejectedValueOnce(new Error("io"));
    await expect(useBoard.getState().setView("atlas", { sort: "title" })).rejects.toThrow("io");
    expect(useBoard.getState().docs.atlas?.view).toEqual(collapsed);
  });

  it("keeps each board's search for the session only, and drops it with the vault", () => {
    useBoard.getState().setSearch("atlas", "zoom");
    expect(useBoard.getState().searches).toEqual({ atlas: "zoom" });
    expect(commands.boardWrite).not.toHaveBeenCalled();
    useBoard.getState().setBoards([]);
    expect(useBoard.getState().searches).toEqual({});
  });

  it("re-reads the boards a watcher batch touched, the current one through load", async () => {
    useBoard.setState({ docs: { plan: doc(), atlas: doc({ slug: "atlas" }) } });
    vi.mocked(unwrap).mockImplementation(async () => doc({ slug: "atlas" }));

    await useBoard.getState().refresh(["atlas"]);
    expect(commands.boardRead).toHaveBeenCalledTimes(1);
    expect(commands.boardRead).toHaveBeenCalledWith("atlas");

    vi.mocked(commands.boardRead).mockClear();
    await useBoard.getState().refresh();
    expect(vi.mocked(commands.boardRead).mock.calls.map(([slug]) => slug).sort()).toEqual(["atlas", "plan"]);
  });

  it("moves a card from the board that holds it and re-reads both boards read", async () => {
    const card = { id: "c9", title: "x", column: "todo", order: "a0", notes: [] } as never;
    useBoard.setState({ docs: { plan: doc(), atlas: doc({ slug: "atlas", cards: [card] }) } });
    vi.mocked(unwrap).mockImplementation(async () => doc());

    await useBoard.getState().moveCardToBoard("c9", "plan");

    expect(commands.cardWrite).toHaveBeenCalledWith("atlas", { kind: "moveToBoard", id: "c9", board: "plan" });
    expect(vi.mocked(commands.boardRead).mock.calls.map(([slug]) => slug).sort()).toEqual(["atlas", "plan"]);
  });

  it("drops a board that went from the boards read", () => {
    useBoard.setState({ docs: { plan: doc(), atlas: doc({ slug: "atlas" }) } });
    useBoard.getState().forget("atlas");
    expect(Object.keys(useBoard.getState().docs)).toEqual(["plan"]);
    expect(useBoard.getState().boards.map((b) => b.slug)).toEqual(["plan"]);
  });

  it("drops every board read when a vault is opened", () => {
    useBoard.setState({ docs: { plan: doc() } });
    useBoard.getState().setBoards([]);
    expect(useBoard.getState().docs).toEqual({});
  });
});
