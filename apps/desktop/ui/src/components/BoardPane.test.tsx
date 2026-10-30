import { act, createEvent, fireEvent, render, screen } from "@testing-library/react";
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

/**
 * A row of a „Mehr“ menu. The menus are closed popovers, which jsdom hides
 * like a browser does, so the rows are looked up among hidden elements.
 */
const items = (name: string) => screen.getAllByRole("menuitem", { name, hidden: true }) as HTMLButtonElement[];

/** The card's list item, by its title. */
const cardOf = (title: string) => screen.getByText(title).closest("li.sb-card")!;

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
    expect(screen.getByRole("heading", { name: /^To do/ })).toBeTruthy();
  });

  // The defect the owner caught from a screenshot: the card and column rename
  // buttons both read "Rename Board", because `board.rename` was reused for
  // all three. The board's own menu keeps that key; the others must not.
  it("does not label the card or column rename with the board's key", () => {
    render(<BoardPane />);
    expect(items("board.rename")).toHaveLength(1);
    expect(items("menu.file.rename")).toHaveLength(2);
    expect(items("board.renameColumn")).toHaveLength(2);
  });

  // ADR-0051 #19, AKT-10, FOR-05: no hover buttons; the board, every column
  // and every card have an always-visible „Mehr“ with its menu.
  it("gives the board, each column and each card a „Mehr“ menu", () => {
    render(<BoardPane />);
    const more = screen.getAllByRole("button", { name: /^board\.more/ });
    expect(more).toHaveLength(1 + 2 + 2);
    for (const button of more) {
      expect(button.className).toContain("sb-icon-button--compact");
      expect(button.getAttribute("aria-haspopup")).toBe("menu");
      const menu = document.getElementById(button.getAttribute("popovertarget")!)!;
      expect(menu.getAttribute("role")).toBe("menu");
      expect(menu.hasAttribute("popover")).toBe(true);
      expect(menu.getAttribute("aria-label")).toBe(button.getAttribute("aria-label"));
    }
    // Nothing waits for a hover any more.
    expect(document.querySelector(".card-actions, .col-actions")).toBeNull();
  });

  it("puts „Löschen …“ last, after a separator, as a danger row", () => {
    render(<BoardPane />);
    const menus = [...document.querySelectorAll<HTMLElement>("ul.sb-menu[popover]")].filter(
      (menu) => !menu.closest("li[role=none]"),
    );
    expect(menus).toHaveLength(5);
    for (const menu of menus) {
      const rows = [...menu.children];
      const last = rows.at(-1)!.querySelector("button")!;
      expect(last.className).toContain("sb-menu__item--danger");
      expect(last.querySelector("use")?.getAttribute("href")).toBe("#trash");
      expect(rows.at(-2)!.getAttribute("role")).toBe("separator");
    }
  });

  // The card's menu has the order of its native context menu (menu.rs).
  it("orders a card's menu like its context menu", () => {
    render(<BoardPane />);
    const more = cardOf("Write the spec").querySelector("[aria-haspopup=menu]")!;
    const menu = document.getElementById(more.getAttribute("popovertarget")!)!;
    const labels = [...menu.querySelectorAll(":scope > li > button")].map((b) => b.textContent);
    expect(labels).toEqual([
      "board.openNote",
      "menu.file.rename",
      "board.editDescription",
      "board.linkNote",
      "board.createNote",
      "board.moveToColumn",
      "board.deleteCard",
    ]);
  });

  it("moves a card to another column from its menu, without dragging", () => {
    render(<BoardPane />);
    const doing = screen.getAllByRole("menuitemradio", { name: "Doing", hidden: true })[0]!;
    const todo = screen.getAllByRole("menuitemradio", { name: "To do", hidden: true })[0]!;
    expect(todo.getAttribute("aria-checked")).toBe("true");
    expect(doing.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(todo);
    expect(useBoard.getState().apply).not.toHaveBeenCalled();
    fireEvent.click(doing);

    expect(useBoard.getState().apply).toHaveBeenCalledWith({
      kind: "move",
      id: "c1",
      column: "doing",
      position: { kind: "last" },
    });
  });

  it("does not open the card's note when its menu is used", () => {
    const open = vi.fn().mockResolvedValue(undefined);
    useTabs.setState({ open } as never);
    render(<BoardPane />);

    fireEvent.click(cardOf("Write the spec").querySelector("[aria-haspopup=menu]")!);
    fireEvent.click(items("menu.file.rename")[0]!);

    expect(open).not.toHaveBeenCalled();
    expect(useUi.getState().prompt?.titleKey).toBe("board.renameCardTitle");
  });

  it("renames the board from its menu", async () => {
    render(<BoardPane />);
    // The name is a heading now, not a button.
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Plan");

    fireEvent.click(items("board.rename")[0]!);
    await useUi.getState().prompt?.submit("Roadmap");

    expect(useBoard.getState().renameBoard).toHaveBeenCalledWith("Roadmap");
  });

  it("removes a card through a confirmation, never straight away", () => {
    render(<BoardPane />);
    const apply = useBoard.getState().apply;

    fireEvent.click(items("board.deleteCard")[0]!);

    expect(apply).not.toHaveBeenCalled();
    const prompt = useUi.getState().prompt;
    expect(prompt?.titleKey).toBe("board.deleteCardTitle");
    expect(prompt?.confirm?.confirmKey).toBe("app.delete");
  });

  it("retitles a card through the dialog", async () => {
    render(<BoardPane />);

    fireEvent.click(items("menu.file.rename")[0]!);
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

      fireEvent.click(items("board.editDescription")[0]!);

      const prompt = useUi.getState().prompt;
      expect(prompt?.multiline).toBe(true);
      expect(prompt?.initial).toBe("First the *why*. [x](https://example.org)");
    });

    it("writes the new text through the dialog", async () => {
      useBoard.setState({ board: described as never });
      render(<BoardPane />);

      fireEvent.click(items("board.editDescription")[0]!);
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

      fireEvent.click(items("board.editDescription")[0]!);
      await useUi.getState().prompt!.submit("First the *why*. [x](https://example.org)");

      expect(useBoard.getState().apply).not.toHaveBeenCalled();
    });

    it("starts from the empty string on a card without one", () => {
      render(<BoardPane />);

      fireEvent.click(items("board.editDescription")[0]!);

      expect(useUi.getState().prompt?.initial).toBe("");
    });
  });

  // ADR-0030: Link Note… opens the note picker, which leaves out the notes
  // the card already links; the pick is the write. It used to link the
  // active tab or be disabled.
  it("links a note chosen in the picker, offering none the card already links", async () => {
    render(<BoardPane />);
    const link = items("board.linkNote")[0]!;
    expect(link.getAttribute("aria-disabled")).toBeNull();

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
    expect(useUi.getState().prompt?.titleKey).toBe("board.editDescriptionTitle");
  });

  // ADR-0030: a note dragged from the tree onto a column becomes a card
  // titled by its stem and linked to it; anything else makes no card.
  describe("a note dropped from the tree", () => {
    const drop = (path: string, types = ["text/plain"]) => {
      const column = screen.getAllByText("Doing").find((el) => el.classList.contains("sb-board__name"))!.closest(".sb-board__column")!;
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

    fireEvent.click(items("board.moveColumnRight")[0]!);

    expect(useBoard.getState().setColumns).toHaveBeenCalledWith([
      { id: "doing", name: "Doing" },
      { id: "todo", name: "To do" },
    ]);
  });

  it("cannot move the first column left or the last one right", () => {
    render(<BoardPane />);
    const left = items("board.moveColumnLeft");
    const right = items("board.moveColumnRight");
    // Shown, never hidden, and passed over by the arrows (D102 (9)).
    expect(left[0]!.getAttribute("aria-disabled")).toBe("true");
    expect(right[right.length - 1]!.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(left[0]!);
    expect(useBoard.getState().setColumns).not.toHaveBeenCalled();
  });

  it("deletes a column through a confirmation that counts what is stranded", () => {
    render(<BoardPane />);

    fireEvent.click(items("board.deleteColumn")[0]!);

    const prompt = useUi.getState().prompt;
    expect(useBoard.getState().setColumns).not.toHaveBeenCalled();
    expect(prompt?.titleKey).toBe("board.deleteColumnTitle");
    expect(prompt?.confirm?.values).toEqual({ count: 1, name: "To do" });
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

    fireEvent.dragStart(cardOf("Write the spec"), { dataTransfer });

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

    fireEvent.dragStart(cardOf("Write the spec"), { dataTransfer });

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

    const gone = screen.getByText("Gone").closest(".card-note-name") as HTMLElement;
    expect(gone.tagName).toBe("SPAN");
    expect(gone.getAttribute("title")).toBe("board.noteMissing");
    expect(gone.closest(".card-note")?.className).toContain("missing");
    // Not only in the tooltip: a screen reader hears it too.
    expect(gone.closest(".card-note")?.textContent).toContain("board.noteMissing");
    fireEvent.click(gone);
    // The click falls through to the card, which opens its first note.
    expect(open).not.toHaveBeenCalledWith("Gone.md");
  });

  // D100 (6), ZUG-09: a linked note's name breaks as a file name does, only
  // after - . _ /, as in every other view.
  it("writes a linked note's name as a file name", () => {
    useBoard.setState({
      board: { ...board, cards: [card("c1", "Write the spec", "todo", ["notes/release-plan_v2.md"])] } as never,
    });
    render(<BoardPane />);
    const name = document.querySelector(".card-note-name .sb-file-name");
    expect(name?.textContent).toBe("release-plan_v2");
    expect(name?.querySelectorAll("wbr")).toHaveLength(2);
  });

  it("marks nothing missing before the file list has loaded", () => {
    useFiles.setState({ files: [], loaded: false });
    render(<BoardPane />);
    expect(document.querySelector(".card-note.missing")).toBeNull();
  });

  // sebaro's board (spec/02 §3.16, DAT-13): named regions, the count in the
  // head as a bare number with its hidden word, no pill.
  it("names each column by its heading and counts its cards in the head", () => {
    render(<BoardPane />);
    const columns = document.querySelectorAll("section.sb-board__column");
    expect(columns).toHaveLength(2);
    for (const column of columns) {
      const heading = document.getElementById(column.getAttribute("aria-labelledby")!)!;
      expect(heading.className).toBe("sb-board__title");
      expect(column.contains(heading)).toBe(true);
    }
    const count = columns[0]!.querySelector(".sb-board__count")!;
    expect(count.firstChild?.textContent).toBe("1");
    expect(count.querySelector(".sb-visually-hidden")?.textContent).toBe(" board.cardsWord");
  });

  // sebaro D108 (NV-Z7, NV-Z5): the heading and its counts are one group
  // before the tools, which wrap under the pair; a column's cards scroll in
  // sebaro's own scroll frame.
  it("groups the board's name and counts in its head and scrolls the cards in sebaro's frame", () => {
    useBoard.setState({ board: { ...board, cards: [card("c1", "Write the spec", "todo")] } as never });
    render(<BoardPane />);
    const head = document.querySelector(".board > .sb-window__head")!;
    const text = head.firstElementChild!;
    expect(text.className).toBe("sb-window__head-text");
    expect([...text.children].map((part) => part.className)).toEqual(["sb-window__heading", "sb-window__meta"]);
    expect(text.nextElementSibling?.className).toBe("sb-window__head-tools");
    expect(document.querySelector("ul.sb-board__cards")?.className).toBe("sb-board__cards sb-board__cards--scroll");
  });

  it("says „Noch keine Karte.“ in an empty column", () => {
    useBoard.setState({ board: { ...board, cards: [card("c1", "Write the spec", "todo")] } as never });
    render(<BoardPane />);
    const doing = document.querySelectorAll("section.sb-board__column")[1]!;
    expect(doing.querySelector("p.sb-board__empty")?.textContent).toBe("board.emptyColumn");
    expect(doing.querySelector("ul.sb-board__cards")).toBeNull();
  });

  it("shows sebaro's empty state for a board without columns, and none of the board", () => {
    useBoard.setState({ board: { ...board, columns: [], cards: [] } as never });
    render(<BoardPane />);
    expect(document.querySelector(".sb-empty .sb-empty__title")?.textContent).toBe("board.emptyTitle");
    // Under the board's heading, in its padding: sebaro's section form (D108).
    expect(document.querySelector(".sb-empty")?.className).toBe("sb-empty sb-empty--section");
    expect(document.querySelector(".sb-board")).toBeNull();
    // „Spalte hinzufügen“ stays in the head, as the sentence says.
    expect(screen.getByRole("button", { name: "board.addColumn" })).toBeTruthy();
  });

  it("has no button of its own when there is no board at all (DAT-07)", () => {
    useBoard.setState({ board: null });
    render(<BoardPane />);
    expect(document.querySelector(".sb-empty .sb-empty__title")?.textContent).toBe("board.noBoardTitle");
    expect(screen.queryByRole("button")).toBeNull();
  });

  // ADR-0050, D102 (36): „Neue Notiz“ stays the window's primary action, each
  // column ends with its own secondary „Neue Karte in „…““.
  it("adds a card to the column whose foot was pressed", async () => {
    render(<BoardPane />);
    const add = document.querySelectorAll<HTMLButtonElement>("button.sb-board__add");
    expect(add).toHaveLength(2);
    expect(add[1]!.className).toBe("sb-secondary-action sb-board__add");
    expect(add[1]!.textContent).toBe("board.newCardIn");

    fireEvent.click(add[1]!);
    await useUi.getState().prompt?.submit("Review");

    expect(useBoard.getState().apply).toHaveBeenCalledWith({
      kind: "add",
      title: "Review",
      column: "doing",
      notes: [],
      position: { kind: "last" },
    });
  });

  it("marks a card whose column is gone with the warning glyph and word", () => {
    useBoard.setState({ board: { ...board, orphanCards: ["c1"] } as never });
    render(<BoardPane />);
    const status = cardOf("Write the spec").querySelector(".sb-card__meta .sb-status.sb-status--warning")!;
    expect(status.textContent).toBe("board.columnMissing");
    expect(status.querySelector("use")?.getAttribute("href")).toBe("#warning--16");
  });

  // STA-06: a local board is read in silence.
  it("says nothing while the board is read", () => {
    useBoard.setState({ busy: true });
    render(<BoardPane />);
    expect(screen.queryByText("editor.loading")).toBeNull();
    expect(document.querySelector("section.board")?.getAttribute("aria-busy")).toBe("true");
  });

  it("names cloud-only cards it skipped in a note", () => {
    useBoard.setState({ board: { ...board, cloudOnly: ["01J x.json"] } as never });
    render(<BoardPane />);
    const callout = screen.getByRole("note");
    expect(callout.className).toContain("sb-callout--note");
    expect(callout.textContent).toContain("errors.cloudOnlySkipped");
  });

  // FOR-05, NAV-01: only the card the focus is in carries the place line.
  it("makes the card with the focus the current one, and only it", () => {
    render(<BoardPane />);
    const first = cardOf("Write the spec");
    const second = cardOf("Ship it");
    expect(first.getAttribute("aria-current")).toBeNull();

    act(() => first.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!.focus());
    expect(first.getAttribute("aria-current")).toBe("true");
    expect(second.getAttribute("aria-current")).toBeNull();

    act(() => second.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!.focus());
    expect(first.getAttribute("aria-current")).toBeNull();
    expect(second.getAttribute("aria-current")).toBe("true");
  });

  // DSK-11, spec/02 §4.22: what is dragged, where it lands; no half opacity.
  describe("drag marks", () => {
    const transfer = (types: string[]) => ({
      types,
      setData: vi.fn(),
      setDragImage: vi.fn(),
      getData: () => "",
      dropEffect: "",
      effectAllowed: "",
    });

    it("frames the dragged card and shows the line after the card it would land behind", () => {
      render(<BoardPane />);
      const dragged = cardOf("Ship it");
      const target = cardOf("Write the spec");
      const data = transfer(["text/plain", "application/x-novalis-card"]);

      fireEvent.dragStart(dragged, { dataTransfer: data });
      expect(dragged.getAttribute("data-sb-state")).toBe("dragging");
      // No ghost under the pointer.
      expect(data.setDragImage).toHaveBeenCalled();

      fireEvent.dragOver(target, { dataTransfer: data });
      expect(target.getAttribute("data-sb-state")).toBe("drop-after");

      fireEvent.dragEnd(dragged, { dataTransfer: data });
      expect(dragged.getAttribute("data-sb-state")).toBeNull();
      expect(target.getAttribute("data-sb-state")).toBeNull();
    });

    it("frames the column when the card would go last", () => {
      render(<BoardPane />);
      const data = transfer(["text/plain", "application/x-novalis-card"]);
      fireEvent.dragStart(cardOf("Write the spec"), { dataTransfer: data });
      const doing = document.querySelectorAll("section.sb-board__column")[1]!;

      fireEvent.dragOver(doing.querySelector(".sb-board__head")!, { dataTransfer: data });

      expect(doing.getAttribute("data-sb-state")).toBe("drop-into");
      fireEvent.drop(doing, { dataTransfer: data });
      expect(useBoard.getState().apply).toHaveBeenCalledWith({
        kind: "move",
        id: "c1",
        column: "doing",
        position: { kind: "last" },
      });
      expect(doing.getAttribute("data-sb-state")).toBeNull();
    });

    it("drops after the card the line was shown behind", () => {
      render(<BoardPane />);
      const data = transfer(["text/plain", "application/x-novalis-card"]);
      fireEvent.dragStart(cardOf("Ship it"), { dataTransfer: data });
      const target = cardOf("Write the spec");

      fireEvent.dragOver(target, { dataTransfer: data });
      fireEvent.drop(target, { dataTransfer: data });

      expect(useBoard.getState().apply).toHaveBeenCalledWith({
        kind: "move",
        id: "c2",
        column: "todo",
        position: { kind: "after", id: "c1" },
      });
    });

    // spec/02 §4.22, ADR-0051 #42: the upper half of a card drops before it,
    // the lower half after it, so a card can go first.
    describe("by the half of the card", () => {
      /** A drag event over `card` at `y`, the card standing at 100–140 px. */
      const overAt = (card: Element, y: number, data: ReturnType<typeof transfer>, type = "dragOver") => {
        card.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140, left: 0, right: 200, width: 200 }) as DOMRect;
        const event = createEvent[type as "dragOver"](card, { dataTransfer: data });
        Object.defineProperty(event, "clientY", { value: y });
        fireEvent(card, event);
      };

      beforeEach(() => {
        useBoard.setState({
          board: {
            ...board,
            cards: [...board.cards, card("c3", "Review", "todo"), card("c4", "Release", "todo")],
          } as never,
        });
      });

      it("shows the line before the card from its upper half and after it from the lower", () => {
        render(<BoardPane />);
        const data = transfer(["text/plain", "application/x-novalis-card"]);
        fireEvent.dragStart(cardOf("Ship it"), { dataTransfer: data });
        const target = cardOf("Review");
        overAt(target, 110, data);
        expect(target.getAttribute("data-sb-state")).toBe("drop-before");
        overAt(target, 130, data);
        expect(target.getAttribute("data-sb-state")).toBe("drop-after");
      });

      it("drops a card first from the upper half of the first card", () => {
        render(<BoardPane />);
        const data = transfer(["text/plain", "application/x-novalis-card"]);
        fireEvent.dragStart(cardOf("Ship it"), { dataTransfer: data });
        const target = cardOf("Write the spec");
        overAt(target, 105, data);
        overAt(target, 105, data, "drop");
        expect(useBoard.getState().apply).toHaveBeenCalledWith({
          kind: "move",
          id: "c2",
          column: "todo",
          position: { kind: "first" },
        });
      });

      it("drops before a card as after the one above it, the moving card left out", () => {
        render(<BoardPane />);
        const data = transfer(["text/plain", "application/x-novalis-card"]);
        fireEvent.dragStart(cardOf("Ship it"), { dataTransfer: data });
        overAt(cardOf("Release"), 101, data);
        overAt(cardOf("Release"), 101, data, "drop");
        expect(useBoard.getState().apply).toHaveBeenLastCalledWith({
          kind: "move",
          id: "c2",
          column: "todo",
          position: { kind: "after", id: "c3" },
        });

        // The first card dragged before the second goes first again.
        fireEvent.dragStart(cardOf("Write the spec"), { dataTransfer: data });
        overAt(cardOf("Review"), 101, data);
        overAt(cardOf("Review"), 101, data, "drop");
        expect(useBoard.getState().apply).toHaveBeenLastCalledWith({
          kind: "move",
          id: "c1",
          column: "todo",
          position: { kind: "first" },
        });
      });

      // A drag let go before it leaves its card moves nothing, from either half.
      it("leaves a card dropped on itself where it is", () => {
        render(<BoardPane />);
        const data = transfer(["text/plain", "application/x-novalis-card"]);
        for (const y of [105, 135]) {
          fireEvent.dragStart(cardOf("Review"), { dataTransfer: data });
          overAt(cardOf("Review"), y, data);
          expect(cardOf("Review").getAttribute("data-sb-state")).toBe("dragging");
          overAt(cardOf("Review"), y, data, "drop");
          expect(cardOf("Review").getAttribute("data-sb-state")).toBeNull();
        }
        expect(useBoard.getState().apply).not.toHaveBeenCalled();
      });

      it("puts a note from the tree before the card too", () => {
        render(<BoardPane />);
        const data = { ...transfer(["text/plain"]), getData: () => "Spec.md" };
        overAt(cardOf("Write the spec"), 110, data);
        overAt(cardOf("Write the spec"), 110, data, "drop");
        expect(useBoard.getState().apply).toHaveBeenCalledWith({
          kind: "add",
          title: "Spec",
          column: "todo",
          notes: ["Spec.md"],
          position: { kind: "first" },
        });
      });
    });

    it("marks nothing for what the board does not take, a tab", () => {
      render(<BoardPane />);
      const doing = document.querySelectorAll("section.sb-board__column")[1]!;
      fireEvent.dragOver(doing, { dataTransfer: transfer(["application/x-novalis-tab"]) });
      expect(document.querySelector("[data-sb-state]")).toBeNull();
    });
  });

  // spec/02 §3.16 weak point 1: the narrow board's position bar, the React
  // counterpart of sb-board.js (ADR-0051 #21). sebaro.css shows it only
  // while the columns are swiped.
  it("names the column in place and steps to the next one", () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      render(<BoardPane />);
      const nav = document.querySelector(".sb-board__nav")!;
      expect(nav.querySelector(".sb-board__position")?.textContent).toBe("board.position");
      expect(nav.querySelector(".sb-board__position")?.getAttribute("aria-live")).toBe("polite");
      const previous = screen.getByRole("button", { name: "board.previousColumn", hidden: true });
      expect(previous.getAttribute("aria-disabled")).toBe("true");

      fireEvent.click(screen.getByRole("button", { name: "board.nextColumn", hidden: true }));

      expect(scrolled).toEqual([document.querySelectorAll("section.sb-board__column")[1]]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
