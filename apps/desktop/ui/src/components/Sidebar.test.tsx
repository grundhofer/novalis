import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { moveArea, trackAreaFocus } from "../lib/areas";
import { dispatchCommand, moveEntry, openTreeContextMenu } from "../lib/commands";
import { useBoard } from "../stores/board";
import { useFiles } from "../stores/files";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import Sidebar, { revealInSideNav } from "./Sidebar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// jsdom has no layout, so the real virtualizer measures a 0 px scroller and
// renders no rows at all (ADR-0011: layout is not covered here). Every row is
// materialized instead; the tree's own logic is what is under test.
const scrollToIndex = vi.hoisted(() => vi.fn());
/** The row height the tree asked the virtualizer for. */
const estimated = vi.hoisted(() => ({ size: 0 }));
/** Asked when the rows must be placed again (a new row height). */
const measure = vi.hoisted(() => vi.fn());
const measureElement = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-virtual", () => ({
  defaultRangeExtractor: () => [],
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => {
    estimated.size = estimateSize();
    const size = estimated.size;
    return {
      getTotalSize: () => count * size,
      getVirtualItems: () =>
        Array.from({ length: count }, (_, index) => ({ index, key: index, size, start: index * size })),
      scrollToIndex,
      measure,
      measureElement,
    };
  },
}));
vi.mock("../ipc/client", () => ({
  commands: {},
  unwrap: vi.fn(),
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));
// The head controls and the today row hand a command id to the dispatcher,
// and a drop hands `moveEntry` two paths; what the command then does is
// `lib/commands.ts`'s business, not the tree's.
vi.mock("../lib/commands", () => ({
  dispatchCommand: vi.fn(),
  moveEntry: vi.fn(async () => undefined),
  openTreeContextMenu: vi.fn(async () => undefined),
}));

// A Finder drop copies through `lib/attachments` (ADR-0041); what the copy
// writes is that module's business.
vi.mock("../lib/attachments", () => ({
  copyIntoFolder: vi.fn(async (folder: string, file: File) =>
    file.type === "application/pdf" ? `${folder}/${file.name}` : null,
  ),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
/** The tree's scroll box, which also holds its empty state. */
const treeBox = () => document.querySelector<HTMLElement>(".nv-tree")!;

/**
 * jsdom has no `DataTransfer`; this carries the payloads the tree and the
 * board pane set, per type, so the drop reads back what dragstart wrote and
 * `types` lists what a dragover can see — a real store hides the data until
 * the drop, so the tree decides by the types.
 */
function dragStore() {
  const data = new Map<string, string>();
  return {
    setData: (type: string, value: string) => {
      data.set(type, value);
    },
    getData: (type: string) => data.get(type) ?? "",
    get types() {
      return [...data.keys()];
    },
    effectAllowed: "",
    dropEffect: "",
    /** The image the tree drags instead of the row's ghost. */
    dragImage: null as Element | null,
    setDragImage(image: Element) {
      this.dragImage = image;
    },
  };
}

const entry = (path: string, dir: boolean, mtimeNs = "0") => ({
  path,
  name: path,
  dir,
  size: "0",
  mtimeNs,
  cloudOnly: false,
  boardSlug: null,
  conflictCopyOf: null,
});

/** The tree rows' names, top to bottom; the today row is not a tree item. */
const rowNames = () =>
  screen.getAllByRole("treeitem").map((row) => row.querySelector(".sb-row__name")?.textContent);

describe("Sidebar", () => {
  beforeEach(() => {
    useVault.getState().setVault({ root: "/v", name: "v", kind: "local", boards: [] }, [
      entry("Notes", true),
      entry("a.md", false),
    ]);
    useTabs.setState({ tabs: [], active: null });
    useUi.setState({
      message: null,
      boardVisible: false,
      settingsView: false,
      activeBoard: null,
      treeSort: "name",
      sidebarVisible: true,
    });
    // The two ADR-0019 moves are the store's; the tree only names the place
    // and the board.
    useBoard.setState({
      boards: [],
      slug: null,
      board: null,
      placeBoard: vi.fn().mockResolvedValue(undefined),
      moveCardToBoard: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(dispatchCommand).mockClear();
  });

  // The defect: a click on a tree row fired `void useTabs.getState().open()`
  // / `void useVault.getState().toggleFolder()` with no handler, so a note
  // that could not be read or a folder that could not be listed rejected into
  // `unhandledrejection` and painted the fatal overlay over a working window.
  // Both are said in the action zone now (`report`, stores/ui.ts).
  it("reports a note that cannot be opened in the action zone", async () => {
    const boom = new Error("EACCES");
    useTabs.setState({ open: vi.fn().mockRejectedValue(boom) });
    render(<Sidebar />);

    fireEvent.click(screen.getByText("a.md"));
    await flush();

    expect(useUi.getState().message).toEqual({
      key: "errors.internal",
      values: { detail: String(boom) },
    });
  });

  it("reports a folder that cannot be listed in the action zone", async () => {
    const boom = new Error("EACCES");
    useVault.setState({ toggleFolder: vi.fn().mockRejectedValue(boom) });
    render(<Sidebar />);

    fireEvent.click(screen.getByText("Notes"));
    await flush();

    expect(useUi.getState().message).toEqual({
      key: "errors.internal",
      values: { detail: String(boom) },
    });
  });

  // ADR-0012: the head controls are the menu items, reached by mouse. They
  // dispatch by id so a click and `Cmd+N` cannot drift apart.
  it("dispatches the three head controls by command id", () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByLabelText("menu.file.newNote"));
    fireEvent.click(screen.getByLabelText("menu.file.newFolder"));
    fireEvent.click(screen.getByLabelText("tree.board"));

    expect(vi.mocked(dispatchCommand).mock.calls).toEqual([
      ["file.newNote"],
      ["tree.newFolder"],
      ["board.toggle"],
    ]);
  });

  // A toggle keeps its name and says its state (NAV-10, spec/02 §4.18).
  it("presses the board tool while the board is shown, under the same name", () => {
    const { rerender } = render(<Sidebar />);
    expect(screen.getByLabelText("tree.board").getAttribute("aria-pressed")).toBe("false");

    useUi.setState({ boardVisible: true });
    rerender(<Sidebar />);

    expect(screen.getByLabelText("tree.board").getAttribute("aria-pressed")).toBe("true");
  });

  it("re-orders the files, folders first, when the legend switches the sort", () => {
    useVault.getState().setVault({ root: "/v", name: "v", kind: "local", boards: [] }, [
      entry("Notes", true),
      entry("a.md", false, "1000000000"),
      entry("b.md", false, "2000000000"),
    ]);
    render(<Sidebar />);
    expect(rowNames()).toEqual(["Notes", "a.md", "b.md"]);

    // sebaro's sort choice (spec/02 §4.14, D102 (3)): compact switches in a
    // named group.
    const group = screen.getByRole("group", { name: "tree.sort" });
    expect(group.className).toBe("sb-sort-choice");
    const byName = () => within(group).getByRole("button", { name: /^tree\.columnName/ });
    const byModified = () => within(group).getByRole("button", { name: /^tree\.columnModified/ });
    expect(byName().className).toBe("sb-secondary-action sb-secondary-action--compact");
    fireEvent.click(byModified());

    expect(useUi.getState().treeSort).toBe("modified");
    expect(rowNames()).toEqual(["Notes", "b.md", "a.md"]);
    expect(byModified().getAttribute("aria-pressed")).toBe("true");
    expect(byName().getAttribute("aria-pressed")).toBe("false");
    // The direction: the sprite's arrow (sebaro.css shows it on the chosen
    // one only) and the hidden word, on the chosen one only.
    expect(byModified().querySelector("use")?.getAttribute("href")).toBe("#arrow-down--16");
    expect(byName().querySelector("use")?.getAttribute("href")).toBe("#arrow-up--16");
    expect(byModified().textContent).toBe("tree.columnModifiedtree.sortDescending");
    expect(byName().textContent).toBe("tree.columnName");
  });

  it("draws a board as a root row that opens it", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    useBoard.setState({ boards: [{ slug: "atlas", name: "Atlas", order: null }], load });
    render(<Sidebar />);

    const row = screen.getByText("Atlas").closest("[role=treeitem]");
    expect(row?.querySelector(".sb-row__meta")?.textContent).toBe("tree.board");
    expect(row?.querySelector(".sb-row__icon use")?.getAttribute("href")).toBe("#board");

    fireEvent.click(row!);
    await flush();

    expect(useUi.getState().activeBoard).toBe("atlas");
    expect(load).toHaveBeenCalledWith("atlas");
  });

  // The board directory is also an entry of the `boards` folder. Expanded,
  // that folder used to draw the board a second time, in place.
  it("draws a board once when its directory is listed under an expanded boards folder", () => {
    useBoard.setState({ boards: [{ slug: "atlas", name: "Atlas", order: null }] });
    useVault.setState({
      children: {
        "": [entry("boards", true), entry("a.md", false)],
        boards: [{ ...entry("boards/atlas", true), name: "atlas", boardSlug: "atlas" }],
      },
      expanded: { boards: true },
    });
    render(<Sidebar />);

    const metas = screen.getAllByRole("treeitem").map((row) => row.querySelector(".sb-row__meta")?.textContent);
    expect(metas.filter((meta) => meta === "tree.board")).toHaveLength(1);
    expect(screen.queryByText("atlas")).toBeNull();
    expect(rowNames()).toEqual(["boards", "a.md", "Atlas"]);
  });

  // DSK-02, NAV-10: the place „Einstellungen“ bottom left, icon and word;
  // until the settings view exists it opens the palette's settings.
  // spec/02 §4.17, DSK-04: hidden, the part stays in the page with `hidden`,
  // so the tool's and the divider's `aria-controls` always find it.
  it("stays in the page with hidden while the sidebar is hidden", () => {
    const { container } = render(<Sidebar />);
    const nav = container.querySelector("nav#sidebar")!;
    expect(nav.hasAttribute("hidden")).toBe(false);
    act(() => useUi.setState({ sidebarVisible: false }));
    expect(container.querySelector("nav#sidebar")).toBe(nav);
    expect(nav.hasAttribute("hidden")).toBe(true);
  });

  // spec/02 §4.17, DSK-04: over the content of a narrow window it shows only
  // while its overlay is open; the choice beside the content waits.
  it("shows over a narrow window only while its overlay is open", () => {
    const { container } = render(<Sidebar />);
    const nav = container.querySelector("nav#sidebar")!;
    act(() => useUi.setState({ sidebarVisible: true, sidebarOverlay: true, sidebarOverlayOpen: false }));
    expect(nav.hasAttribute("hidden")).toBe(true);
    act(() => useUi.setState({ sidebarOverlayOpen: true }));
    expect(nav.hasAttribute("hidden")).toBe(false);
    act(() => useUi.setState({ sidebarOverlay: false, sidebarOverlayOpen: false }));
    expect(nav.hasAttribute("hidden")).toBe(false);
  });

  it("opens the settings from the place at the sidebar's foot", () => {
    const { container } = render(<Sidebar />);
    const place = screen.getByRole("button", { name: "sidebar.settings" });
    expect(place.className).toBe("sb-side-nav__item");
    // sebaro's foot (spec/02 §4.17, D105 (46)): the last part of the sidebar.
    expect(place.closest(".sb-side-nav__foot")).toBe(container.querySelector("nav > div:last-child"));
    // DSK-02: the foot is no part of the block that scrolls, so at large
    // text it never lies over the tree's rows; the tree is in that block.
    const scroll = container.querySelector("nav > .sb-side-nav__scroll")!;
    expect(scroll.nextElementSibling).toBe(place.closest(".sb-side-nav__foot"));
    expect(scroll.querySelector(".nv-tree")).toBe(treeBox());
    expect(scroll.contains(place)).toBe(false);
    expect(place.querySelector("svg.sb-icon--20 use")?.getAttribute("href")).toBe("#settings");
    // ZUG-09: the one word hyphenates where it alone does not fit its line.
    expect(place.querySelector(".sb-hyphenate")?.textContent).toBe("sidebar.settings");
    // sebaro's fixed ⌘, (spec/02 §4.19): announced, no own-shortcut mark.
    expect(place.getAttribute("aria-keyshortcuts")).toBe("Meta+,");
    expect(place.hasAttribute("data-sb-own-shortcut")).toBe(false);
    expect(place.hasAttribute("aria-current")).toBe(false);
    fireEvent.click(place);
    expect(dispatchCommand).toHaveBeenCalledWith("settings.open");
  });

  // NAV-01, DSK-02 (ADR-0051 #1): while the settings view shows, its place
  // is the current one — the place line and the filled icon — and the board
  // tool is not pressed, since the view covers the board.
  it("marks the settings place current while the settings view shows", () => {
    useUi.setState({ boardVisible: true });
    render(<Sidebar />);
    const place = screen.getByRole("button", { name: "sidebar.settings" });
    const board = screen.getByLabelText("tree.board");
    expect(board.getAttribute("aria-pressed")).toBe("true");

    act(() => useUi.setState({ settingsView: true }));
    expect(place.getAttribute("aria-current")).toBe("page");
    expect(place.querySelector("use")?.getAttribute("href")).toBe("#settings--filled");
    expect(board.getAttribute("aria-pressed")).toBe("false");

    act(() => useUi.setState({ settingsView: false, boardVisible: false }));
    expect(place.hasAttribute("aria-current")).toBe(false);
    expect(place.querySelector("use")?.getAttribute("href")).toBe("#settings");
  });

  // STA-07, HAL-05 (ADR-0051 #15): the totals of the cloud-only notes and
  // the conflict copies are said once, in the action zone; the foot holds
  // the settings place only, and no number stands on the sidebar.
  it("keeps the foot to the settings place, with no second total", () => {
    useVault.getState().setVault({ root: "/v", name: "v", kind: "local", boards: [] }, [
      { ...entry("a.md", false), cloudOnly: true },
      entry("b.md", false),
      { ...entry("b-MacBook.md", false), conflictCopyOf: "b.md" },
    ]);
    const { container } = render(<Sidebar />);

    const foot = container.querySelector(".sb-side-nav__foot")!;
    expect(foot.querySelectorAll("li")).toHaveLength(1);
    expect(foot.textContent).toBe("sidebar.settings");
    expect(foot.querySelector(".hint, .hint-dot")).toBeNull();
    // The rows say their state as glyph and word, never a count.
    const states = [...container.querySelectorAll(".sb-status")].map((status) => status.textContent);
    expect(states).toEqual(["tree.cloudOnly", "tree.conflictCopy"]);
  });

  // NAV-10, NAV-02: Today is a place, icon and word, not a tree row.
  it("opens today's note from its place", () => {
    render(<Sidebar />);

    const place = screen.getByRole("button", { name: "tree.todayNote" });
    expect(place.className).toBe("sb-side-nav__item");
    expect(place.closest("[role=tree]")).toBeNull();
    expect(place.getAttribute("aria-keyshortcuts")).toBe("Meta+J");
    // ⌘J is novalis' own, not one of sebaro's fixed chords (spec/02 §4.19).
    expect(place.hasAttribute("data-sb-own-shortcut")).toBe(true);
    expect(place.getAttribute("aria-current")).toBeNull();
    expect(place.querySelector("svg.sb-icon--20 use")?.getAttribute("href")).toBe("#home");
    // spec/02 §4.3, §4.14: the places stand in their own list before the
    // head, which sits right above the rows it labels.
    const places = place.closest("ul")!;
    expect(places.parentElement?.className).toBe("sb-side-nav__scroll");
    expect(places.parentElement?.parentElement?.id).toBe("sidebar");
    expect(places.nextElementSibling?.className).toBe("sb-side-nav__head");
    fireEvent.click(place);

    expect(dispatchCommand).toHaveBeenCalledWith("file.todayNote");
  });

  // ADR-0018: a file row dragged onto a folder row moves the file there. The
  // tree only carries the two paths; the move is `moveEntry`'s. jsdom fires
  // the events but does not drag (ADR-0011), so the data store is a stub.
  describe("drag and drop", () => {
    const row = (name: string) => screen.getByText(name).closest("[role=treeitem]") as HTMLElement;

    it("moves the dropped file into the folder row", () => {
      render(<Sidebar />);
      const dataTransfer = dragStore();

      fireEvent.dragStart(row("a.md"), { dataTransfer });
      expect(dataTransfer.effectAllowed).toBe("move");
      // `false`: the dragover was cancelled, which is how a target says yes.
      expect(fireEvent.dragOver(row("Notes"), { dataTransfer })).toBe(false);
      fireEvent.drop(row("Notes"), { dataTransfer });

      expect(moveEntry).toHaveBeenCalledWith("a.md", "Notes");
      // A drag is not a click: nothing was selected or opened on the way.
      expect(useVault.getState().selected).toBeNull();
      expect(useTabs.getState().tabs).toEqual([]);
    });

    it("marks the folder row while a drag is over it and clears it when the drag leaves", () => {
      render(<Sidebar />);
      const dataTransfer = dragStore();

      fireEvent.dragStart(row("a.md"), { dataTransfer });
      fireEvent.dragOver(row("Notes"), { dataTransfer });
      expect(row("Notes").dataset.sbState).toBe("drop-into");

      fireEvent.dragLeave(row("Notes"), { dataTransfer });
      expect(row("Notes").dataset.sbState).toBeUndefined();
    });

    it("takes no file on a board row", () => {
      useBoard.setState({ boards: [{ slug: "atlas", name: "Atlas", order: null }] });
      render(<Sidebar />);
      const dataTransfer = dragStore();

      fireEvent.dragStart(row("a.md"), { dataTransfer });
      expect(fireEvent.dragOver(row("Atlas"), { dataTransfer })).toBe(true);
      expect(row("Atlas").dataset.sbState).toBeUndefined();
      fireEvent.drop(row("Atlas"), { dataTransfer });

      expect(moveEntry).not.toHaveBeenCalled();
      expect(useBoard.getState().placeBoard).not.toHaveBeenCalled();
      expect(useBoard.getState().moveCardToBoard).not.toHaveBeenCalled();
    });

    it("moves a file dropped on the tree's empty space into the vault root", () => {
      const { container } = render(<Sidebar />);
      const dataTransfer = dragStore();
      const scroller = container.querySelector(".nv-tree") as HTMLElement;
      const inner = container.querySelector(".sb-tree") as HTMLElement;

      fireEvent.dragStart(row("a.md"), { dataTransfer });
      expect(fireEvent.dragOver(scroller, { dataTransfer })).toBe(false);
      // The whole tree takes the drop frame (spec/02 §4.22, NV-G6); over a
      // row that takes nothing it goes again.
      expect(inner.getAttribute("data-sb-state")).toBe("drop-into");
      fireEvent.dragOver(row("a.md"), { dataTransfer });
      expect(inner.hasAttribute("data-sb-state")).toBe(false);
      fireEvent.dragOver(scroller, { dataTransfer });
      fireEvent.drop(inner, { dataTransfer });

      expect(moveEntry).toHaveBeenCalledWith("a.md", "");
      expect(inner.hasAttribute("data-sb-state")).toBe(false);
    });

    // ADR-0019: a board row drags under its own type, never `text/plain`, so
    // a folder row cannot mistake it for a file; dropped on another board it
    // goes after that one, dropped on the tree's space it goes last. The key
    // is the shell's — the tree only names the place.
    describe("boards", () => {
      beforeEach(() => {
        useBoard.setState({
          boards: [
            { slug: "atlas", name: "Atlas", order: null },
            { slug: "zeta", name: "Zeta", order: null },
          ],
        });
      });

      it("places the dragged board after the board row it is dropped on", () => {
        render(<Sidebar />);
        const dataTransfer = dragStore();

        expect(row("Atlas").getAttribute("draggable")).toBe("true");
        fireEvent.dragStart(row("Atlas"), { dataTransfer });
        expect(dataTransfer.types).toEqual(["application/x-novalis-board"]);
        expect(dataTransfer.effectAllowed).toBe("move");
        expect(fireEvent.dragOver(row("Zeta"), { dataTransfer })).toBe(false);
        // Placed after it: the cobalt line below the row (spec/02 §4.22).
        expect(row("Zeta").dataset.sbState).toBe("drop-after");
        fireEvent.drop(row("Zeta"), { dataTransfer });

        expect(useBoard.getState().placeBoard).toHaveBeenCalledWith("atlas", { kind: "after", id: "zeta" });
        expect(row("Zeta").dataset.sbState).toBeUndefined();
        expect(moveEntry).not.toHaveBeenCalled();
      });

      it("places a board dropped on the tree's empty space last", () => {
        const { container } = render(<Sidebar />);
        const dataTransfer = dragStore();
        const scroller = container.querySelector(".nv-tree") as HTMLElement;
        const inner = container.querySelector(".sb-tree") as HTMLElement;

        fireEvent.dragStart(row("Atlas"), { dataTransfer });
        expect(fireEvent.dragOver(scroller, { dataTransfer })).toBe(false);
        fireEvent.drop(inner, { dataTransfer });

        expect(useBoard.getState().placeBoard).toHaveBeenCalledWith("atlas", { kind: "last" });
        expect(moveEntry).not.toHaveBeenCalled();
      });

      it("does nothing for a board dropped on its own row", () => {
        render(<Sidebar />);
        const dataTransfer = dragStore();

        fireEvent.dragStart(row("Atlas"), { dataTransfer });
        fireEvent.drop(row("Atlas"), { dataTransfer });

        expect(useBoard.getState().placeBoard).not.toHaveBeenCalled();
      });

      it("neither moves nor places a board dropped on a folder row", () => {
        render(<Sidebar />);
        const dataTransfer = dragStore();

        fireEvent.dragStart(row("Atlas"), { dataTransfer });
        expect(fireEvent.dragOver(row("Notes"), { dataTransfer })).toBe(true);
        expect(row("Notes").dataset.sbState).toBeUndefined();
        fireEvent.drop(row("Notes"), { dataTransfer });

        expect(useBoard.getState().placeBoard).not.toHaveBeenCalled();
        expect(moveEntry).not.toHaveBeenCalled();
      });
    });

    // ADR-0019: a card dragged out of the board pane carries its own type
    // beside the `text/plain` the column drop needs; a board row takes it
    // and the store moves the card there. Nothing else in the tree does.
    describe("cards", () => {
      const cardDrag = () => {
        const dataTransfer = dragStore();
        dataTransfer.setData("text/plain", "c1");
        dataTransfer.setData("application/x-novalis-card", "c1");
        return dataTransfer;
      };

      beforeEach(() => {
        useBoard.setState({
          boards: [
            { slug: "atlas", name: "Atlas", order: null },
            { slug: "zeta", name: "Zeta", order: null },
          ],
        });
      });

      it("moves a card dropped on a board row to that board", () => {
        render(<Sidebar />);
        const dataTransfer = cardDrag();

        expect(fireEvent.dragOver(row("Zeta"), { dataTransfer })).toBe(false);
        expect(row("Zeta").dataset.sbState).toBe("drop-into");
        fireEvent.drop(row("Zeta"), { dataTransfer });

        expect(useBoard.getState().moveCardToBoard).toHaveBeenCalledWith("c1", "zeta");
        expect(useBoard.getState().placeBoard).not.toHaveBeenCalled();
        expect(moveEntry).not.toHaveBeenCalled();
      });

      it("takes no card on a folder row or the tree's empty space", () => {
        const { container } = render(<Sidebar />);
        const dataTransfer = cardDrag();
        const scroller = container.querySelector(".nv-tree") as HTMLElement;
        const inner = container.querySelector(".sb-tree") as HTMLElement;

        expect(fireEvent.dragOver(row("Notes"), { dataTransfer })).toBe(true);
        expect(row("Notes").dataset.sbState).toBeUndefined();
        fireEvent.drop(row("Notes"), { dataTransfer });
        expect(fireEvent.dragOver(scroller, { dataTransfer })).toBe(true);
        fireEvent.drop(inner, { dataTransfer });

        expect(useBoard.getState().moveCardToBoard).not.toHaveBeenCalled();
        expect(moveEntry).not.toHaveBeenCalled();
      });
    });
  });

  // ADR-0021: a right-click on a row asks for the context menu for that row
  // and does not open or expand it; the browser's own menu stays away.
  it("asks for the context menu on right-click, naming a board row", () => {
    useBoard.setState({ boards: [{ slug: "atlas", name: "Atlas", order: null }] });
    useVault.setState({
      children: {
        "": [entry("boards", true), entry("a.md", false)],
        boards: [{ ...entry("boards/atlas", true), name: "atlas", boardSlug: "atlas" }],
      },
      expanded: { boards: true },
    });
    render(<Sidebar />);

    const onRow = fireEvent.contextMenu(screen.getByText("a.md"));
    expect(onRow).toBe(false);
    expect(openTreeContextMenu).toHaveBeenLastCalledWith("a.md", false, false);

    // A folder row says so: it gets no Move To… (ADR-0018).
    fireEvent.contextMenu(screen.getByText("boards"));
    expect(openTreeContextMenu).toHaveBeenLastCalledWith("boards", false, true);

    fireEvent.contextMenu(screen.getByText("Atlas"));
    expect(openTreeContextMenu).toHaveBeenLastCalledWith("boards/atlas", true, true);
    expect(useTabs.getState().open).not.toHaveBeenCalled();
  });

  // Conflict copies at stage 0 (DECISIONS.md 2026-09-20): findable in the
  // tree, with the note they shadow as the tooltip.
  it("marks a sync client's conflict copy and names what it shadows", () => {
    useVault.getState().setVault({ root: "/v", name: "v", kind: "local", boards: [] }, [
      entry("a.md", false),
      { ...entry("a-MacBook.md", false), conflictCopyOf: "a.md" },
    ]);
    render(<Sidebar />);

    const badges = screen.getAllByText("tree.conflictCopy");
    expect(badges).toHaveLength(1);
    expect(badges[0]?.closest("[role=treeitem]")?.querySelector(".sb-row__name")?.textContent).toBe("a-MacBook.md");
    expect(badges[0]?.getAttribute("title")).toBe("a.md");
    // A conflict asks for a choice: the warning glyph (STA-08, D92).
    expect(badges[0]?.className).toBe("sb-status sb-status--warning");
    expect(badges[0]?.querySelector("use")?.getAttribute("href")).toBe("#warning--16");
  });

  // The tree's own keys (a defect by the 2026-09-20 record: rows could only
  // be clicked), sebaro's contract since ADR-0051 #12 (NAV-11, spec/02
  // §4.14): they move focus, never the choice, and open nothing; Enter or
  // Space opens the row as a click does.
  describe("keyboard", () => {
    const toggleFolder = vi.fn(async () => undefined);
    const open = vi.fn(async () => undefined);

    beforeEach(() => {
      toggleFolder.mockClear();
      open.mockClear();
      useVault.setState({
        children: {
          "": [entry("Notes", true), entry("Other", true), entry("a.md", false)],
          Notes: [entry("Notes/b.md", false), entry("Notes/c.md", false)],
        },
        expanded: { Notes: true },
        selected: "Notes",
        focused: "Notes",
        takeFocus: false,
        showFocused: false,
        toggleFolder,
      });
      useTabs.setState({ active: null, open } as never);
    });

    const press = (key: string, options: { metaKey?: boolean; shiftKey?: boolean } = {}) =>
      fireEvent.keyDown(document.querySelector("[role=tree]")!, { key, ...options });
    const focusedName = () => (document.activeElement as HTMLElement | null)?.dataset.path;

    it("moves focus down and up through the drawn rows, without choosing or opening", () => {
      render(<Sidebar />);
      press("ArrowDown");
      expect(useVault.getState().focused).toBe("Notes/b.md");
      press("ArrowDown");
      press("ArrowDown");
      expect(useVault.getState().focused).toBe("Other");
      press("ArrowUp");
      expect(useVault.getState().focused).toBe("Notes/c.md");
      expect(useVault.getState().selected).toBe("Notes");
      expect(open).not.toHaveBeenCalled();
      expect(toggleFolder).not.toHaveBeenCalled();
    });

    it("gives the focused row the keyboard and the one tab stop", () => {
      render(<Sidebar />);
      press("ArrowDown");
      expect(focusedName()).toBe("Notes/b.md");
      const stops = [...document.querySelectorAll<HTMLElement>("[role=treeitem]")].filter((row) => row.tabIndex === 0);
      expect(stops.map((row) => row.dataset.path)).toEqual(["Notes/b.md"]);
      // The chosen row keeps its mark; focus is not the choice.
      expect(screen.getByText("Notes").closest("[role=treeitem]")?.getAttribute("aria-selected")).toBe("true");
      expect(screen.getByText("Notes/b.md").closest("[role=treeitem]")?.getAttribute("aria-selected")).toBe("false");
    });

    // spec/02 §4.14: one chosen row per tree, even when the active tab is
    // another file than the folder last chosen.
    it("marks one chosen row when the active tab is another file", () => {
      useTabs.setState({ active: "Notes/b.md" });
      render(<Sidebar />);
      const chosen = [...document.querySelectorAll<HTMLElement>("[role=treeitem][aria-selected=true]")];
      expect(chosen.map((row) => row.dataset.path)).toEqual(["Notes"]);
    });

    it("goes to the first and the last row with Home and End", () => {
      render(<Sidebar />);
      press("End");
      expect(useVault.getState().focused).toBe("a.md");
      press("Home");
      expect(useVault.getState().focused).toBe("Notes");
    });

    it("steps into an open folder, closes it, and goes up to the parent", () => {
      render(<Sidebar />);
      press("ArrowRight");
      expect(useVault.getState().focused).toBe("Notes/b.md");
      press("ArrowLeft");
      expect(useVault.getState().focused).toBe("Notes");
      press("ArrowLeft");
      expect(toggleFolder).toHaveBeenCalledWith("Notes");
    });

    // ← on a row of the top level has no parent to go to: focus stays.
    it("leaves focus on a top-level row with ←", () => {
      useVault.setState({ focused: "a.md" });
      render(<Sidebar />);
      press("ArrowLeft");
      expect(useVault.getState().focused).toBe("a.md");
      expect(toggleFolder).not.toHaveBeenCalled();
    });

    // NAV-11: the keys' row counts while the tree has the keyboard. Focus in
    // another area hands the commands back to the chosen row; the palette,
    // outside every area, keeps the keys' row for the command given there.
    it("gives the choice back to tree commands once focus is in another area", () => {
      render(
        <>
          <Sidebar />
          <main className="main">
            <textarea aria-label="editor" />
          </main>
          <input aria-label="palette" />
        </>,
      );
      press("ArrowDown");
      expect(useVault.getState().focused).toBe("Notes/b.md");
      fireEvent.focusIn(screen.getByLabelText("palette"));
      expect(useVault.getState().focused).toBe("Notes/b.md");
      fireEvent.focusIn(screen.getByLabelText("editor"));
      expect(useVault.getState()).toMatchObject({ focused: "Notes", selected: "Notes" });
    });

    // NAV-11, spec/02 §4.20: F6 back into the tree puts focus on the row it
    // left, and the keys act from there, not from the chosen row.
    it("makes a row that gets focus back the keys' row", () => {
      render(
        <>
          <Sidebar />
          <main className="main">
            <button type="button">editor</button>
          </main>
        </>,
      );
      press("ArrowDown");
      press("ArrowDown");
      expect(focusedName()).toBe("Notes/c.md");
      act(() => screen.getByText("editor").focus());
      expect(useVault.getState().focused).toBe("Notes");
      act(() => screen.getByText("Notes/c.md").closest<HTMLElement>("[role=treeitem]")!.focus());
      expect(useVault.getState().focused).toBe("Notes/c.md");
      const stops = [...document.querySelectorAll<HTMLElement>("[role=treeitem]")].filter((row) => row.tabIndex === 0);
      expect(stops.map((row) => row.dataset.path)).toEqual(["Notes/c.md"]);
      press("ArrowDown");
      expect(useVault.getState().focused).toBe("Other");
    });

    // The same through F6 itself: ⇧F6 back gives the tree the row that had
    // focus there last (lib/areas), and that row is the keys' row again.
    it("takes the row F6 brings focus back to as the keys' row", () => {
      const stop = trackAreaFocus();
      render(
        <>
          <Sidebar />
          <main className="main">
            <button type="button">editor</button>
          </main>
        </>,
      );
      act(() => screen.getByText("Notes").closest<HTMLElement>("[role=treeitem]")!.focus());
      press("ArrowDown");
      press("ArrowDown");
      expect(focusedName()).toBe("Notes/c.md");
      act(() => moveArea(false));
      expect(document.activeElement).toBe(screen.getByText("editor"));
      expect(useVault.getState().focused).toBe("Notes");
      act(() => moveArea(true));
      expect(focusedName()).toBe("Notes/c.md");
      expect(useVault.getState().focused).toBe("Notes/c.md");
      press("ArrowDown");
      expect(useVault.getState().focused).toBe("Other");
      stop();
    });

    // DSK-11: a row a command shows (Move To…) is scrolled into view, and
    // takes the keyboard only when asked.
    it("scrolls a shown row into view, focusing it only when asked", () => {
      render(<Sidebar />);
      scrollToIndex.mockClear();
      act(() => useVault.getState().focus("a.md", false, true));
      expect(scrollToIndex).toHaveBeenCalledWith(4);
      expect(focusedName()).toBeUndefined();
      expect(useVault.getState()).toMatchObject({ focused: "a.md", showFocused: false });
      act(() => useVault.getState().focus("Other", true));
      expect(scrollToIndex).toHaveBeenLastCalledWith(3);
      expect(focusedName()).toBe("Other");
    });

    // ZUG-09, NV-Z9: with large text the upper block scrolls; a row the tree
    // scrolls into view brings the tree's end up to the scroll part's edge,
    // not under the foot (sebaro's `revealInSideNav`). jsdom has no
    // layout, so the boxes are given.
    it("scrolls the sidebar's scroll part so the tree ends at its edge", () => {
      const { container } = render(<Sidebar />);
      const part = container.querySelector<HTMLElement>(".sb-side-nav__scroll")!;
      const tree = container.querySelector<HTMLElement>(".nv-tree")!;
      Object.defineProperty(part, "clientHeight", { configurable: true, value: 300 });
      part.getBoundingClientRect = () => ({ top: 0, bottom: 300 }) as DOMRect;
      tree.getBoundingClientRect = () => ({ top: 292 - part.scrollTop, bottom: 420 - part.scrollTop }) as DOMRect;
      act(() => useVault.getState().focus("a.md", false, true));
      expect(part.scrollTop).toBe(120);
      act(() => useVault.getState().focus("Other", true));
      expect(part.scrollTop).toBe(120);
    });

    // spec/02 §4.14, §4.17: whatever in the block takes focus is brought out
    // from under the foot, by the block alone.
    it("scrolls the scroll part when a row in it takes focus", () => {
      const { container } = render(<Sidebar />);
      const part = container.querySelector<HTMLElement>(".sb-side-nav__scroll")!;
      const tree = container.querySelector<HTMLElement>(".nv-tree")!;
      const row = container.querySelector<HTMLElement>("[role=treeitem]")!;
      Object.defineProperty(part, "clientHeight", { configurable: true, value: 300 });
      part.getBoundingClientRect = () => ({ top: 0, bottom: 300 }) as DOMRect;
      tree.getBoundingClientRect = () => ({ top: 292 - part.scrollTop, bottom: 420 - part.scrollTop }) as DOMRect;
      row.getBoundingClientRect = () => ({ top: 292 - part.scrollTop, bottom: 324 - part.scrollTop }) as DOMRect;
      // The tree scrolls by itself (app.css): its lower edge comes up too.
      tree.style.overflowY = "auto";
      Object.defineProperty(tree, "clientHeight", { configurable: true, value: 128 });
      Object.defineProperty(tree, "scrollHeight", { configurable: true, value: 1000 });
      act(() => row.focus());
      expect(tree.scrollTop).toBe(0);
      expect(part.scrollTop).toBe(120);
    });

    // The hidden sidebar stays mounted: a row a command shows while it is
    // hidden is scrolled into view once it shows, not lost.
    it("keeps a shown row for when the hidden sidebar shows", () => {
      useUi.setState({ sidebarVisible: false });
      render(<Sidebar />);
      scrollToIndex.mockClear();
      act(() => useVault.getState().focus("a.md", false, true));
      expect(scrollToIndex).not.toHaveBeenCalled();
      expect(useVault.getState().showFocused).toBe(true);
      act(() => useUi.setState({ sidebarVisible: true }));
      expect(scrollToIndex).toHaveBeenCalledWith(4);
      expect(useVault.getState().showFocused).toBe(false);
    });

    it("opens a closed folder with →", () => {
      useVault.setState({ focused: "Other" });
      render(<Sidebar />);
      press("ArrowRight");
      expect(toggleFolder).toHaveBeenCalledWith("Other");
    });

    it("opens the focused row with Enter, Space or ⌘↓, as a click does", () => {
      render(<Sidebar />);
      press("End");
      press("Enter");
      expect(open).toHaveBeenLastCalledWith("a.md");
      expect(useVault.getState().selected).toBe("a.md");
      press("ArrowUp");
      press(" ");
      expect(toggleFolder).toHaveBeenLastCalledWith("Other");
      press("ArrowUp", { metaKey: true });
      press("ArrowDown", { metaKey: true });
      expect(toggleFolder).toHaveBeenCalledTimes(2);
      expect(dispatchCommand).not.toHaveBeenCalled();
    });

    it("jumps to the next row whose name starts with the typed letters", () => {
      vi.useFakeTimers();
      try {
        render(<Sidebar />);
        press("o");
        expect(useVault.getState().focused).toBe("Other");
        // After 500 ms a letter starts a new name, searched round the tree.
        vi.advanceTimersByTime(500);
        press("n");
        expect(useVault.getState().focused).toBe("Notes");
        // The same letter again goes on to the next row with it; Shift only
        // makes it a capital.
        press("n");
        expect(useVault.getState().focused).toBe("Notes/b.md");
        press("N", { shiftKey: true });
        expect(useVault.getState().focused).toBe("Notes/c.md");
        // More letters search from the focused row; no match leaves focus.
        vi.advanceTimersByTime(500);
        press("n");
        press("o");
        expect(useVault.getState().focused).toBe("Notes");
        press("x");
        expect(useVault.getState().focused).toBe("Notes");
        expect(open).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // sebaro's markup (spec/02 §4.3, §4.13, §4.14, §4.17, §4.18; NAV-04,
  // NAV-10, NAV-11, STA-08; ADR-0051 #24). jsdom cannot see the CSS, so the
  // classes and attributes sebaro.css draws from are what is checked.
  describe("sebaro's parts", () => {
    it("is the window's named sidebar at the store's width", () => {
      useUi.setState({ sidebarWidth: 264 });
      const { container } = render(<Sidebar />);
      const nav = container.querySelector("nav")!;
      expect(nav.className).toBe("sb-side-nav sb-window__sidebar");
      expect(nav.id).toBe("sidebar");
      expect(nav.getAttribute("aria-label")).toBe("sidebar.label");
      expect(nav.style.inlineSize).toBe("264px");
    });

    it("keeps only „Einstellungen“ in its foot without a vault (ADR-0051 #1, DSK-02)", () => {
      useVault.setState({ vault: null });
      const { container } = render(<Sidebar />);
      const nav = container.querySelector("nav#sidebar")!;
      expect(nav.className).toBe("sb-side-nav sb-window__sidebar");
      // An empty scroll part above holds the foot at the sidebar's end.
      expect([...nav.children].map((part) => part.className)).toEqual(["sb-side-nav__scroll", "sb-side-nav__foot"]);
      expect(nav.querySelector(".sb-side-nav__scroll")!.childElementCount).toBe(0);
      const place = nav.querySelector<HTMLButtonElement>(".sb-side-nav__foot .sb-side-nav__item")!;
      expect(place.textContent).toBe("sidebar.settings");
      expect(place.getAttribute("aria-keyshortcuts")).toBe("Meta+,");
      expect(nav.querySelector("[role='tree'], .sb-side-nav__head")).toBeNull();
    });

    it("has three compact tools with sebaro's tooltip: name hidden, the shortcut spoken", () => {
      useUi.setState({ boardVisible: true });
      render(<Sidebar />);
      // sebaro's group head with tools (spec/02 §4.17, D104 (36)): a group
      // named after the vault at the end of the head.
      const group = document.querySelector(".sb-side-nav__head > .sb-side-nav__tools")!;
      expect(group.getAttribute("role")).toBe("group");
      expect(group.getAttribute("aria-label")).toBe("v");
      const tools = [...group.querySelectorAll<HTMLButtonElement>(":scope > button")];
      expect(tools.map((tool) => tool.getAttribute("aria-label"))).toEqual([
        "menu.file.newNote",
        "menu.file.newFolder",
        "tree.board",
      ]);
      expect(tools.map((tool) => tool.getAttribute("aria-keyshortcuts"))).toEqual([
        "Meta+N",
        "Alt+Meta+N",
        "Shift+Meta+B",
      ]);
      // ⌘N is sebaro's fixed chord; ⌥⌘N and ⇧⌘B are novalis' own (the shortcut check's S7).
      expect(tools.map((tool) => tool.hasAttribute("data-sb-own-shortcut"))).toEqual([false, true, true]);
      // Only the board is a toggle; the two others act and hold no state.
      expect(tools.map((tool) => tool.getAttribute("aria-pressed"))).toEqual([null, null, "true"]);
      for (const tool of tools) {
        expect(tool.className).toBe("sb-icon-button sb-icon-button--compact");
        expect(tool.querySelector("svg")?.getAttribute("class")).toBe("sb-icon sb-icon--20");
        expect(tool.hasAttribute("title")).toBe(false);
        const tip = document.getElementById(tool.getAttribute("aria-describedby")!)!;
        expect(tip.className).toBe("sb-tooltip");
        expect(tip.getAttribute("role")).toBe("tooltip");
        expect(tip.getAttribute("popover")).toBe("manual");
        expect(tip.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
        expect(tip.firstElementChild?.textContent).toBe(tool.getAttribute("aria-label"));
        expect(tip.querySelector(".sb-keys")).toBeTruthy();
      }
      expect(tools.map((tool) => tool.querySelector("use")?.getAttribute("href"))).toEqual([
        "#plus",
        "#folder",
        "#board",
      ]);
    });

    it("draws the tree as sebaro's tree, labelled by the vault's name", () => {
      useVault.setState({
        children: {
          "": [entry("Notes", true), entry("a.md", false)],
          Notes: [entry("Notes/b.md", false)],
        },
        expanded: { Notes: true },
      });
      const { container } = render(<Sidebar />);
      const tree = screen.getByRole("tree");
      expect(tree.tagName).toBe("UL");
      expect(tree.className).toBe("sb-tree");
      expect(document.getElementById(tree.getAttribute("aria-labelledby")!)?.textContent).toBe("v");
      expect(document.getElementById("sidebar-vault")?.className).toBe("sb-side-nav__name");
      expect(document.getElementById("sidebar-vault")?.parentElement?.className).toBe("sb-side-nav__head");
      // D100 (6): the vault's name is a folder's and breaks as one.
      expect(document.querySelector("#sidebar-vault > .sb-file-name")?.textContent).toBe("v");
      // Flat, one slot per row; the level is the row's, no inline indent.
      const rows = screen.getAllByRole("treeitem");
      for (const row of rows) {
        expect(row.className).toBe("sb-row sb-tree__row");
        expect(row.parentElement?.tagName).toBe("LI");
        expect(row.parentElement?.getAttribute("role")).toBe("none");
        expect(row.style.paddingLeft).toBe("");
        expect(row.hasAttribute("data-sb-truncate")).toBe(true);
        // The full name, and for a note the day it changed (the meta may drop it).
        const name = row.querySelector(".sb-row__name")?.textContent;
        expect(row.getAttribute("title")).toBe(row.getAttribute("aria-expanded") ? name : "tree.rowTitle");
      }
      expect(rows.map((row) => row.getAttribute("aria-level"))).toEqual(["1", "2", "1"]);
      const folder = rows[0]!;
      expect(folder.getAttribute("aria-expanded")).toBe("true");
      expect(folder.querySelector(".sb-tree__twist use")?.getAttribute("href")).toBe("#chevron-right--16");
      expect(folder.querySelector(".sb-row__icon use")?.getAttribute("href")).toBe("#folder");
      // A leaf keeps the empty twist slot, so the icons align.
      const note = rows[1]!;
      expect(note.getAttribute("aria-expanded")).toBeNull();
      expect(note.querySelector(".sb-tree__twist")?.childElementCount).toBe(0);
      expect(note.querySelector(".sb-row__icon use")?.getAttribute("href")).toBe("#file-text");
      expect(container.querySelector(".active-marker, .chev, .badge")).toBeNull();
    });

    // spec/02 §4.14: sebaro.css indents levels 1–8; deeper, the row sets it.
    it("indents a row deeper than eight levels itself", () => {
      const deep = "a/b/c/d/e/f/g/h/i";
      const folders = deep.split("/").map((_, index, parts) => parts.slice(0, index + 1).join("/"));
      const children: Record<string, ReturnType<typeof entry>[]> = { "": [entry("a", true)] };
      folders.forEach((folder, index) => {
        const next = folders[index + 1];
        children[folder] = [next ? entry(next, true) : entry(`${folder}/z.md`, false)];
      });
      useVault.setState({ children, expanded: Object.fromEntries(folders.map((folder) => [folder, true])) });
      render(<Sidebar />);
      const rows = screen.getAllByRole("treeitem");
      const level = (n: number) => rows.find((row) => row.getAttribute("aria-level") === String(n))!;
      expect(level(8).style.getPropertyValue("--sb-tree-indent")).toBe("");
      expect(level(9).style.getPropertyValue("--sb-tree-indent")).toBe("8");
      expect(level(10).style.getPropertyValue("--sb-tree-indent")).toBe("9");
    });

    // NAV-01: the current note is the chosen row, which sebaro.css gives
    // the 3 px place line, link colour and title weight; no fill, no marker.
    it("marks the current note by aria-selected alone", () => {
      useTabs.setState({ tabs: ["a.md"], active: "a.md" });
      render(<Sidebar />);
      const row = screen.getByText("a.md").closest<HTMLElement>("[role=treeitem]")!;
      expect(row.getAttribute("aria-selected")).toBe("true");
      expect(row.querySelector("[aria-hidden=true]:not(.sb-tree__twist):not(svg)")).toBeNull();
    });

    // NAV-11: the tree is flat and virtualized, so each row says its place
    // among its siblings itself.
    it("gives each row its place among its siblings", () => {
      useVault.setState({
        children: {
          "": [entry("Notes", true), entry("a.md", false), entry("b.md", false)],
          Notes: [entry("Notes/x.md", false), entry("Notes/y.md", false)],
        },
        expanded: { Notes: true },
      });
      useBoard.setState({ boards: [{ slug: "atlas", name: "Atlas", order: null }] });
      render(<Sidebar />);
      const sets = screen
        .getAllByRole("treeitem")
        .map((row) => [
          row.querySelector(".sb-row__name")?.textContent,
          row.getAttribute("aria-posinset"),
          row.getAttribute("aria-setsize"),
        ]);
      expect(sets).toEqual([
        ["Notes", "1", "4"],
        ["Notes/x.md", "1", "2"],
        ["Notes/y.md", "2", "2"],
        ["a.md", "2", "4"],
        ["b.md", "3", "4"],
        ["Atlas", "4", "4"],
      ]);
    });

    // spec/02 §4.13, §4.14: a status replaces the day in the meta, so the
    // name keeps its room; the day stands in the row's tooltip.
    it("puts a status in the meta in place of the day", () => {
      useVault.getState().setVault({ root: "/v", name: "v", kind: "local", boards: [] }, [
        { ...entry("a.md", false), cloudOnly: true },
        { ...entry("b-MacBook.md", false), conflictCopyOf: "b.md" },
        entry("c.md", false),
      ]);
      render(<Sidebar />);
      const row = (name: string) => screen.getByText(name).closest<HTMLElement>("[role=treeitem]")!;
      for (const name of ["a.md", "b-MacBook.md"]) {
        // The meta holds the status and nothing else: no day beside it.
        const meta = row(name).querySelector(".sb-row__meta")!;
        expect(meta.textContent).toBe(meta.querySelector(".sb-status")?.textContent);
        expect(row(name).getAttribute("title")).toBe("tree.rowTitle");
      }
      // The day is the meta's own text, no class of novalis' (sebaro.css keeps it on one line).
      const meta = row("c.md").querySelector(".sb-row__meta")!;
      expect(meta.querySelector(".sb-status")).toBeNull();
      expect(meta.childElementCount).toBe(0);
      expect(meta.textContent).not.toBe("");
      // The day stays in the tooltip too: large text may drop it from the meta.
      expect(row("c.md").getAttribute("title")).toBe("tree.rowTitle");
    });

    it("says online-only as a grey glyph and word", () => {
      useVault.getState().setVault({ root: "/v", name: "v", kind: "local", boards: [] }, [
        { ...entry("a.md", false), cloudOnly: true },
      ]);
      render(<Sidebar />);
      const status = screen.getByText("tree.cloudOnly");
      expect(status.className).toBe("sb-status sb-status--neutral");
      expect(status.querySelector("use")?.getAttribute("href")).toBe("#info--16");
      expect(status.getAttribute("title")).toBe("tree.cloudOnlyHint");
      expect(status.closest(".sb-row__meta")).toBeTruthy();
    });

    // RAU-06, ADR-0051 #24 (R3): the virtualizer's row is the window row at
    // the root font in use, not a fixed 28 px.
    it("asks the virtualizer for the window row's height", () => {
      const root = document.documentElement;
      root.style.fontSize = "32px";
      root.style.setProperty("--sb-size-control-sm", "32px");
      root.style.setProperty("--sb-type-label-size", "0.875rem");
      root.style.setProperty("--sb-type-label-line-height", "1.4286");
      try {
        render(<Sidebar />);
        expect(estimated.size).toBe(40);
        const slot = screen.getByText("a.md").closest("li")!;
        expect(slot.style.blockSize).toBe("40px");
        // The tree's four rows are sebaro's measure in app.css (spec/02
        // §4.14, D108), not a number of the component.
        expect(treeBox().style.minBlockSize).toBe("");
      } finally {
        root.removeAttribute("style");
      }
    });

    // ZUG-09, ADR-0051 #24 (R3): the root font changes while the sidebar is
    // open; the probe row's new height makes the tree measure its rows again.
    it("follows a root font that changes while the tree is shown", () => {
      const root = document.documentElement;
      const observers: Array<{ callback: () => void; target: Element | null }> = [];
      const original = globalThis.ResizeObserver;
      globalThis.ResizeObserver = class {
        entry: { callback: () => void; target: Element | null };
        constructor(callback: () => void) {
          this.entry = { callback, target: null };
          observers.push(this.entry);
        }
        observe(target: Element) {
          this.entry.target = target;
        }
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
      root.style.fontSize = "16px";
      root.style.setProperty("--sb-size-control-sm", "32px");
      root.style.setProperty("--sb-type-label-size", "0.875rem");
      root.style.setProperty("--sb-type-label-line-height", "1.4286");
      try {
        render(<Sidebar />);
        const slot = () => screen.getByText("a.md").closest("li")!;
        expect(slot().style.blockSize).toBe("32px");
        const probe = observers.find((observer) => observer.target?.classList.contains("nv-tree__probe"));
        expect(probe?.target?.getAttribute("aria-hidden")).toBe("true");
        expect(probe?.target?.closest("[role=tree]")).toBeNull();
        measure.mockClear();

        root.style.fontSize = "32px";
        act(() => probe!.callback());

        expect(slot().style.blockSize).toBe("40px");
        expect(measure).toHaveBeenCalled();
      } finally {
        globalThis.ResizeObserver = original;
        root.removeAttribute("style");
      }
    });

    // D108 (1), spec/02 §4.13: a status that does not fit beside the name
    // goes under it, so that row grows; the virtualizer measures every row.
    it("lets the virtualizer measure each row", () => {
      measureElement.mockClear();
      useVault.getState().setVault({ root: "/v", name: "v", kind: "local", boards: [] }, [
        { ...entry("a.md", false), cloudOnly: true },
        entry("b.md", false),
      ]);
      render(<Sidebar />);
      const row = (name: string) => screen.getByText(name).closest<HTMLElement>("[role=treeitem]")!;
      const rows = [row("a.md"), row("b.md")];
      expect(rows.map((r) => r.getAttribute("data-index"))).toEqual(["0", "1"]);
      expect(measureElement).toHaveBeenCalledWith(rows[0]);
      expect(measureElement).toHaveBeenCalledWith(rows[1]);
    });

    // DAT-07: a vault without a file says so, and how it fills.
    it("shows the empty state for a vault with nothing in it", () => {
      useVault.getState().setVault({ root: "/v", name: "v", kind: "local", boards: [] }, []);
      const { container } = render(<Sidebar />);
      expect(screen.queryByRole("tree")).toBeNull();
      const empty = container.querySelector(".nv-tree > .sb-empty")!;
      expect(empty.querySelector(".sb-empty__title")?.textContent).toBe("tree.emptyTitle");
      expect(empty.querySelector(".sb-empty__text")?.textContent).toBe("tree.empty");
      // The empty space is still the vault root's drop target.
      const dataTransfer = dragStore();
      dataTransfer.setData("text/plain", "elsewhere.md");
      expect(fireEvent.dragOver(empty, { dataTransfer })).toBe(false);
      expect(fireEvent.dragOver(empty.querySelector(".sb-empty__text")!, { dataTransfer })).toBe(false);
    });

    // spec/02 §4.22, DSK-11: the dragged row keeps an ink frame until the
    // drag ends.
    it("marks the dragged row while it is dragged", () => {
      render(<Sidebar />);
      const dataTransfer = dragStore();
      const row = screen.getByText("a.md").closest<HTMLElement>("[role=treeitem]")!;
      expect(row.hasAttribute("data-sb-drag")).toBe(true);
      expect(screen.getByText("Notes").closest("[role=treeitem]")?.hasAttribute("data-sb-drag")).toBe(false);
      fireEvent.dragStart(row, { dataTransfer });
      expect(row.dataset.sbState).toBe("dragging");
      // No ghost image of the row: the frame and the target say it (§4.22).
      expect((dataTransfer.dragImage as HTMLImageElement | null)?.src).toMatch(/^data:image\/gif/);
      fireEvent.dragEnd(row, { dataTransfer });
      expect(row.dataset.sbState).toBeUndefined();
    });

    // spec/02 §4.22, DSK-11: a row never goes into itself, so a board over
    // its own row keeps its ink frame and is not taken.
    it("does not take a board dragged over its own row", () => {
      useBoard.setState({ boards: [{ slug: "atlas", name: "Atlas", order: null }] });
      render(<Sidebar />);
      const dataTransfer = dragStore();
      const row = screen.getByText("Atlas").closest<HTMLElement>("[role=treeitem]")!;
      fireEvent.dragStart(row, { dataTransfer });
      // `true`: not cancelled, the pointer shows no drop.
      expect(fireEvent.dragOver(row, { dataTransfer })).toBe(true);
      expect(row.dataset.sbState).toBe("dragging");
    });
  });

  // ADR-0041: files from the Finder dropped on a folder are copied into it;
  // what the app cannot take is said once, not copied.
  it("copies Finder files dropped on a folder and says how many it refused", async () => {
    const { copyIntoFolder } = await import("../lib/attachments");
    const reload = vi.fn(async () => undefined);
    useVault.setState({
      children: { "": [entry("Docs", true)] },
      expanded: {},
      reload,
    });
    useFiles.setState({ refresh: vi.fn(async () => undefined) });
    useUi.setState({ message: null });
    render(<Sidebar />);
    const pdf = new File(["x"], "Scan.pdf", { type: "application/pdf" });
    const txt = new File(["x"], "a.txt", { type: "text/plain" });
    const row = screen.getByText("Docs").closest("[role=treeitem]")!;
    const dataTransfer = { types: ["Files"], files: [pdf, txt], dropEffect: "" };
    fireEvent.dragOver(row, { dataTransfer });
    fireEvent.drop(row, { dataTransfer });
    await flush();
    await flush();
    expect(vi.mocked(copyIntoFolder).mock.calls.map(([folder, file]) => [folder, file.name])).toEqual([
      ["Docs", "Scan.pdf"],
      ["Docs", "a.txt"],
    ]);
    expect(reload).toHaveBeenCalledWith("Docs");
    expect(useUi.getState().message).toEqual({ key: "tree.dropRefused", values: { count: 1 } });
  });
});

// sebaro's `revealInSideNav` (sb-window.js, spec/02 §4.14): every scroller
// from the row up to `sb-side-nav__scroll` moves, innermost first, by the
// least amount; the block also shows the tree's lower edge. jsdom has no
// layout: each box is given from the scroll positions.
describe("revealInSideNav", () => {
  const box = (element: HTMLElement, top: () => number, height: number) => {
    element.getBoundingClientRect = () => ({ top: top(), bottom: top() + height }) as DOMRect;
  };
  const scroller = (element: HTMLElement, clientHeight: number, scrollHeight: number) => {
    element.style.overflowY = "auto";
    Object.defineProperty(element, "clientHeight", { configurable: true, value: clientHeight });
    Object.defineProperty(element, "scrollHeight", { configurable: true, value: scrollHeight });
  };

  it("shows a row hidden in the tree's own scroller and the tree's end in the block", () => {
    document.body.innerHTML =
      '<main><div class="sb-side-nav__scroll"><div class="tree"><div class="row" tabindex="-1"></div></div></div></main>';
    const page = document.querySelector("main")!;
    const block = document.querySelector<HTMLElement>(".sb-side-nav__scroll")!;
    const tree = document.querySelector<HTMLElement>(".tree")!;
    const row = document.querySelector<HTMLElement>(".row")!;
    Object.defineProperty(block, "clientHeight", { configurable: true, value: 120 });
    scroller(tree, 100, 600);
    box(block, () => 0, 120);
    // The tree starts 120 px down the block's content; the row 220 px down the tree's.
    box(tree, () => 120 - block.scrollTop, 100);
    box(row, () => 120 - block.scrollTop + 220 - tree.scrollTop, 32);
    revealInSideNav(row);
    // The tree's scroller first: the row ends at its lower edge.
    expect(tree.scrollTop).toBe(152);
    // Then the block, so the tree ends at the block's edge.
    expect(block.scrollTop).toBe(100);
    expect(page.scrollTop).toBe(0);
  });

  it("leaves everything as it is when the row is in view, and outside a sidebar", () => {
    document.body.innerHTML =
      '<div class="sb-side-nav__scroll"><div class="row"></div></div><div class="other"><div class="row"></div></div>';
    const block = document.querySelector<HTMLElement>(".sb-side-nav__scroll")!;
    const [inside, outside] = [...document.querySelectorAll<HTMLElement>(".row")];
    Object.defineProperty(block, "clientHeight", { configurable: true, value: 300 });
    box(block, () => 0, 300);
    box(inside!, () => 40, 32);
    revealInSideNav(inside!);
    revealInSideNav(outside!);
    revealInSideNav(block);
    expect(block.scrollTop).toBe(0);
  });

  it("scrolls back up to a row above the block's edge", () => {
    document.body.innerHTML = '<div class="sb-side-nav__scroll"><div class="row"></div></div>';
    const block = document.querySelector<HTMLElement>(".sb-side-nav__scroll")!;
    const row = document.querySelector<HTMLElement>(".row")!;
    Object.defineProperty(block, "clientHeight", { configurable: true, value: 300 });
    block.scrollTop = 200;
    box(block, () => 0, 300);
    box(row, () => 50 - block.scrollTop, 32);
    revealInSideNav(row);
    expect(block.scrollTop).toBe(50);
  });
});
