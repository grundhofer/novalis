import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, unwrap, type BoardDto } from "../ipc/client";
import { useBoard } from "./board";
import { useUi } from "./ui";

// The store reaches the shell through `../ipc/client`; a store test has no
// Tauri to talk to, so the boundary is mocked and only the store's own logic
// runs (ADR-0011).
vi.mock("../ipc/client", () => ({
  commands: { boardRead: vi.fn() },
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
    ...overrides,
  };
}

describe("useBoard.load", () => {
  beforeEach(() => {
    useBoard.setState({ boards: [], slug: null, board: null, busy: false, notices: {} });
    useUi.setState({ toast: null, activeBoard: null, boardVisible: false });
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

  it("reports a failed resolution as a toast instead of swallowing it", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce(
      doc({ resolveError: { code: "io", path: "boards/plan/cards", detail: "EACCES", name: null, candidates: [] } }),
    );
    await useBoard.getState().load("plan");
    expect(useUi.getState().toast?.key).toBe("errors.io");
    expect(useBoard.getState().board?.slug).toBe("plan");
    expect(useBoard.getState().notices).toEqual({});
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
    useBoard.getState().setBoards([{ slug: "plan", name: "Plan" }]);
    const state = useBoard.getState();
    expect(state.boards).toEqual([{ slug: "plan", name: "Plan" }]);
    expect(state.board).toBeNull();
    expect(state.slug).toBeNull();
    expect(state.notices).toEqual({});
  });
});
