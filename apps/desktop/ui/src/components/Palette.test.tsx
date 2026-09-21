import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  commands: {},
  unwrap: vi.fn(),
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));
// No editor chunk loads in jsdom: no headings to list, nothing to jump to.
vi.mock("../lib/editorBridge", () => ({ editorHeadings: () => [], goToEditorLine: vi.fn() }));
// The command list is the real one; only what Enter dispatches is observed.
vi.mock("../lib/commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/commands")>()),
  dispatchCommand: vi.fn(),
}));

describe("Palette", () => {
  beforeEach(() => {
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
    expect(screen.getByText("palette.cmd.appearance:settings.appearance.dark")).toBeTruthy();

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
});
