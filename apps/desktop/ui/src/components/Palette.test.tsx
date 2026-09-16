import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCommand } from "../lib/commands";
import { useBoard } from "../stores/board";
import { useNotes } from "../stores/notes";
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
    useNotes.setState({ paths: [], loaded: true });
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
