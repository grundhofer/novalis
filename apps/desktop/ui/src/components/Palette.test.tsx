import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { unwrap } from "../ipc/client";
import { goToEditorLine } from "../lib/editorBridge";
import { setPreviewBridge } from "../lib/previewBridge";
import { useEditorSave } from "../stores/editorSave";

import { dispatchCommand } from "../lib/commands";
import { useBoard } from "../stores/board";
import { useFiles } from "../stores/files";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
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
}));

describe("Palette", () => {
  beforeEach(() => {
    vi.mocked(unwrap).mockResolvedValue({ tags: [] } as never);
    useFiles.setState({ files: [], notes: [], loaded: true });
    useBoard.setState({ boards: [] });
    useUi.setState({ overlay: { kind: "palette" } });
  });

  // The four settings have no window and no button (docs/SETTINGS.md): the
  // palette is where they are set, one entry per value (ADR-0012).
  it("lists a settings value as a command and dispatches it on Enter", () => {
    render(<Palette mode="palette" />);
    const input = screen.getByPlaceholderText("palette.placeholder");

    fireEvent.change(input, { target: { value: "dark" } });
    const label = document.querySelector(".result.active .result-label");
    expect(label?.textContent).toBe("palette.cmd.appearance:settings.appearance.dark");
    // The letters the fuzzy match took are marked.
    expect([...(label?.querySelectorAll("mark.match") ?? [])].map((mark) => mark.textContent).join("")).toBe("dark");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(dispatchCommand).toHaveBeenCalledWith("settings.appearance.dark");
    expect(useUi.getState().overlay).toEqual({ kind: "none" });
  });

  it("lists today's note and dispatches it on Enter", () => {
    render(<Palette mode="palette" />);
    const input = screen.getByPlaceholderText("palette.placeholder");

    fireEvent.change(input, { target: { value: "tree.todayNote" } });
    expect(screen.getByText("tree.todayNote")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(dispatchCommand).toHaveBeenCalledWith("file.todayNote");
  });

  // The sidebar's gear (ADR-0012, amended 2026-09-15): the palette on the
  // settings alone, nothing else to scroll past, and still no window.
  it("shows only the settings in settings mode", () => {
    render(<Palette mode="settings" />);
    const input = screen.getByPlaceholderText("palette.settingsPlaceholder");

    expect(screen.getByText("palette.cmd.language:settings.language.de")).toBeTruthy();
    expect(screen.getByText("menu.view.fontLarger")).toBeTruthy();
    expect(screen.queryByText("menu.file.newNote")).toBeNull();
    expect(screen.queryByText("tree.todayNote")).toBeNull();

    fireEvent.change(input, { target: { value: "menu.edit.checkSpellingWhileTyping" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(dispatchCommand).toHaveBeenCalledWith("settings.spellcheck");
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
    expect(screen.getByText("palette.noResults")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(dispatchCommand).not.toHaveBeenCalled();
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
      expect(document.querySelector(".result.active .result-label")?.textContent).toBe("## Open questions");
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
    const row = document.querySelector(".result.active");
    expect(row?.querySelector(".result-label")?.textContent).toBe("#project");
    expect(row?.querySelector(".result-meta")?.textContent).toBe("palette.section.tags · 4");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(useUi.getState().overlay).toEqual({ kind: "search", tag: "project" });
  });

  it("offers no tags in quick-open", async () => {
    vi.mocked(unwrap).mockResolvedValue({ tags: [{ tag: "project", count: 4 }] } as never);
    render(<Palette mode="quickOpen" />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    fireEvent.change(screen.getByPlaceholderText("palette.quickOpenPlaceholder"), { target: { value: "#proj" } });
    expect(document.querySelector(".result-label")).toBeNull();
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

    const labels = [...document.querySelectorAll(".result-label")].map((el) => el.textContent);
    expect(labels).toEqual(["c", "b"]);

    fireEvent.keyDown(screen.getByPlaceholderText("board.linkNote"), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("c.md");
    expect(dispatchCommand).not.toHaveBeenCalledWith(expect.anything());
  });
});
