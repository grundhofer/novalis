import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands } from "../ipc/client";
import { useBoard } from "../stores/board";
import { useUi } from "../stores/ui";
import { openCardContextMenu, runCardMenuAction } from "./cardActions";

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
    useBoard.setState({ board: board as never, apply: vi.fn().mockResolvedValue(undefined) });
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
    runCardMenuAction("card.rename");
    expect(useUi.getState().prompt?.titleKey).toBe("menu.file.rename");
    runCardMenuAction("card.delete");
    expect(useUi.getState().prompt?.confirm?.confirmKey).toBe("board.deleteCard");
    expect(useBoard.getState().apply).not.toHaveBeenCalled();
  });

  it("does nothing for a card that is gone, and leaves other ids alone", async () => {
    await openCardContextMenu(board.cards[0] as never, board as never);
    useBoard.setState({ board: { ...board, cards: [] } as never });
    expect(runCardMenuAction("card.rename")).toBe(true);
    expect(useUi.getState().prompt).toBeNull();
    expect(runCardMenuAction("tree.rename")).toBe(false);
  });
});
