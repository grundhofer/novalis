import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCommand } from "../lib/commands";
import { useBoard } from "../stores/board";
import { useEditorSave } from "../stores/editorSave";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import TabStrip from "./TabStrip";

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

describe("TabStrip", () => {
  beforeEach(() => {
    useTabs.setState({ tabs: ["a.md", "b.md"], active: "a.md" });
    useEditorSave.setState({ docs: {} });
    useUi.setState({ toast: null, previewing: {}, activeBoard: null, boardVisible: false });
    useBoard.setState({ boards: [], slug: null });
    vi.mocked(dispatchCommand).mockClear();
  });

  // The defect: a click on a tab fired `void useTabs.getState().close(path)`
  // with no handler, so a close whose flush failed (a read-only vault, a
  // vanished file) rejected into `unhandledrejection` and painted the fatal
  // overlay over a working window. It is a toast now, like every other
  // fire-and-forget in the UI (`report`, stores/ui.ts).
  it("reports a failed close as a toast", async () => {
    const boom = new Error("EROFS");
    useTabs.setState({ close: vi.fn().mockRejectedValue(boom) });
    render(<TabStrip />);

    fireEvent.click(screen.getAllByLabelText("menu.file.closeTab")[1]!);
    await flush();

    expect(useUi.getState().toast).toEqual({
      key: "errors.internal",
      values: { detail: String(boom) },
    });
  });

  it("reports a failed activation as a toast", async () => {
    const boom = new Error("EROFS");
    useTabs.setState({ activate: vi.fn().mockRejectedValue(boom) });
    render(<TabStrip />);

    fireEvent.click(screen.getByText("b"));
    await flush();

    expect(useUi.getState().toast).toEqual({
      key: "errors.internal",
      values: { detail: String(boom) },
    });
  });

  // ADR-0020: the small button beside the strip is `Cmd+E` for the mouse —
  // a glyph whose state is the tooltip, outside the scrolling row so a row
  // of many tabs never pushes it out of sight (owner, 2026-09-16).
  describe("the preview button", () => {
    it("offers the preview of an active note and dispatches the toggle", () => {
      render(<TabStrip />);

      const button = screen.getByLabelText("editor.preview");
      expect(button.textContent).toBe("");
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expect(button.closest(".tabs")).toBeNull();

      fireEvent.click(button);
      expect(dispatchCommand).toHaveBeenCalledWith("note.togglePreview");
    });

    it("offers the editor while the note is previewed", () => {
      useUi.setState({ previewing: { "a.md": true } });
      render(<TabStrip />);

      const button = screen.getByLabelText("editor.edit");
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(button.className).toContain("on");
    });

    it("is not there for a tab with nothing else to show", () => {
      useTabs.setState({ tabs: ["a.md", "x.pdf", "b.txt"], active: "x.pdf" });
      const { rerender } = render(<TabStrip />);
      expect(screen.queryByLabelText("editor.preview")).toBeNull();
      expect(screen.queryByLabelText("editor.edit")).toBeNull();

      useTabs.setState({ active: "b.txt" });
      rerender(<TabStrip />);
      expect(screen.queryByLabelText("editor.preview")).toBeNull();
    });

    // ADR-0025: a CSV or TSV has its table behind the glyph, an SVG its picture.
    it("is there for a CSV, a TSV and an SVG", () => {
      for (const active of ["d.csv", "d.tsv", "i.svg"]) {
        useTabs.setState({ tabs: [active], active });
        const { unmount } = render(<TabStrip />);
        expect(screen.getByLabelText("editor.preview"), active).toBeTruthy();
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
      const tabs = screen.getAllByRole("tab");
      expect(tabs[0]).toHaveProperty("textContent", "Work");
      expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    });

    it("stays when the board is hidden, and a click shows it again", () => {
      useUi.setState({ boardVisible: false });
      render(<TabStrip />);
      fireEvent.click(screen.getByText("Work"));
      expect(useUi.getState().boardVisible).toBe(true);
    });

    it("closes the board with its ×", () => {
      render(<TabStrip />);
      fireEvent.click(screen.getAllByLabelText("menu.file.closeTab")[0]!);
      expect(useUi.getState()).toMatchObject({ activeBoard: null, boardVisible: false });
    });
  });
});
