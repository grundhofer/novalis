import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCommand, moveEntry, openTreeContextMenu } from "../lib/commands";
import { useBoard } from "../stores/board";
import { useFiles } from "../stores/files";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import Sidebar from "./Sidebar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// jsdom has no layout, so the real virtualizer measures a 0 px scroller and
// renders no rows at all (ADR-0011: layout is not covered here). Every row is
// materialized instead; the tree's own logic is what is under test.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 28,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: index, size: 28, start: index * 28 })),
    scrollToIndex: () => undefined,
  }),
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
  screen.getAllByRole("treeitem").map((row) => row.querySelector(".name")?.textContent);

describe("Sidebar", () => {
  beforeEach(() => {
    useVault.getState().setVault({ root: "/v", name: "v", kind: "local", boards: [] }, [
      entry("Notes", true),
      entry("a.md", false),
    ]);
    useTabs.setState({ tabs: [], active: null });
    useUi.setState({ toast: null, boardVisible: false, activeBoard: null, treeSort: "name" });
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
  // Both are toasts now (`report`, stores/ui.ts).
  it("reports a note that cannot be opened as a toast", async () => {
    const boom = new Error("EACCES");
    useTabs.setState({ open: vi.fn().mockRejectedValue(boom) });
    render(<Sidebar />);

    fireEvent.click(screen.getByText("a.md"));
    await flush();

    expect(useUi.getState().toast).toEqual({
      key: "errors.internal",
      values: { detail: String(boom) },
    });
  });

  it("reports a folder that cannot be listed as a toast", async () => {
    const boom = new Error("EACCES");
    useVault.setState({ toggleFolder: vi.fn().mockRejectedValue(boom) });
    render(<Sidebar />);

    fireEvent.click(screen.getByText("Notes"));
    await flush();

    expect(useUi.getState().toast).toEqual({
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
    fireEvent.click(screen.getByLabelText("menu.view.showBoard"));

    expect(vi.mocked(dispatchCommand).mock.calls).toEqual([
      ["file.newNote"],
      ["tree.newFolder"],
      ["board.toggle"],
    ]);
  });

  it("presses the board control while the board is shown", () => {
    const { rerender } = render(<Sidebar />);
    expect(screen.getByLabelText("menu.view.showBoard").getAttribute("aria-pressed")).toBe("false");

    useUi.setState({ boardVisible: true });
    rerender(<Sidebar />);

    expect(screen.queryByLabelText("menu.view.showBoard")).toBeNull();
    expect(screen.getByLabelText("menu.view.hideBoard").getAttribute("aria-pressed")).toBe("true");
  });

  it("re-orders the files, folders first, when the legend switches the sort", () => {
    useVault.getState().setVault({ root: "/v", name: "v", kind: "local", boards: [] }, [
      entry("Notes", true),
      entry("a.md", false, "1000000000"),
      entry("b.md", false, "2000000000"),
    ]);
    render(<Sidebar />);
    expect(rowNames()).toEqual(["Notes", "a.md", "b.md"]);

    fireEvent.click(screen.getByText("tree.columnModified"));

    expect(useUi.getState().treeSort).toBe("modified");
    expect(rowNames()).toEqual(["Notes", "b.md", "a.md"]);
    expect(screen.getByText("tree.columnModified").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("tree.columnName").getAttribute("aria-pressed")).toBe("false");
  });

  it("draws a board as a root row that opens it", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    useBoard.setState({ boards: [{ slug: "atlas", name: "Atlas", order: null }], load });
    render(<Sidebar />);

    const row = screen.getByText("Atlas").closest("[role=treeitem]");
    expect(row?.querySelector(".meta")?.textContent).toBe("tree.board");

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

    expect(screen.getAllByText("tree.board")).toHaveLength(1);
    expect(screen.queryByText("atlas")).toBeNull();
    expect(rowNames()).toEqual(["boards", "a.md", "Atlas"]);
  });

  it("dispatches the settings button", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByLabelText("palette.cmd.settings"));
    expect(dispatchCommand).toHaveBeenCalledWith("settings.open");
  });

  it("dispatches the today row", () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByText("tree.todayNote"));

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
      expect(row("Notes").classList.contains("drop")).toBe(true);

      fireEvent.dragLeave(row("Notes"), { dataTransfer });
      expect(row("Notes").classList.contains("drop")).toBe(false);
    });

    it("takes no file on a board row", () => {
      useBoard.setState({ boards: [{ slug: "atlas", name: "Atlas", order: null }] });
      render(<Sidebar />);
      const dataTransfer = dragStore();

      fireEvent.dragStart(row("a.md"), { dataTransfer });
      expect(fireEvent.dragOver(row("Atlas"), { dataTransfer })).toBe(true);
      expect(row("Atlas").classList.contains("drop")).toBe(false);
      fireEvent.drop(row("Atlas"), { dataTransfer });

      expect(moveEntry).not.toHaveBeenCalled();
      expect(useBoard.getState().placeBoard).not.toHaveBeenCalled();
      expect(useBoard.getState().moveCardToBoard).not.toHaveBeenCalled();
    });

    it("moves a file dropped on the tree's empty space into the vault root", () => {
      const { container } = render(<Sidebar />);
      const dataTransfer = dragStore();
      const scroller = container.querySelector(".tree") as HTMLElement;
      const inner = container.querySelector(".tree-inner") as HTMLElement;

      fireEvent.dragStart(row("a.md"), { dataTransfer });
      expect(fireEvent.dragOver(scroller, { dataTransfer })).toBe(false);
      fireEvent.drop(inner, { dataTransfer });

      expect(moveEntry).toHaveBeenCalledWith("a.md", "");
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
        expect(row("Zeta").classList.contains("drop")).toBe(true);
        fireEvent.drop(row("Zeta"), { dataTransfer });

        expect(useBoard.getState().placeBoard).toHaveBeenCalledWith("atlas", { kind: "after", id: "zeta" });
        expect(row("Zeta").classList.contains("drop")).toBe(false);
        expect(moveEntry).not.toHaveBeenCalled();
      });

      it("places a board dropped on the tree's empty space last", () => {
        const { container } = render(<Sidebar />);
        const dataTransfer = dragStore();
        const scroller = container.querySelector(".tree") as HTMLElement;
        const inner = container.querySelector(".tree-inner") as HTMLElement;

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
        expect(row("Notes").classList.contains("drop")).toBe(false);
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
        expect(row("Zeta").classList.contains("drop")).toBe(true);
        fireEvent.drop(row("Zeta"), { dataTransfer });

        expect(useBoard.getState().moveCardToBoard).toHaveBeenCalledWith("c1", "zeta");
        expect(useBoard.getState().placeBoard).not.toHaveBeenCalled();
        expect(moveEntry).not.toHaveBeenCalled();
      });

      it("takes no card on a folder row or the tree's empty space", () => {
        const { container } = render(<Sidebar />);
        const dataTransfer = cardDrag();
        const scroller = container.querySelector(".tree") as HTMLElement;
        const inner = container.querySelector(".tree-inner") as HTMLElement;

        expect(fireEvent.dragOver(row("Notes"), { dataTransfer })).toBe(true);
        expect(row("Notes").classList.contains("drop")).toBe(false);
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
    expect(openTreeContextMenu).toHaveBeenLastCalledWith("a.md", false);

    fireEvent.contextMenu(screen.getByText("Atlas"));
    expect(openTreeContextMenu).toHaveBeenLastCalledWith("boards/atlas", true);
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
    expect(badges[0]?.closest("[role=treeitem]")?.querySelector(".name")?.textContent).toBe("a-MacBook.md");
    expect(badges[0]?.getAttribute("title")).toBe("a.md");
  });

  // The tree's own keys (a defect by the 2026-09-20 record: rows could only
  // be clicked). They act on the selection and never leave the tree.
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
        toggleFolder,
      });
      useTabs.setState({ active: null, open } as never);
    });

    const press = (key: string, meta = false) =>
      fireEvent.keyDown(document.querySelector(".tree")!, { key, metaKey: meta });

    it("moves the selection down and up through the drawn rows", () => {
      render(<Sidebar />);
      press("ArrowDown");
      expect(useVault.getState().selected).toBe("Notes/b.md");
      press("ArrowDown");
      press("ArrowDown");
      expect(useVault.getState().selected).toBe("Other");
      press("ArrowUp");
      expect(useVault.getState().selected).toBe("Notes/c.md");
    });

    it("steps into an open folder, closes it, and goes up to the parent", () => {
      render(<Sidebar />);
      press("ArrowRight");
      expect(useVault.getState().selected).toBe("Notes/b.md");
      press("ArrowLeft");
      expect(useVault.getState().selected).toBe("Notes");
      press("ArrowLeft");
      expect(toggleFolder).toHaveBeenCalledWith("Notes");
    });

    it("opens a closed folder with → and a file with ⌘↓", () => {
      useVault.setState({ selected: "Other" });
      render(<Sidebar />);
      press("ArrowRight");
      expect(toggleFolder).toHaveBeenCalledWith("Other");
      act(() => useVault.setState({ selected: "a.md" }));
      press("ArrowDown", true);
      expect(open).toHaveBeenCalledWith("a.md");
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
    useUi.setState({ toast: null });
    render(<Sidebar />);
    const pdf = new File(["x"], "Scan.pdf", { type: "application/pdf" });
    const txt = new File(["x"], "a.txt", { type: "text/plain" });
    const row = screen.getByText("Docs").closest(".tree-row")!;
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
    expect(useUi.getState().toast).toEqual({ key: "tree.dropRefused", values: { count: 1 } });
  });
});
