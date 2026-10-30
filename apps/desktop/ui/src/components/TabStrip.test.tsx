import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCommand } from "../lib/commands";
import { useBoard } from "../stores/board";
import { useEditorSave } from "../stores/editorSave";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import TabStrip, { DOC_PANEL_ID, DocPanel, revealTab } from "./TabStrip";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../ipc/client", () => ({
  commands: {},
  unwrap: vi.fn(),
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));
// The preview button only dispatches; what the command does is the
// dispatcher's own test (lib/commands.test.ts).
vi.mock("../lib/commands", () => ({
  dispatchCommand: vi.fn(),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const { activate, close } = useTabs.getState();
const TAB_DRAG_TYPE = "application/x-novalis-tab";

const tabs = () => screen.getAllByRole("tab");
const crosses = () => [...document.querySelectorAll<HTMLElement>(".sb-doc-tabs__close")];

/** A close that removes the tab the way the store does, without the save. */
const closeNow = vi.fn(async (path: string) => {
  useTabs.setState((s) => {
    const index = s.tabs.indexOf(path);
    const rest = s.tabs.filter((t) => t !== path);
    return { tabs: rest, active: s.active === path ? (rest[Math.min(index, rest.length - 1)] ?? null) : s.active };
  });
});

describe("TabStrip", () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    useTabs.setState({ tabs: ["a.md", "b.md"], active: "a.md", activate, close });
    useEditorSave.setState({ docs: {} });
    useUi.setState({ message: null, previewing: {}, activeBoard: null, boardVisible: false });
    useBoard.setState({ boards: [], slug: null });
    useVault.setState({ children: {} });
    vi.mocked(dispatchCommand).mockClear();
    closeNow.mockClear();
    scrollIntoView.mockClear();
    // jsdom has no layout, hence no scrollIntoView of its own.
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });

  // The defect: a click on a tab fired `void useTabs.getState().close(path)`
  // with no handler, so a close whose flush failed (a read-only vault, a
  // vanished file) rejected into `unhandledrejection` and painted the fatal
  // overlay over a working window. It is said in the action zone now, like
  // every other fire-and-forget in the UI (`report`, stores/ui.ts).
  it("reports a failed close in the action zone", async () => {
    const boom = new Error("EROFS");
    useTabs.setState({ close: vi.fn().mockRejectedValue(boom) });
    render(<TabStrip />);

    fireEvent.click(crosses()[1]!);
    await flush();

    expect(useUi.getState().message).toEqual({
      key: "errors.internal",
      values: { detail: String(boom) },
    });
  });

  it("reports a failed activation in the action zone", async () => {
    const boom = new Error("EROFS");
    useTabs.setState({ activate: vi.fn().mockRejectedValue(boom) });
    render(<TabStrip />);

    fireEvent.click(screen.getByText("b"));
    await flush();

    expect(useUi.getState().message).toEqual({
      key: "errors.internal",
      values: { detail: String(boom) },
    });
  });

  // sebaro's document tabs (spec/02 §4.21, DSK-10, NAV-01; ADR-0051 #21).
  describe("sebaro's markup", () => {
    it("is a named tab list of tab buttons that control the one panel", () => {
      render(<TabStrip />);
      const list = screen.getByRole("tablist");
      expect(list.className).toBe("sb-doc-tabs");
      expect(list.getAttribute("aria-label")).toBe("tabs.label");
      for (const tab of tabs()) {
        expect(tab.tagName).toBe("BUTTON");
        expect(tab.className).toBe("sb-doc-tabs__tab");
        expect(tab.parentElement!.className).toBe("sb-doc-tabs__item");
        expect(tab.parentElement!.getAttribute("role")).toBe("presentation");
        expect(tab.getAttribute("aria-controls")).toBe(DOC_PANEL_ID);
        expect(tab.getAttribute("aria-keyshortcuts")).toBe("Meta+W Delete");
      }
      expect(tabs().map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false"]);
      expect(new Set(tabs().map((tab) => tab.id)).size).toBe(2);
    });

    it("is one tab stop: the current tab", () => {
      useTabs.setState({ active: "b.md" });
      render(<TabStrip />);
      expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, 0]);
    });

    // DSK-10 over ZUG-09 (docs/sebaro-luecken.md D „Reiter“): a long name
    // is cut at the end, deliberately, with the whole name in `title`.
    it("cuts a long name at the end and keeps the file's whole name in title", () => {
      useTabs.setState({ tabs: ["notes/a very long name of a note.md"], active: "notes/a very long name of a note.md" });
      render(<TabStrip />);
      const [tab] = tabs();
      expect(tab!.textContent).toBe("a very long name of a note");
      expect(tab!.getAttribute("title")).toBe("a very long name of a note.md");
      expect(tab!.hasAttribute("data-sb-truncate")).toBe(true);
    });

    // D94 (6): the cross is a pointer shortcut, never a tab stop of its own.
    it("gives every tab the cross as a hidden pointer shortcut with the 16 px close icon", () => {
      render(<TabStrip />);
      expect(screen.queryAllByRole("button").filter((b) => b.closest(".sb-doc-tabs") && b.getAttribute("role") !== "tab")).toEqual([]);
      for (const cross of crosses()) {
        expect(cross.tagName).toBe("SPAN");
        expect(cross.getAttribute("aria-hidden")).toBe("true");
        expect(cross.getAttribute("title")).toBe("menu.file.closeTab");
        expect(cross.hasAttribute("tabindex")).toBe(false);
        expect(cross.querySelector("use")?.getAttribute("href")).toBe("#close--16");
      }
    });

    it("scrolls the current tab into the row's view when it changes, only the row", () => {
      const scrolled: number[] = [];
      const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
      const client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
      const rect = HTMLElement.prototype.getBoundingClientRect;
      // A row 300 px wide that holds 600 px of tabs; each tab 200 px.
      Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => 600 });
      Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 300 });
      HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
        const items = [...(this.parentElement?.children ?? [])];
        const index = this.matches(".sb-doc-tabs__item") ? items.indexOf(this) : -1;
        const left = index < 0 ? 0 : index * 200 + 400 - (this.parentElement?.scrollLeft ?? 0);
        return { left: index < 0 ? 0 : left, right: index < 0 ? 300 : left + 200 } as DOMRect;
      };
      try {
        render(<TabStrip />);
        const row = screen.getByRole("tablist");
        Object.defineProperty(row, "scrollLeft", {
          configurable: true,
          get: () => scrolled.reduce((a, b) => a + b, 0),
          set: (value: number) => scrolled.push(value - scrolled.reduce((a, b) => a + b, 0)),
        });
        act(() => useTabs.setState({ active: "b.md" }));
        expect(scrolled.length).toBeGreaterThan(0);
        // The page and the content stay where they are (sb-window.js `revealTab`).
        expect(scrollIntoView).not.toHaveBeenCalled();
      } finally {
        if (width) Object.defineProperty(HTMLElement.prototype, "scrollWidth", width);
        if (client) Object.defineProperty(HTMLElement.prototype, "clientWidth", client);
        HTMLElement.prototype.getBoundingClientRect = rect;
      }
    });

    // The changed mark (spec/02 §4.21, D102 (4), D105 (5)): the dot `changed--16` before the
    // name for the eye, the word for screen readers, in the tab's name.
    it("marks an unsaved note with sebaro's glyph and a word for screen readers", () => {
      useEditorSave.setState({ docs: { "b.md": { dirty: true } as never } });
      render(<TabStrip />);
      const [clean, dirty] = tabs();
      expect(clean!.querySelector(".sb-doc-tabs__mark")).toBeNull();
      const mark = dirty!.querySelector(".sb-doc-tabs__mark")!;
      expect(mark.getAttribute("aria-hidden")).toBe("true");
      expect(mark.querySelector("use")?.getAttribute("href")).toBe("#changed--16");
      expect(dirty!.firstChild).toBe(mark);
      expect(dirty!.querySelector(".sb-visually-hidden")?.textContent).toBe("tabs.unsaved");
      expect(screen.getByRole("tab", { name: "btabs.unsaved" })).toBe(dirty);
    });

    it("says how to open a note when nothing is open, without an empty tab list", () => {
      useTabs.setState({ tabs: [], active: null });
      const { container } = render(<TabStrip />);
      expect(screen.queryByRole("tablist")).toBeNull();
      const none = container.querySelector(".sb-doc-tabs__none")!;
      expect(none.tagName).toBe("P");
      expect(none.textContent).toBe("editor.emptyState");
    });

    // spec/07 §4.8, ADR-0051 #58: in an empty vault there is nothing to
    // choose and nothing for ⌘P to find, so the sentence names no action.
    it("says only that no note is open in an empty vault", () => {
      useTabs.setState({ tabs: [], active: null });
      useVault.setState({ children: { "": [] } });
      const { container } = render(<TabStrip />);
      const none = container.querySelector(".sb-doc-tabs__none")!;
      expect(none.textContent).toBe("editor.emptyStateNothing");
      // A board is something to choose.
      act(() => useBoard.setState({ boards: [{ slug: "plan", name: "Plan" } as never] }));
      expect(none.textContent).toBe("editor.emptyState");
      act(() => useBoard.setState({ boards: [] }));
      expect(none.textContent).toBe("editor.emptyStateNothing");
      // So is a file.
      act(() =>
        useVault.setState({ children: { "": [{ path: "a.md", name: "a.md", dir: false } as never] } }),
      );
      expect(none.textContent).toBe("editor.emptyState");
    });

    it("has no sentence while a tab is current", () => {
      const { container } = render(<TabStrip />);
      expect(container.querySelector(".sb-doc-tabs__none")).toBeNull();
    });
  });

  // spec/02 §4.21: the window script's keys, here in React (ADR-0051 #21).
  describe("the keys", () => {
    beforeEach(() => {
      useTabs.setState({ tabs: ["a.md", "b.md", "c.md"], active: "a.md", activate: vi.fn().mockResolvedValue(undefined) });
    });

    it("chooses and focuses the next and previous tab with → and ←, round", () => {
      render(<TabStrip />);
      fireEvent.keyDown(tabs()[0]!, { key: "ArrowRight" });
      expect(useTabs.getState().activate).toHaveBeenLastCalledWith("b.md");
      expect(document.activeElement).toBe(tabs()[1]);

      fireEvent.keyDown(tabs()[0]!, { key: "ArrowLeft" });
      expect(useTabs.getState().activate).toHaveBeenLastCalledWith("c.md");
      expect(document.activeElement).toBe(tabs()[2]);
    });

    it("chooses the first and the last tab with Pos1 and Ende", () => {
      render(<TabStrip />);
      fireEvent.keyDown(tabs()[1]!, { key: "End" });
      expect(useTabs.getState().activate).toHaveBeenLastCalledWith("c.md");
      fireEvent.keyDown(tabs()[2]!, { key: "Home" });
      expect(useTabs.getState().activate).toHaveBeenLastCalledWith("a.md");
      expect(document.activeElement).toBe(tabs()[0]);
    });

    it("leaves a chord with a modifier to the keymap", () => {
      render(<TabStrip />);
      fireEvent.keyDown(tabs()[0]!, { key: "ArrowRight", altKey: true });
      fireEvent.keyDown(tabs()[0]!, { key: "Backspace", metaKey: true });
      expect(useTabs.getState().activate).not.toHaveBeenCalled();
    });

    // spec/02 §4.21: ⌃⇥ / ⌃⇧⇥ and ⌘1…9 go through the keymap, which only
    // activates; a tab chosen that way while a tab has focus takes it.
    it("moves focus to the tab a chord made current while a tab has focus", () => {
      render(<TabStrip />);
      tabs()[0]!.focus();
      act(() => useTabs.setState({ active: "b.md" }));
      expect(document.activeElement).toBe(tabs()[1]);
      expect(tabs()[1]!.getAttribute("tabindex")).toBe("0");
    });

    it("leaves focus outside the tabs where it is when the current tab changes", () => {
      render(
        <>
          <TabStrip />
          <textarea aria-label="editor" />
        </>,
      );
      const editor = screen.getByRole("textbox", { name: "editor" });
      editor.focus();
      act(() => useTabs.setState({ active: "c.md" }));
      expect(document.activeElement).toBe(editor);
    });

    it("closes the focused tab with Entf and focuses the tab that became current", async () => {
      useTabs.setState({ close: closeNow });
      render(<TabStrip />);
      tabs()[0]!.focus();
      fireEvent.keyDown(tabs()[0]!, { key: "Delete" });
      await act(flush);
      expect(closeNow).toHaveBeenCalledWith("a.md");
      expect(tabs().map((tab) => tab.textContent)).toEqual(["b", "c"]);
      expect(document.activeElement).toBe(tabs()[0]);

      // ⌫ is not sebaro's key (spec/02 §4.21 names Entf and ⌘W only).
      fireEvent.keyDown(tabs()[0]!, { key: "Backspace" });
      await act(flush);
      expect(closeNow).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(tabs()[0]!, { key: "Delete" });
      await act(flush);
      expect(closeNow).toHaveBeenLastCalledWith("b.md");
      expect(document.activeElement).toBe(tabs()[0]);
      expect(tabs()[0]!.textContent).toBe("c");
    });

    it("hands focus on to the tab that became current when ⌘W closes the focused tab", async () => {
      useTabs.setState({ close: closeNow });
      render(<TabStrip />);
      tabs()[0]!.focus();
      // ⌘W is the keymap's (tab.close), not the strip's key.
      await act(() => useTabs.getState().close("a.md"));
      expect(tabs()[0]!.textContent).toBe("b");
      expect(document.activeElement).toBe(tabs()[0]);
    });

    it("hands focus on to the sentence when ⌘W closes the last tab while it has focus", async () => {
      useTabs.setState({ tabs: ["a.md"], active: "a.md", close: closeNow });
      const { container } = render(<TabStrip />);
      tabs()[0]!.focus();
      await act(() => useTabs.getState().close("a.md"));
      expect(document.activeElement).toBe(container.querySelector(".sb-doc-tabs__none"));
    });

    it("leaves focus alone when a tab closes after focus went elsewhere", async () => {
      useTabs.setState({ close: closeNow });
      const elsewhere = document.createElement("input");
      document.body.append(elsewhere);
      render(<TabStrip />);
      tabs()[0]!.focus();
      elsewhere.focus();
      await act(() => useTabs.getState().close("a.md"));
      expect(document.activeElement).toBe(elsewhere);
      elsewhere.remove();
    });

    it("gives focus to the sentence when the last tab is closed", async () => {
      useTabs.setState({ tabs: ["a.md"], active: "a.md", close: closeNow });
      const { container } = render(<TabStrip />);
      fireEvent.keyDown(tabs()[0]!, { key: "Delete" });
      await act(flush);
      expect(document.activeElement).toBe(container.querySelector(".sb-doc-tabs__none"));
    });

    it("closes a tab with a middle click", async () => {
      useTabs.setState({ close: closeNow });
      render(<TabStrip />);
      fireEvent.mouseDown(tabs()[1]!, { button: 1 });
      await act(flush);
      expect(closeNow).toHaveBeenCalledWith("b.md");
    });

    it("keeps focus where it is when the cross is pressed", () => {
      render(<TabStrip />);
      const pressed = fireEvent.mouseDown(crosses()[1]!, { button: 0 });
      expect(pressed).toBe(false);
    });
  });

  // ADR-0028: a tab dragged onto another takes its place; sebaro's drop
  // line marks where (spec/02 §4.22, DSK-11).
  describe("dragging a tab", () => {
    const transfer = (path = "") => ({
      types: [TAB_DRAG_TYPE],
      getData: () => path,
      setData: vi.fn(),
      dropEffect: "",
      effectAllowed: "",
    });

    it("marks the tab it lands before and moves it there", () => {
      useTabs.setState({ tabs: ["a.md", "b.md", "c.md"] });
      render(<TabStrip />);
      const items = tabs().map((tab) => tab.parentElement!);
      expect(items.every((item) => item.getAttribute("draggable") === "true")).toBe(true);

      fireEvent.dragStart(items[2]!, { dataTransfer: transfer() });
      expect(items[2]!.getAttribute("data-sb-state")).toBe("dragging");
      fireEvent.dragOver(items[0]!, { dataTransfer: transfer() });
      expect(items[0]!.getAttribute("data-sb-state")).toBe("drop-before");
      fireEvent.drop(items[0]!, { dataTransfer: transfer("c.md") });
      expect(useTabs.getState().tabs).toEqual(["c.md", "a.md", "b.md"]);
    });

    it("marks the far side of the tab it lands after when dragged rightward", () => {
      useTabs.setState({ tabs: ["a.md", "b.md", "c.md", "d.md"] });
      render(<TabStrip />);
      const items = tabs().map((tab) => tab.parentElement!);

      fireEvent.dragStart(items[0]!, { dataTransfer: transfer() });
      fireEvent.dragOver(items[2]!, { dataTransfer: transfer() });
      expect(items[2]!.getAttribute("data-sb-state")).toBe("drop-after");
      fireEvent.drop(items[2]!, { dataTransfer: transfer("a.md") });
      // `move` takes A out first: it lands after C, where the line stood.
      expect(useTabs.getState().tabs).toEqual(["b.md", "c.md", "a.md", "d.md"]);
    });

    it("ignores what is not a tab", () => {
      render(<TabStrip />);
      const item = tabs()[0]!.parentElement!;
      fireEvent.dragOver(item, { dataTransfer: { types: ["text/plain"] } });
      expect(item.hasAttribute("data-sb-state")).toBe(false);
    });
  });

  // ADR-0020, ADR-0051 #16: the tool beside the strip is `Cmd+E` for the
  // pointer — sebaro's compact switch with the eye and its word (D102 (2), D105 (2)), outside the
  // scrolling row so a row of many tabs never pushes it out of sight.
  describe("the preview tool", () => {
    it("is a compact switch with its word and its chord, and dispatches the toggle", () => {
      render(<TabStrip />);

      const button = screen.getByRole("button", { name: "editor.preview" });
      expect(button.className).toBe("sb-secondary-action sb-secondary-action--compact");
      expect(button.textContent).toBe("editor.preview");
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+E");
      // D105 (2): the eye at 20 px before the word.
      expect(button.firstElementChild?.getAttribute("class")).toBe("sb-icon sb-icon--20");
      expect(button.querySelector("use")?.getAttribute("href")).toBe("#eye");
      expect(button.closest(".sb-doc-tabs")).toBeNull();

      fireEvent.click(button);
      expect(dispatchCommand).toHaveBeenCalledWith("note.togglePreview");
    });

    it("keeps its name and says the preview is on with aria-pressed", () => {
      useUi.setState({ previewing: { "a.md": true } });
      render(<TabStrip />);
      expect(screen.getByRole("button", { name: "editor.preview" }).getAttribute("aria-pressed")).toBe("true");
    });

    it("is not there for a tab with nothing else to show", () => {
      useTabs.setState({ tabs: ["a.md", "x.pdf", "b.txt"], active: "x.pdf" });
      const { rerender } = render(<TabStrip />);
      expect(screen.queryByRole("button", { name: "editor.preview" })).toBeNull();

      useTabs.setState({ active: "b.txt" });
      rerender(<TabStrip />);
      expect(screen.queryByRole("button", { name: "editor.preview" })).toBeNull();
    });

    // ADR-0025: a CSV or TSV has its table behind the tool, an SVG its picture.
    it("is there for a CSV, a TSV and an SVG", () => {
      for (const active of ["d.csv", "d.tsv", "i.svg"]) {
        useTabs.setState({ tabs: [active], active });
        const { unmount } = render(<TabStrip />);
        expect(screen.getByRole("button", { name: "editor.preview" }), active).toBeTruthy();
        unmount();
      }
    });
  });

  // ADR-0050: an open board is a tab like a note's, not a pane over
  // everything with a note still marked current.
  describe("the board tab", () => {
    beforeEach(() => {
      useBoard.setState({ boards: [{ slug: "work", name: "Work" } as never] });
      useUi.setState({ activeBoard: "work", boardVisible: true });
    });

    it("is current while the board shows, and no note tab is", () => {
      render(<TabStrip />);
      expect(tabs()[0]).toHaveProperty("textContent", "Worktabs.pinned");
      expect(tabs().map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
      expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    });

    it("is pinned first with the board icon and cannot be dragged", () => {
      render(<TabStrip />);
      const [board, ...notes] = tabs();
      expect(board!.querySelector("use")?.getAttribute("href")).toBe("#board");
      expect(board!.getAttribute("title")).toBe("Work");
      expect(board!.parentElement!.getAttribute("draggable")).toBe("false");
      expect(notes.every((tab) => tab.parentElement!.getAttribute("draggable") === "true")).toBe(true);
    });

    it("stays when the board is hidden, and a click shows it again", () => {
      useUi.setState({ boardVisible: false });
      render(<TabStrip />);
      fireEvent.click(screen.getByText("Work"));
      expect(useUi.getState().boardVisible).toBe(true);
    });

    // sebaro's pinned tab (spec/02 §4.21, D102 (5), ADR-0051 #35).
    it("is sebaro's pinned tab, without a cross and without Cmd+W or Entf", () => {
      render(<TabStrip />);
      const [board, ...notes] = tabs();
      expect(board!.parentElement!.classList.contains("sb-doc-tabs__item--pinned")).toBe(true);
      expect(notes.some((tab) => tab.parentElement!.classList.contains("sb-doc-tabs__item--pinned"))).toBe(false);
      expect(board!.parentElement!.querySelector(".sb-doc-tabs__close")).toBeNull();
      expect(crosses()).toHaveLength(2);
      expect(board!.hasAttribute("aria-keyshortcuts")).toBe(false);
      expect(notes[0]!.getAttribute("aria-keyshortcuts")).toBe("Meta+W Delete");
      // The hidden word says it (spec/02 §4.21, D104 (24)).
      expect(board!.querySelector(".sb-visually-hidden")?.textContent).toBe("tabs.pinned");
    });

    it("is not closed by Entf or a middle click", () => {
      useTabs.setState({ close: closeNow });
      render(<TabStrip />);
      fireEvent.keyDown(tabs()[0]!, { key: "Delete" });
      fireEvent.mouseDown(tabs()[0]!.parentElement!, { button: 1 });
      expect(useUi.getState()).toMatchObject({ activeBoard: "work", boardVisible: true });
      expect(closeNow).not.toHaveBeenCalled();
      expect(tabs()[0]!.textContent).toBe("Worktabs.pinned");
    });

    it("goes with the board tool, and a note tab made current keeps it", () => {
      render(<TabStrip />);
      act(() => useUi.getState().hideBoard());
      expect(tabs()[0]!.textContent).toBe("Worktabs.pinned");
      act(() => useUi.getState().toggleBoard());
      expect(tabs()[0]!.getAttribute("aria-selected")).toBe("true");
      act(() => useUi.getState().toggleBoard());
      expect(tabs().map((tab) => tab.textContent)).toEqual(["a", "b"]);
      expect(useUi.getState()).toMatchObject({ activeBoard: null, boardVisible: false });
    });

    it("keeps the tab of a board shown again by the tool when a note tab is made current", () => {
      useBoard.setState({ slug: "work" });
      render(<TabStrip />);
      act(() => useUi.getState().toggleBoard("work"));
      act(() => useUi.getState().toggleBoard("work"));
      expect(useUi.getState()).toMatchObject({ activeBoard: "work", boardVisible: true });
      act(() => useUi.getState().hideBoard());
      expect(tabs().map((tab) => tab.textContent)).toEqual(["Worktabs.pinned", "a", "b"]);
    });

    it("is reached by the arrows like any tab", () => {
      useTabs.setState({ activate: vi.fn().mockResolvedValue(undefined) });
      useUi.setState({ boardVisible: false });
      render(<TabStrip />);
      fireEvent.keyDown(tabs()[0]!, { key: "ArrowLeft" });
      expect(useTabs.getState().activate).toHaveBeenLastCalledWith("b.md");
      fireEvent.keyDown(tabs()[1]!, { key: "ArrowLeft" });
      expect(useUi.getState().boardVisible).toBe(true);
    });

    it("leaves the empty state to the board pane while no board is loaded", () => {
      useBoard.setState({ boards: [], slug: null });
      useUi.setState({ activeBoard: null, boardVisible: true });
      const { container } = render(<TabStrip />);
      expect(container.querySelector(".sb-doc-tabs__none")).toBeNull();
    });

    it("says how to open a note while only a hidden board's tab is open", () => {
      useTabs.setState({ tabs: [], active: null });
      useUi.setState({ boardVisible: false });
      const { container } = render(<TabStrip />);
      expect(tabs()).toHaveLength(1);
      expect(container.querySelector(".sb-doc-tabs__none")?.textContent).toBe("editor.emptyState");
    });
  });

  // The one panel (spec/02 §4.21): named by the current tab, the board's
  // included; with nothing current no tab panel at all.
  describe("the panel", () => {
    const panel = () => document.getElementById(DOC_PANEL_ID)!;
    const strip = () => (
      <>
        <TabStrip />
        <DocPanel>
          <p>content</p>
        </DocPanel>
      </>
    );

    it("is the tab panel the current note's tab names", () => {
      useTabs.setState({ active: "b.md" });
      render(strip());
      expect(panel().className).toBe("sb-doc-tabs__panel nv-doc-panel");
      expect(panel().getAttribute("role")).toBe("tabpanel");
      expect(panel().tabIndex).toBe(0);
      expect(panel().getAttribute("aria-labelledby")).toBe(tabs()[1]!.id);
      expect(panel().textContent).toBe("content");
    });

    it("is named by the board's tab while the board shows", () => {
      useBoard.setState({ boards: [{ slug: "work", name: "Work" } as never] });
      useUi.setState({ activeBoard: "work", boardVisible: true });
      render(strip());
      expect(panel().getAttribute("aria-labelledby")).toBe(tabs()[0]!.id);
      expect(tabs()[0]!.textContent).toBe("Worktabs.pinned");
    });

    it("has no role, name or tab stop while no tab is current", () => {
      useTabs.setState({ tabs: [], active: null });
      render(strip());
      expect(panel().hasAttribute("role")).toBe(false);
      expect(panel().hasAttribute("aria-labelledby")).toBe(false);
      expect(panel().hasAttribute("tabindex")).toBe(false);
    });
  });
});

// sebaro D108 (4), spec/02 §4.21: the pinned tab stays at the row's start
// while the row scrolls, so another tab is revealed after its end.
describe("revealTab", () => {
  const box = (left: number, right: number) => ({ left, right }) as DOMRect;

  function row(scrollLeft = 0, scrollWidth = 900) {
    const list = document.createElement("div");
    list.setAttribute("role", "tablist");
    list.innerHTML =
      '<div class="sb-doc-tabs__item sb-doc-tabs__item--pinned"><button role="tab">Board</button></div>' +
      '<div class="sb-doc-tabs__item"><button role="tab">a</button></div>' +
      '<div class="sb-doc-tabs__item"><button role="tab">b</button></div>';
    Object.defineProperty(list, "scrollWidth", { value: scrollWidth });
    Object.defineProperty(list, "clientWidth", { value: 300 });
    list.scrollLeft = scrollLeft;
    list.getBoundingClientRect = () => box(0, 300);
    const [pinned, a, b] = [...list.children] as HTMLElement[];
    pinned!.getBoundingClientRect = () => box(0, 100);
    document.body.append(list);
    return { list, pinned: pinned!, a: a!, b: b! };
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("brings a tab hidden under the pinned tab out after its end", () => {
    const { list, a } = row(200);
    a.getBoundingClientRect = () => box(40, 240);
    revealTab(a.querySelector("button")!);
    expect(list.scrollLeft).toBe(140);
  });

  it("brings a tab past the end to the row's end", () => {
    const { list, b } = row(0);
    b.getBoundingClientRect = () => box(400, 600);
    revealTab(b.querySelector("button")!);
    expect(list.scrollLeft).toBe(300);
  });

  it("leaves a row that does not scroll alone", () => {
    const { list, a } = row(0, 300);
    a.getBoundingClientRect = () => box(-50, 150);
    revealTab(a.querySelector("button")!);
    expect(list.scrollLeft).toBe(0);
  });
});
