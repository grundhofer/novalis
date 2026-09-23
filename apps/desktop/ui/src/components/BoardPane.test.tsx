import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useBoard } from "../stores/board";
import { useFiles } from "../stores/files";
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
  description: null,
  descriptionHtml: null,
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
  unreadable: [],
  resolvedConflicts: 0,
  resolvedColumns: false,
  resolveError: null,
};

describe("BoardPane", () => {
  beforeEach(() => {
    useBoard.setState({
      board: board as never,
      boards: [{ slug: "plan", name: "Plan" }] as never,
      busy: false,
      slug: "plan",
      notices: {},
      apply: vi.fn().mockResolvedValue(undefined),
      setColumns: vi.fn().mockResolvedValue(undefined),
      renameBoard: vi.fn().mockResolvedValue(undefined),
    });
    useTabs.setState({ active: null, tabs: [] });
    useUi.setState({ prompt: null, boardVisible: true });
    useFiles.setState({ files: ["Roadmap.md", "Spec.md"], loaded: true });
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

  // ADR-0013: the description is edited as text in the same dialog as the
  // rename; the store never sees a value that did not change. ADR-0033: the
  // card shows it rendered, inert.
  describe("description", () => {
    const described = {
      ...board,
      cards: [
        {
          ...card("c1", "Write the spec", "todo", ["Roadmap.md"]),
          description: "First the *why*. [x](https://example.org)",
          descriptionHtml: '<p>First the <em>why</em>. <a href="https://example.org">x</a></p>',
        },
      ],
    };

    it("shows a card's description rendered, and a click on a link in it is the card's", () => {
      const open = vi.fn().mockResolvedValue(undefined);
      useTabs.setState({ open } as never);
      useBoard.setState({ board: described as never });
      render(<BoardPane />);
      expect(screen.getByText("why").tagName).toBe("EM");

      const followed = fireEvent.click(screen.getByText("x"));

      expect(followed).toBe(false);
      expect(open).toHaveBeenCalledWith("Roadmap.md");
    });

    it("edits it in a multi-line dialog that starts from the current text", () => {
      useBoard.setState({ board: described as never });
      render(<BoardPane />);

      fireEvent.click(screen.getByLabelText("board.editDescription"));

      const prompt = useUi.getState().prompt;
      expect(prompt?.multiline).toBe(true);
      expect(prompt?.initial).toBe("First the *why*. [x](https://example.org)");
    });

    it("writes the new text through the dialog", async () => {
      useBoard.setState({ board: described as never });
      render(<BoardPane />);

      fireEvent.click(screen.getByLabelText("board.editDescription"));
      await useUi.getState().prompt!.submit("new text");

      expect(useBoard.getState().apply).toHaveBeenCalledWith({
        kind: "setDescription",
        id: "c1",
        description: "new text",
      });
    });

    it("writes nothing when the text did not change", async () => {
      useBoard.setState({ board: described as never });
      render(<BoardPane />);

      fireEvent.click(screen.getByLabelText("board.editDescription"));
      await useUi.getState().prompt!.submit("First the *why*. [x](https://example.org)");

      expect(useBoard.getState().apply).not.toHaveBeenCalled();
    });

    it("starts from the empty string on a card without one", () => {
      render(<BoardPane />);

      fireEvent.click(screen.getAllByLabelText("board.editDescription")[0]!);

      expect(useUi.getState().prompt?.initial).toBe("");
    });
  });

  // ADR-0030: Link Note… opens the note picker, which leaves out the notes
  // the card already links; the pick is the write. It used to link the
  // active tab or be disabled.
  it("links a note chosen in the picker, offering none the card already links", async () => {
    render(<BoardPane />);
    const link = screen.getAllByLabelText("board.linkNote")[0] as HTMLButtonElement;
    expect(link.disabled).toBe(false);

    fireEvent.click(link);

    const overlay = useUi.getState().overlay;
    expect(overlay.kind).toBe("pickNote");
    if (overlay.kind !== "pickNote") return;
    expect(overlay.exclude).toEqual(["Roadmap.md"]);
    await overlay.onPick("Spec.md");
    expect(useBoard.getState().apply).toHaveBeenCalledWith({
      kind: "linkNote",
      id: "c1",
      path: "Spec.md",
    });
  });

  // ADR-0030: a card with no note opens its description on a click; one with
  // a note keeps D21 (the next test).
  it("opens the description of a card that links no note", () => {
    const open = vi.fn().mockResolvedValue(undefined);
    useTabs.setState({ open } as never);
    render(<BoardPane />);

    fireEvent.click(screen.getByText("Ship it"));

    expect(open).not.toHaveBeenCalled();
    expect(useUi.getState().prompt?.titleKey).toBe("board.editDescription");
  });

  // ADR-0030: a note dragged from the tree onto a column becomes a card
  // titled by its stem and linked to it; anything else makes no card.
  describe("a note dropped from the tree", () => {
    const drop = (path: string, types = ["text/plain"]) => {
      const column = screen.getByText("Doing").closest(".column")!;
      fireEvent.drop(column, { dataTransfer: { types, getData: () => path } });
    };

    beforeEach(() => {
      render(<BoardPane />);
    });

    it("makes a card linked to the note, last in the column", () => {
      drop("Spec.md");
      expect(useBoard.getState().apply).toHaveBeenCalledWith({
        kind: "add",
        title: "Spec",
        column: "doing",
        notes: ["Spec.md"],
        position: { kind: "last" },
      });
    });

    it("makes none for a file that is not a note, a path not listed, or a tab", () => {
      act(() => useFiles.setState({ files: ["Roadmap.md", "Spec.md", "clip.pdf"] }));
      drop("clip.pdf");
      drop("Gone.md");
      drop("Spec.md", ["application/x-novalis-tab"]);
      expect(useBoard.getState().apply).not.toHaveBeenCalled();
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

  // D21: the card opens its note in a tab. Hiding the board so the note is
  // visible is `tabs.activate`'s job, the same as for every other foreground
  // open; the click only has to open the right note.
  it("opens the card's first note when the card is clicked", () => {
    const open = vi.fn().mockResolvedValue(undefined);
    useTabs.setState({ open } as never);
    render(<BoardPane />);

    fireEvent.click(screen.getByText("Write the spec"));

    expect(open).toHaveBeenCalledWith("Roadmap.md");
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

  // ADR-0019: the same drag can end on a board row in the tree, which reads
  // the card under its own type; `text/plain` stays, for WebKit and for the
  // column drop that keys on state.
  it("carries the card id under both types", () => {
    render(<BoardPane />);
    const setData = vi.fn();
    const dataTransfer = { setData, effectAllowed: "" };

    fireEvent.dragStart(screen.getByText("Write the spec").closest(".card")!, { dataTransfer });

    expect(setData.mock.calls).toEqual([
      ["text/plain", "c1"],
      ["application/x-novalis-card", "c1"],
    ]);
  });
  // Both of these used to happen in silence: §8.4 resolution never ran because
  // nothing called it, and a card file the reader could not use was dropped
  // without a word, so the card was simply absent with no reason given.
  describe("notices", () => {
    // The notice is read from the store, not from the board document: the
    // document carries the count on the one read that resolved and on no
    // other, and the first version lost the notice on the very next refresh.
    it("says so when this board's first read resolved a card conflict", () => {
      useBoard.setState({ notices: { plan: { cards: 2, columns: false } } });
      render(<BoardPane />);
      expect(screen.getByRole("status").textContent).toContain("board.conflictNotice");
    });

    it("keeps the notice when the document it came with is refreshed away", () => {
      useBoard.setState({ notices: { plan: { cards: 1, columns: false } }, board: { ...board, resolvedConflicts: 0 } as never });
      render(<BoardPane />);
      expect(screen.getByRole("status").textContent).toContain("board.conflictNotice");
    });

    it("lets the user dismiss it", () => {
      useBoard.setState({ notices: { plan: { cards: 1, columns: false } } });
      render(<BoardPane />);
      fireEvent.click(screen.getByText("banner.dismiss"));
      expect(screen.queryByRole("status")).toBeNull();
      expect(useBoard.getState().notices).toEqual({});
    });

    it("says so when this board's first read merged a conflicting board.json", () => {
      useBoard.setState({ notices: { plan: { cards: 0, columns: true } } });
      render(<BoardPane />);
      const text = screen.getByRole("status").textContent;
      expect(text).toContain("board.columnsMerged");
      expect(text).not.toContain("board.conflictNotice");
    });

    it("says both when the same read resolved cards and columns", () => {
      useBoard.setState({ notices: { plan: { cards: 1, columns: true } } });
      render(<BoardPane />);
      const text = screen.getByRole("status").textContent;
      expect(text).toContain("board.columnsMerged");
      expect(text).toContain("board.conflictNotice");
    });

    it("shows another board's notice only on that board", () => {
      useBoard.setState({ notices: { other: { cards: 3, columns: false } } });
      render(<BoardPane />);
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("says so when a card file could not be read", () => {
      useBoard.setState({ board: { ...board, unreadable: ["01J bad.json"] } as never });
      render(<BoardPane />);
      expect(screen.getByRole("status").textContent).toContain("board.unreadableCards");
    });

    it("stays quiet when there is nothing to report", () => {
      render(<BoardPane />);
      expect(screen.queryByRole("status")).toBeNull();
    });
  });

  // feature-gaps A21: D21 "a card opens its note", per chip — not only the
  // first — and a chip whose note is gone says so instead of failing.
  it("opens any linked note from its chip, and dims one that is gone", () => {
    const open = vi.fn().mockResolvedValue(undefined);
    useTabs.setState({ open });
    useBoard.setState({
      board: { ...board, cards: [card("c1", "Write the spec", "todo", ["Roadmap.md", "Spec.md", "Gone.md"])] } as never,
    });
    render(<BoardPane />);

    fireEvent.click(screen.getByText("Spec"));
    expect(open).toHaveBeenCalledWith("Spec.md");
    expect(open).toHaveBeenCalledTimes(1);

    const gone = screen.getByText("Gone");
    expect(gone.tagName).toBe("SPAN");
    expect(gone.getAttribute("title")).toBe("board.noteMissing");
    expect(gone.closest(".card-note")?.className).toContain("missing");
    fireEvent.click(gone);
    // The click falls through to the card, which opens its first note.
    expect(open).not.toHaveBeenCalledWith("Gone.md");
  });

  it("marks nothing missing before the file list has loaded", () => {
    useFiles.setState({ files: [], loaded: false });
    render(<BoardPane />);
    expect(document.querySelector(".card-note.missing")).toBeNull();
  });
});
