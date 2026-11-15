import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands } from "../ipc/client";
import { useBoard } from "../stores/board";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import { openCardContextMenu, openFromBoard, runCardMenuAction } from "./cardActions";

vi.mock("../ipc/client", () => ({
  commands: { contextMenu: vi.fn() },
  unwrap: (call: Promise<unknown>) => call,
}));

const card = (id: string, column: string, notes: string[] = []) => ({
  id,
  title: `Card ${id}`,
  column,
  order: "a0",
  notes,
  created: "2026-09-08T10:00:00.000Z",
  updated: "2026-09-08T10:00:00.000Z",
  description: null,
});

const board = {
  slug: "plan",
  name: "Plan",
  columns: [
    { id: "todo", name: "To do" },
    { id: "doing", name: "Doing" },
  ],
  cards: [card("c1", "todo", ["a.md"]), card("c2", "gone-column")],
  orphanCards: ["c2"],
  cloudOnly: [],
  unreadable: [],
  resolvedConflicts: 0,
  resolvedColumns: false,
  resolveError: null,
};

// ADR-0032: the shell pops the menu; the UI remembers the card and answers
// the ids that come back.
describe("the card context menu", () => {
  beforeEach(() => {
    vi.mocked(commands.contextMenu).mockResolvedValue({ status: "ok", data: null } as never);
    useBoard.setState({
      board: board as never,
      docs: { plan: board as never },
      apply: vi.fn().mockResolvedValue(undefined),
    });
    useUi.setState({ prompt: null });
  });

  it("asks for the card's menu with the board's columns, its own, and whether it has a note", async () => {
    await openCardContextMenu(board.cards[0] as never, board as never);
    expect(commands.contextMenu).toHaveBeenLastCalledWith({
      kind: "card",
      columns: board.columns,
      column: "todo",
      hasNote: true,
    });
    // A card whose column is gone offers every column.
    await openCardContextMenu(board.cards[1] as never, board as never);
    expect(commands.contextMenu).toHaveBeenLastCalledWith(expect.objectContaining({ column: "", hasNote: false }));
  });

  it("moves the remembered card last into the column the item names", async () => {
    await openCardContextMenu(board.cards[0] as never, board as never);
    expect(runCardMenuAction("card.moveToColumn:doing")).toBe(true);
    expect(useBoard.getState().apply).toHaveBeenCalledWith({
      kind: "move",
      id: "c1",
      column: "doing",
      position: { kind: "last" },
    });
  });

  it("runs the hover actions on it", async () => {
    await openCardContextMenu(board.cards[0] as never, board as never);
    runCardMenuAction("card.edit");
    expect(useUi.getState().cardEdit).toEqual({ slug: "plan", id: "c1" });
    runCardMenuAction("card.delete");
    expect(useUi.getState().prompt?.confirm?.confirmKey).toBe("app.delete");
    expect(useBoard.getState().apply).not.toHaveBeenCalled();
  });

  // ADR-0051 #41: Link Note… in the native menu too, as in the card's „Mehr“.
  it("opens the note picker for the remembered card, its own links left out", async () => {
    await openCardContextMenu(board.cards[0] as never, board as never);
    expect(runCardMenuAction("card.linkNote")).toBe(true);
    const overlay = useUi.getState().overlay;
    expect(overlay).toMatchObject({ kind: "pickNote", exclude: ["a.md"] });
    if (overlay.kind !== "pickNote") throw new Error("no picker");
    await overlay.onPick("b.md");
    expect(useBoard.getState().apply).toHaveBeenCalledWith({ kind: "linkNote", id: "c1", path: "b.md" });
  });

  it("does nothing for a card that is gone, and leaves other ids alone", async () => {
    await openCardContextMenu(board.cards[0] as never, board as never);
    useBoard.setState({ board: { ...board, cards: [] } as never, docs: { plan: { ...board, cards: [] } as never } });
    useUi.setState({ cardEdit: null });
    expect(runCardMenuAction("card.edit")).toBe(true);
    expect(useUi.getState().cardEdit).toBeNull();
    expect(runCardMenuAction("tree.rename")).toBe(false);
  });
});

// ADR-0053: a note opened from the board remembers the board for the way back.
describe("opening a note from the board", () => {
  it("remembers the note and the loaded board, then opens the note", async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    useTabs.setState({ open } as never);
    useBoard.setState({ slug: "plan" });
    useUi.setState({ boardReturn: null });

    await openFromBoard("a.md");

    expect(useUi.getState().boardReturn).toEqual({ path: "a.md", board: "plan" });
    expect(open).toHaveBeenCalledWith("a.md");
  });

  it("opens the note without a way back when no board is loaded", async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    useTabs.setState({ open } as never);
    useBoard.setState({ slug: null });
    useUi.setState({ boardReturn: null });

    await openFromBoard("a.md");

    expect(useUi.getState().boardReturn).toBeNull();
    expect(open).toHaveBeenCalledWith("a.md");
  });
});
