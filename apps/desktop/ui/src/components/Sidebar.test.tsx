import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCommand, moveEntry } from "../lib/commands";
import { useBoard } from "../stores/board";
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
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * jsdom has no `DataTransfer`; this carries the one payload the tree sets so
 * the drop reads back what dragstart wrote, as the real store does.
 */
function dragStore() {
  let data = "";
  return {
    setData: (_type: string, value: string) => {
      data = value;
    },
    getData: () => data,
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
    useBoard.setState({ boards: [], slug: null, board: null });
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
    useBoard.setState({ boards: [{ slug: "atlas", name: "Atlas" }], load });
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
    useBoard.setState({ boards: [{ slug: "atlas", name: "Atlas" }] });
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

    it("neither drags a board row nor takes a drop on it", () => {
      useBoard.setState({ boards: [{ slug: "atlas", name: "Atlas" }] });
      render(<Sidebar />);
      const dataTransfer = dragStore();

      expect(row("Atlas").getAttribute("draggable")).toBeNull();
      fireEvent.dragStart(row("a.md"), { dataTransfer });
      expect(fireEvent.dragOver(row("Atlas"), { dataTransfer })).toBe(true);
      expect(row("Atlas").classList.contains("drop")).toBe(false);
      fireEvent.drop(row("Atlas"), { dataTransfer });

      expect(moveEntry).not.toHaveBeenCalled();
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
  });
});
