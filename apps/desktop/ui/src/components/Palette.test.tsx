import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { unwrap } from "../ipc/client";
import { goToEditorLine } from "../lib/editorBridge";
import { setPreviewBridge } from "../lib/previewBridge";
import { useEditorSave } from "../stores/editorSave";

import { createNoteNamed, dispatchCommand } from "../lib/commands";
import { useBoard } from "../stores/board";
import { useFiles } from "../stores/files";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import Palette from "./Palette";

// The catalog is not under test; render the key, with an interpolated
// `{{value}}` appended so a settings entry reads as its two keys.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { value?: string }) => (values?.value ? `${key}:${values.value}` : key),
  }),
}));
vi.mock("../ipc/client", () => ({
  commands: { tags: vi.fn() },
  unwrap: vi.fn(),
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));
// No editor chunk loads in jsdom: the jump is observed, not made.
vi.mock("../lib/editorBridge", () => ({ goToEditorLine: vi.fn() }));
// The command list is the real one; only what Enter dispatches is observed.
vi.mock("../lib/commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/commands")>()),
  dispatchCommand: vi.fn(),
  createNoteNamed: vi.fn(async () => undefined),
}));

// jsdom has `<dialog>` but neither `showModal()` nor `close()`: the open
// state is the attribute, as in a browser, and `close` queues its event.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    if (!this.open) return;
    this.removeAttribute("open");
    setTimeout(() => this.dispatchEvent(new Event("close")), 0);
  });
});

const dialog = () => document.querySelector("dialog")!;
/** The rows' names, in the order the arrows walk them. */
const names = () => [...document.querySelectorAll("[role=option] .sb-row__name")].map((el) => el.textContent);
/** The active row (spec/02 §4.16: `aria-selected`, referenced by the combobox). */
const active = () => document.querySelector<HTMLElement>('[role=option][aria-selected="true"]');
const groups = () => [...document.querySelectorAll(".sb-command-palette__group")].map((el) => el.textContent);

describe("Palette", () => {
  beforeEach(() => {
    vi.mocked(unwrap).mockResolvedValue({ tags: [] } as never);
    useFiles.setState({ files: [], notes: [], loaded: true });
    useBoard.setState({ boards: [] });
    useUi.setState({ overlay: { kind: "palette" } });
  });

  // NAV-09 (ADR-0051): a query that finds nothing is named, not answered
  // with a bare „Keine Treffer“.
  it("says that nothing matches what was typed", () => {
    render(<Palette mode="palette" />);
    fireEvent.change(screen.getByPlaceholderText("palette.placeholder"), { target: { value: "qqqqqqqq" } });
    const status = screen.getByRole("status");
    expect(status.className).toBe("sb-command-palette__empty");
    expect(status.textContent).toBe("palette.noMatch.palette");
  });

  // The four settings have no window and no button (docs/SETTINGS.md): the
  // palette is where they are set, one entry per value (ADR-0012).
  it("lists a settings value as a command and dispatches it on Enter", () => {
    render(<Palette mode="palette" />);
    const input = screen.getByPlaceholderText("palette.placeholder");

    fireEvent.change(input, { target: { value: "dark" } });
    const label = active()?.querySelector(".sb-row__name");
    expect(label?.textContent).toBe("palette.cmd.appearance:settings.appearance.dark");
    // The letters the fuzzy match took are body-strong, no fill (spec/02
    // §4.16, D102 (6)).
    expect(label?.querySelector("mark")).toBeNull();
    expect(
      [...(label?.querySelectorAll("b.sb-command-palette__hit") ?? [])].map((mark) => mark.textContent).join(""),
    ).toBe("dark");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(dispatchCommand).toHaveBeenCalledWith("settings.appearance.dark", "palette");
    expect(useUi.getState().overlay).toEqual({ kind: "none" });
  });

  // A command that opens a dialog moves the focus into it at once; the rest
  // of the Enter must not press „Abbrechen“ there or submit its form.
  it("cancels the default of the Enter that runs a command", () => {
    render(<Palette mode="palette" />);
    const input = screen.getByPlaceholderText("palette.placeholder");

    fireEvent.change(input, { target: { value: "dark" } });
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    expect(dispatchCommand).toHaveBeenCalledWith("settings.appearance.dark", "palette");
  });

  it("lists today's note and dispatches it on Enter", () => {
    render(<Palette mode="palette" />);
    const input = screen.getByPlaceholderText("palette.placeholder");

    fireEvent.change(input, { target: { value: "tree.todayNote" } });
    expect(screen.getByText("tree.todayNote")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(dispatchCommand).toHaveBeenCalledWith("file.todayNote", "palette");
  });

  // DSK-05: the settings view (ADR-0051 #1) holds the six, and the palette
  // stays a second way to them, under their own head.
  it("offers the settings among the commands, under their head", () => {
    render(<Palette mode="palette" />);
    const input = screen.getByPlaceholderText("palette.placeholder");

    fireEvent.change(input, { target: { value: "menu.edit.checkSpellingWhileTyping" } });
    expect(groups()[0]).toBe("sidebar.settings");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(dispatchCommand).toHaveBeenCalledWith("settings.spellcheck", "palette");
  });

  // ADR-0049: the fifth setting sits in the same list.
  it("offers Always Reduce Motion", () => {
    render(<Palette mode="palette" />);
    const input = screen.getByPlaceholderText("palette.placeholder");

    fireEvent.change(input, { target: { value: "menu.view.reduceMotion" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(dispatchCommand).toHaveBeenCalledWith("settings.reduceMotion", "palette");
  });

  // ADR-0051: the sixth, „Farbton: Kühl · Warm“, one entry per value.
  it("offers the tone", () => {
    render(<Palette mode="palette" />);
    const input = screen.getByPlaceholderText("palette.placeholder");

    expect(screen.getByText("palette.cmd.tone:settings.tone.cool")).toBeTruthy();
    fireEvent.change(input, { target: { value: "settings.tone.warm" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(dispatchCommand).toHaveBeenCalledWith("settings.tone.warm", "palette");
  });

  // ADR-0051 #1: „Einstellungen …“ opens the settings view.
  it("opens the settings view from its command", () => {
    render(<Palette mode="palette" />);
    const input = screen.getByPlaceholderText("palette.placeholder");

    fireEvent.change(input, { target: { value: "palette.cmd.settings" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(dispatchCommand).toHaveBeenCalledWith("settings.open", "palette");
  });

  // Quick-open lists every file the tree lists (ADR-0022 point 5): a note by
  // its stem, anything else by its name with the extension; the `[[` source
  // is the notes alone.
  it("opens any listed file from quick-open, named with its extension", () => {
    useFiles.setState({ files: ["a.md", "notes/b.txt", "c.pdf"], notes: ["a.md"], loaded: true });
    const open = vi.fn().mockResolvedValue(undefined);
    useTabs.setState({ open });
    render(<Palette mode="quickOpen" />);
    const input = screen.getByPlaceholderText("palette.quickOpenPlaceholder");

    expect(screen.getByText("a")).toBeTruthy();
    expect(screen.getByText("b.txt")).toBeTruthy();
    expect(screen.getByText("c.pdf")).toBeTruthy();

    fireEvent.change(input, { target: { value: "b.txt" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(open).toHaveBeenCalledWith("notes/b.txt");
  });

  it("offers no command in quick-open", () => {
    render(<Palette mode="quickOpen" />);
    const input = screen.getByPlaceholderText("palette.quickOpenPlaceholder");

    fireEvent.change(input, { target: { value: "dark" } });
    expect(screen.queryByText("palette.cmd.appearance:settings.appearance.dark")).toBeNull();
    // ADR-0038: a name no note has is offered for creation, nothing else.
    expect(names()).toEqual(["editor.completion.newNote"]);
    expect(groups()).toEqual(["menu.file.newNote"]);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(dispatchCommand).not.toHaveBeenCalled();
    expect(createNoteNamed).toHaveBeenCalledWith("dark");
  });

  // feature-gaps A10: the headings come from the note's text, so the jump
  // works in the preview as in the editor; a code file has none.
  describe("the heading jump", () => {
    const text = "# Plan\n\n## Open questions\n```sh\n# not one\n```\n";
    beforeEach(() => {
      vi.mocked(goToEditorLine).mockClear();
      useEditorSave.setState({ docs: { "n.md": { path: "n.md", text } as never, "run.sh": { path: "run.sh", text } as never } });
    });

    it("lists the note's headings and goes to one in the editor", () => {
      useTabs.setState({ active: "n.md" });
      render(<Palette mode="palette" />);
      const input = screen.getByPlaceholderText("palette.placeholder");
      fireEvent.change(input, { target: { value: "open q" } });
      expect(active()?.querySelector(".sb-row__name")?.textContent).toBe("## Open questions");
      expect(screen.queryByText("# not one")).toBeNull();

      fireEvent.keyDown(input, { key: "Enter" });
      expect(goToEditorLine).toHaveBeenCalledWith(3);
    });

    it("goes to it in the preview when the preview shows the note", () => {
      const goToLine = vi.fn();
      setPreviewBridge({ find: vi.fn(), findNext: vi.fn(), findPrevious: vi.fn(), mark: vi.fn(), goToLine });
      try {
        useTabs.setState({ active: "n.md" });
        render(<Palette mode="palette" />);
        const input = screen.getByPlaceholderText("palette.placeholder");
        fireEvent.change(input, { target: { value: "open q" } });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(goToLine).toHaveBeenCalledWith(3);
        expect(goToEditorLine).not.toHaveBeenCalled();
      } finally {
        setPreviewBridge(null);
      }
    });

    it("has no headings for a file that is not Markdown", () => {
      useTabs.setState({ active: "run.sh" });
      render(<Palette mode="palette" />);
      fireEvent.change(screen.getByPlaceholderText("palette.placeholder"), { target: { value: "plan" } });
      expect(screen.queryByText(/# Plan/)).toBeNull();
    });
  });

  // feature-gaps A14 (§4.4 "tags as search filter / palette"): a tag is an
  // entry with its count, and choosing it opens the search filtered by it.
  it("offers the vault's tags and opens the search filtered by one", async () => {
    vi.mocked(unwrap).mockResolvedValue({ tags: [{ tag: "project", count: 4 }, { tag: "idea", count: 1 }] } as never);
    render(<Palette mode="palette" />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    const input = screen.getByPlaceholderText("palette.placeholder");

    fireEvent.change(input, { target: { value: "#proj" } });
    const row = active();
    expect(row?.querySelector(".sb-row__name")?.textContent).toBe("#project");
    expect(row?.querySelector(".sb-row__meta")?.textContent).toBe("4");
    expect(groups()[0]).toBe("palette.section.tags");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(useUi.getState().overlay).toEqual({ kind: "search", tag: "project" });
  });

  it("offers no tags in quick-open", async () => {
    vi.mocked(unwrap).mockResolvedValue({ tags: [{ tag: "project", count: 4 }] } as never);
    render(<Palette mode="quickOpen" />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    fireEvent.change(screen.getByPlaceholderText("palette.quickOpenPlaceholder"), { target: { value: "#proj" } });
    expect(document.querySelector("[role=option]")).toBeNull();
  });
});

// ADR-0030: the note picker behind a card's Link Note… — notes only, the
// open one first, the card's own links left out, the choice handed back.
describe("Palette in pickNote mode", () => {
  it("offers the notes minus the excluded ones, the active note first, and hands the pick back", () => {
    useFiles.setState({ files: ["a.md", "b.md", "c.md", "x.pdf"], notes: ["a.md", "b.md", "c.md"], loaded: true });
    useTabs.setState({ active: "c.md" });
    const onPick = vi.fn().mockResolvedValue(undefined);
    render(<Palette mode="pickNote" pick={{ exclude: ["a.md"], onPick }} />);

    expect(names()).toEqual(["c", "b"]);
    expect(groups()).toEqual(["palette.section.notes"]);

    fireEvent.keyDown(screen.getByPlaceholderText("board.linkNote"), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("c.md");
    expect(dispatchCommand).not.toHaveBeenCalledWith(expect.anything());
  });
});

// Move To… (DSK-11, ADR-0051 #5): quick-open on the folders it was handed,
// the vault root named by the vault; the chosen folder goes back.
describe("Palette in pickFolder mode", () => {
  it("lists the folders by their paths, and hands the pick back", () => {
    useVault.setState({ vault: { root: "/v", name: "Mein Vault", kind: "local", boards: [] } as never });
    const onPick = vi.fn().mockResolvedValue(undefined);
    render(<Palette mode="pickFolder" pickFolder={{ name: "a.md", folders: ["", "Archive", "Notes/sub"], onPick }} />);

    const text = (selector: string) => [...document.querySelectorAll(selector)].map((el) => el.textContent);
    expect(names()).toEqual(["Mein Vault", "Archive", "Notes/sub"]);
    expect(groups()).toEqual(["palette.section.folders"]);
    expect(text(".sb-row__meta")).toEqual(["palette.vaultRoot"]);
    expect(document.querySelector(".sb-command-palette__foot")?.textContent).toContain("palette.foot.move");

    const input = screen.getByPlaceholderText("palette.moveToPlaceholder");
    fireEvent.change(input, { target: { value: "sub" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("Notes/sub");
    expect(useUi.getState().overlay).toEqual({ kind: "none" });
    expect(dispatchCommand).not.toHaveBeenCalledWith(expect.anything());
  });

  // NAV-09: two folders of one name differ by their paths, and a typed path
  // finds one of them.
  it("tells same-named folders apart and finds one by its path", () => {
    useVault.setState({ vault: { root: "/v", name: "v", kind: "local", boards: [] } as never });
    const onPick = vi.fn().mockResolvedValue(undefined);
    render(
      <Palette mode="pickFolder" pickFolder={{ name: "a.md", folders: ["", "Private/notes", "Work/notes"], onPick }} />,
    );
    const input = screen.getByPlaceholderText("palette.moveToPlaceholder");
    fireEvent.change(input, { target: { value: "work/no" } });
    expect(names()).toEqual(["Work/notes"]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("Work/notes");
  });
});

// ADR-0037: an empty quick-open lists the recent files first, marked; `@`
// narrows ⌘P to the open note's headings, as Go to Heading… does.
describe("Palette recent files and headings", () => {
  beforeEach(() => {
    vi.mocked(unwrap).mockResolvedValue({ tags: [] } as never);
    useBoard.setState({ boards: [] });
  });

  it("lists the recent files first in an empty quick-open, skipping one no longer listed", () => {
    useFiles.setState({ files: ["a.md", "b.md", "c.md"], notes: ["a.md", "b.md", "c.md"], loaded: true });
    useTabs.setState({ active: "a.md", recent: ["a.md", "c.md", "gone.md", "b.md"] });
    render(<Palette mode="quickOpen" />);
    // The current file is not first: Enter goes to the one before it.
    expect(names()).toEqual(["c", "b", "a"]);
    expect(groups()).toEqual(["palette.section.recent", "palette.section.files"]);
  });

  it("narrows to the headings with @ and in the headings mode", () => {
    useFiles.setState({ files: ["a.md"], notes: ["a.md"], loaded: true });
    useTabs.setState({ active: "a.md", recent: [] });
    useEditorSave.setState({ flush: () => "# Alpha\n\n## Beta part\ntext\n" } as never);
    render(<Palette mode="quickOpen" />);
    fireEvent.change(screen.getByPlaceholderText("palette.quickOpenPlaceholder"), {
      target: { value: "@beta" },
    });
    expect(names()).toEqual(["## Beta part"]);
  });
});

// ADR-0038: quick-open offers "Create …" only for a name no note has.
describe("Palette create row", () => {
  it("offers to create a missing name, and not an existing one in another case", () => {
    vi.mocked(unwrap).mockResolvedValue({ tags: [] } as never);
    useFiles.setState({ files: ["Ideas.md"], notes: ["Ideas.md"], loaded: true });
    useTabs.setState({ recent: [], active: null });
    render(<Palette mode="quickOpen" />);
    const input = screen.getByPlaceholderText("palette.quickOpenPlaceholder");
    fireEvent.change(input, { target: { value: "ideas" } });
    expect(screen.queryByText("editor.completion.newNote")).toBeNull();
    fireEvent.change(input, { target: { value: "Ideas 2" } });
    expect(screen.getByText("editor.completion.newNote")).toBeTruthy();
  });
});

// View step 8 (ADR-0051 #21, spec/02 §4.16, NAV-09): sebaro's command
// palette with its markup, ARIA and key contract.
describe("Palette as sebaro's command palette", () => {
  beforeEach(() => {
    vi.mocked(unwrap).mockResolvedValue({ tags: [] } as never);
    useFiles.setState({ files: [], notes: [], loaded: true });
    useBoard.setState({ boards: [] });
    useTabs.setState({ active: null, recent: [] });
    useUi.setState({ overlay: { kind: "palette" }, settings: null });
  });

  it("is a modal dialog in window density, named, with the search row's combobox", () => {
    render(<Palette mode="palette" />);
    const element = dialog();
    expect(element.className).toBe("sb-command-palette");
    expect(element.dataset.sbDensity).toBe("window");
    expect(element.open).toBe(true);
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
    expect(element.getAttribute("aria-label")).toBe("palette.section.commands");

    const input = screen.getByRole("combobox");
    expect(input.closest(".sb-command-palette__search")?.querySelector("svg use")?.getAttribute("href")).toBe("#search");
    expect(input.getAttribute("aria-label")).toBe("palette.placeholder");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(input);
    const list = screen.getByRole("listbox");
    expect(list.className).toBe("sb-command-palette__list");
    expect(input.getAttribute("aria-controls")).toBe(list.id);
    // The active option is the one the combobox points at.
    expect(input.getAttribute("aria-activedescendant")).toBe(active()?.id);
    expect(active()?.className).toBe("sb-row");
  });

  it("groups the rows under heads, a setting's state as the check, a command's chord at the end", () => {
    useUi.setState({ settings: { appearance: "dark" } as never });
    render(<Palette mode="palette" />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "appearance" } });

    expect(groups()).toEqual(["sidebar.settings"]);
    const head = document.querySelector(".sb-command-palette__group")!;
    expect(head.closest(".sb-command-palette__section")?.querySelector("[role=group]")?.getAttribute("aria-labelledby")).toBe(
      head.id,
    );
    const row = (name: string) =>
      [...document.querySelectorAll<HTMLElement>("[role=option]")].find(
        (option) => option.querySelector(".sb-row__name")?.textContent === name,
      )!;
    const dark = row("palette.cmd.appearance:settings.appearance.dark");
    expect(dark.getAttribute("aria-checked")).toBe("true");
    expect(dark.querySelector(".sb-row__check use")?.getAttribute("href")).toBe("#check--16");
    expect(row("palette.cmd.appearance:settings.appearance.light").getAttribute("aria-checked")).toBe("false");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "menu.file.newNoteItem" } });
    const newNote = row("menu.file.newNoteItem");
    expect(newNote.hasAttribute("aria-checked")).toBe(false);
    expect(newNote.querySelector(".sb-row__check")?.childElementCount).toBe(0);
    expect(newNote.lastElementChild?.className).toBe("sb-keys");
    expect(newNote.lastElementChild?.getAttribute("data-sb-keys")).toBe("Mod+N");
    expect(groups()[0]).toBe("palette.section.commands");
  });

  it("checks the sidebar width that is set", () => {
    useUi.setState({ sidebarWidth: 360 });
    render(<Palette mode="palette" />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "sidebar.width" } });
    const checks = [...document.querySelectorAll("[role=option]")].map((row) => [
      row.querySelector(".sb-row__name")?.textContent,
      row.getAttribute("aria-checked"),
    ]);
    expect(checks).toEqual([
      ["palette.cmd.sidebarWidth:sidebar.width.narrow", "false"],
      ["palette.cmd.sidebarWidth:sidebar.width.normal", "false"],
      ["palette.cmd.sidebarWidth:sidebar.width.wide", "true"],
    ]);
  });

  it("says the keys at the foot as sebaro's keys, with their words", () => {
    render(<Palette mode="palette" />);
    const keys = [...document.querySelectorAll(".sb-command-palette__foot .sb-keys")];
    expect(keys.map((k) => k.getAttribute("data-sb-keys"))).toEqual(["Up Down", "Enter", "Escape"]);
    expect(keys.map((k) => k.querySelector("[aria-hidden]")?.textContent)).toEqual(["↑↓", "↩", "⎋"]);
    expect(keys[0]?.querySelector(".sb-visually-hidden")?.textContent).toBe("keys.up, keys.down");
    expect(document.querySelector(".sb-command-palette__foot")?.textContent).toBe(
      "↑↓keys.up, keys.downpalette.foot.navigate↩keys.enterpalette.foot.run⎋keys.escapepalette.foot.close",
    );
  });

  it("walks the rows round with the arrows", () => {
    useFiles.setState({ files: ["a.md", "b.md"], notes: ["a.md", "b.md"], loaded: true });
    render(<Palette mode="quickOpen" />);
    const input = screen.getByRole("combobox");
    const name = () => active()?.querySelector(".sb-row__name")?.textContent;
    expect(name()).toBe("a");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(name()).toBe("b");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(name()).toBe("a");
    expect(input.getAttribute("aria-activedescendant")).toBe(active()?.id);
  });

  // ZUG-06, §4.16: Escape closes, and focus goes back to where it came from.
  it("closes on Escape and gives the focus back", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    try {
      render(<Palette mode="palette" />);
      expect(document.activeElement).toBe(screen.getByRole("combobox"));
      fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
      expect(useUi.getState().overlay).toEqual({ kind: "none" });
      expect(dialog().open).toBe(false);
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
    }
  });

  // A command runs with the page open again: focus is back at the opener
  // before it runs, so a command that moves focus (F6, a dialog) finds it.
  it("closes and gives the focus back before the command runs", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    let seen: { open: boolean; focus: Element | null } | null = null;
    vi.mocked(dispatchCommand).mockImplementationOnce(() => {
      seen = { open: dialog().open, focus: document.activeElement };
    });
    try {
      render(<Palette mode="palette" />);
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "menu.window.nextArea" } });
      fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
      expect(dispatchCommand).toHaveBeenCalledWith("area.next", "palette");
      expect(seen).toEqual({ open: false, focus: opener });
    } finally {
      opener.remove();
    }
  });

  it("closes on a press on the scrim only, and keeps the focus in the field on a press on a row", () => {
    render(<Palette mode="palette" />);
    vi.spyOn(dialog(), "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 400, 200));
    expect(fireEvent.mouseDown(screen.getByRole("listbox"))).toBe(false);
    fireEvent.mouseDown(dialog(), { clientX: 120, clientY: 110 });
    expect(useUi.getState().overlay).toEqual({ kind: "palette" });
    fireEvent.mouseDown(dialog(), { clientX: 20, clientY: 20 });
    expect(useUi.getState().overlay).toEqual({ kind: "none" });
  });

  // The window's keymap sees the overlays' chords (⌘K again closes, ⌘P
  // switches); every other key stays in the palette.
  it("lets the overlays' chords through to the window and keeps the others", () => {
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    try {
      render(<Palette mode="palette" />);
      const input = screen.getByRole("combobox");
      fireEvent.keyDown(input, { key: "k", code: "KeyK", metaKey: true });
      fireEvent.keyDown(input, { key: "P", code: "KeyP", metaKey: true, shiftKey: true });
      fireEvent.keyDown(input, { key: "p", code: "KeyP", metaKey: true });
      expect(seen).toHaveBeenCalledTimes(3);
      fireEvent.keyDown(input, { key: "b", code: "KeyB", metaKey: true });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(seen).toHaveBeenCalledTimes(3);
    } finally {
      window.removeEventListener("keydown", seen);
    }
  });

  it("says per mode what found nothing, with what was typed", () => {
    render(<Palette mode="quickOpen" />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "#zz" } });
    expect(screen.getByRole("status").textContent).toBe("palette.noMatch.quickOpen");
    // `@` narrows to the headings: the sentence is theirs.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "@zz" } });
    expect(screen.getByRole("status").textContent).toBe("palette.noMatch.headings");
    // With nothing typed, DAT-07: the sentence names what there is none of.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "@" } });
    expect(screen.getByRole("status").textContent).toBe("palette.empty.headings");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    expect(screen.getByRole("status").textContent).toBe("palette.empty.quickOpen");
  });

  it("says per mode what there is none of when nothing is typed", () => {
    const note = render(<Palette mode="pickNote" pick={{ exclude: [], onPick: vi.fn(async () => {}) }} />);
    expect(screen.getByRole("status").textContent).toBe("palette.empty.pickNote");
    note.unmount();
    render(<Palette mode="pickFolder" pickFolder={{ name: "a.md", folders: [], onPick: vi.fn(async () => {}) }} />);
    expect(screen.getByRole("status").textContent).toBe("palette.empty.pickFolder");
  });

  // ZUG-09, D100 (6): a name wraps; a file's name and folder break after - . _ /.
  it("writes a file's name and its folder as file names", () => {
    useFiles.setState({ files: ["Projekte/Q3-plan/notes_v2.txt"], notes: [], loaded: true });
    render(<Palette mode="quickOpen" />);
    const row = active()!;
    const name = row.querySelector(".sb-row__name > .sb-file-name")!;
    expect(name.textContent).toBe("notes_v2.txt");
    expect(name.querySelectorAll("wbr")).toHaveLength(2);
    const meta = row.querySelector(".sb-row__meta > .sb-file-name")!;
    expect(meta.textContent).toBe("Projekte/Q3-plan");
    expect(meta.querySelectorAll("wbr")).toHaveLength(2);
  });
});
