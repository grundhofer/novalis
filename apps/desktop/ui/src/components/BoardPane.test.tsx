import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useBoard } from "../stores/board";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import BoardPane from "./BoardPane";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../ipc/client", () => ({
  commands: {},
  unwrap: vi.fn(),
}));

const card = (id: string, title: string, column: string, notes: string[] = []) => ({
  id,
  title,
  column,
  order: "a0",
  notes,
  created: "2026-09-08T10:00:00.000Z",
  updated: "2026-09-08T10:00:00.000Z",
});

const board = {
  slug: "plan",
  name: "Plan",
  columns: [
    { id: "todo", name: "To do" },
    { id: "doing", name: "Doing" },
  ],
  cards: [card("c1", "Write the spec", "todo", ["Roadmap.md"]), card("c2", "Ship it", "doing")],
  orphanCards: [],
  cloudOnly: [],
};

describe("BoardPane", () => {
  beforeEach(() => {
    useBoard.setState({
      board: board as never,
      boards: [{ slug: "plan", name: "Plan" }] as never,
      busy: false,
      slug: "plan",
      apply: vi.fn().mockResolvedValue(undefined),
      setColumns: vi.fn().mockResolvedValue(undefined),
      renameBoard: vi.fn().mockResolvedValue(undefined),
    });
    useTabs.setState({ active: null, tabs: [] });
    useUi.setState({ prompt: null, boardVisible: true });
  });

  it("renders every column and card", () => {
    render(<BoardPane />);
    expect(screen.getByText("Write the spec")).toBeTruthy();
    expect(screen.getByText("Ship it")).toBeTruthy();
    expect(screen.getByText("To do")).toBeTruthy();
  });

  // The defect the owner caught from a screenshot: the card and column rename
  // buttons both read "Rename Board", because `board.rename` was reused for
  // all three. The board's own control keeps that key; the others must not.
  it("does not label the card or column rename with the board's key", () => {
    render(<BoardPane />);
    const renameLabels = screen
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((text) => text === "board.rename" || text === "menu.file.rename");
    expect(renameLabels).not.toContain("board.rename");
    expect(renameLabels.length).toBeGreaterThan(0);
  });

  it("removes a card through a confirmation, never straight away", () => {
    render(<BoardPane />);
    const apply = useBoard.getState().apply;

    fireEvent.click(screen.getAllByLabelText("board.deleteCard")[0]!);

    expect(apply).not.toHaveBeenCalled();
    const prompt = useUi.getState().prompt;
    expect(prompt?.confirm?.confirmKey).toBe("board.deleteCard");
  });

  it("retitles a card through the dialog", async () => {
    render(<BoardPane />);

    fireEvent.click(screen.getAllByLabelText("menu.file.rename")[0]!);
    await useUi.getState().prompt?.submit("Renamed");

    expect(useBoard.getState().apply).toHaveBeenCalledWith({
      kind: "retitle",
      id: "c1",
      title: "Renamed",
    });
  });

  it("links the note that is open, and offers nothing when none is", () => {
    render(<BoardPane />);
    // No active note: the control is there but refuses.
    const link = screen.getAllByLabelText("board.linkNote")[0] as HTMLButtonElement;
    expect(link.disabled).toBe(true);

    useTabs.setState({ active: "Spike.md" });
    render(<BoardPane />);
    fireEvent.click(screen.getAllByLabelText("board.linkNote")[0]!);

    expect(useBoard.getState().apply).toHaveBeenCalledWith({
      kind: "linkNote",
      id: "c1",
      path: "Spike.md",
    });
  });

  it("unlinks a note from its chip", () => {
    render(<BoardPane />);

    fireEvent.click(screen.getByLabelText("board.unlinkNote"));

    expect(useBoard.getState().apply).toHaveBeenCalledWith({
      kind: "unlinkNote",
      id: "c1",
      path: "Roadmap.md",
    });
  });

  it("reorders columns without losing any", () => {
    render(<BoardPane />);

    fireEvent.click(screen.getAllByLabelText("board.moveColumnRight")[0]!);

    expect(useBoard.getState().setColumns).toHaveBeenCalledWith([
      { id: "doing", name: "Doing" },
      { id: "todo", name: "To do" },
    ]);
  });

  it("cannot move the first column left or the last one right", () => {
    render(<BoardPane />);
    const left = screen.getAllByLabelText("board.moveColumnLeft") as HTMLButtonElement[];
    const right = screen.getAllByLabelText("board.moveColumnRight") as HTMLButtonElement[];
    expect(left[0]!.disabled).toBe(true);
    expect(right[right.length - 1]!.disabled).toBe(true);
  });

  it("deletes a column through a confirmation that counts what is stranded", () => {
    render(<BoardPane />);

    fireEvent.click(screen.getAllByLabelText("board.deleteColumn")[0]!);

    const prompt = useUi.getState().prompt;
    expect(useBoard.getState().setColumns).not.toHaveBeenCalled();
    expect(prompt?.confirm?.values).toEqual({ count: 1 });
  });

  // D21: the board fills the same pane as the editor, so opening the note
  // without closing the board left it invisible behind the board — the exact
  // outcome D21 chose card-click over a split view to avoid.
  it("closes the board when a card opens its note, so the note is visible", () => {
    const open = vi.fn().mockResolvedValue(undefined);
    useTabs.setState({ open } as never);
    render(<BoardPane />);

    fireEvent.click(screen.getByText("Write the spec"));

    expect(open).toHaveBeenCalledWith("Roadmap.md");
    expect(useUi.getState().boardVisible).toBe(false);
  });

  // WebKit abandons a drag whose data store is still empty when dragstart
  // returns, so the drop never fires and the board could not be reordered.
  it("puts something in the drag data store, or WebKit cancels the drag", () => {
    render(<BoardPane />);
    const setData = vi.fn();
    const dataTransfer = { setData, effectAllowed: "" };

    fireEvent.dragStart(screen.getByText("Write the spec").closest(".card")!, { dataTransfer });

    expect(setData).toHaveBeenCalled();
    expect(dataTransfer.effectAllowed).toBe("move");
  });
});
