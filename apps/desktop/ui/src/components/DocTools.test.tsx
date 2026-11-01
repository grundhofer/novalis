import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCommand } from "../lib/commands";
import { useEditorSave } from "../stores/editorSave";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import appCss from "../styles/app.css?raw";
import DocTools from "./DocTools";

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
// The tools only dispatch; what a command does is lib/commands.test.ts's
// and editor/commands.test.ts's.
vi.mock("../lib/commands", () => ({
  dispatchCommand: vi.fn(),
}));

/** A file read and open in the editor. */
function open(path: string, readOnly = false): void {
  useTabs.setState({ tabs: [path], active: path });
  useEditorSave.setState({ docs: { [path]: { path, text: "", readOnly } as never } });
}

const row = () => screen.queryByRole("toolbar", { name: "editor.tools.label" });
const tool = (name: string) => screen.getByRole("button", { name });
/** The tools in their order, by name. */
const names = () => [...row()!.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent);

describe("DocTools", () => {
  beforeEach(() => {
    useUi.setState({ previewing: {}, boardVisible: false, settings: null });
    vi.mocked(dispatchCommand).mockClear();
  });

  // ADR-0051 #72: the preview switch, then the formats, Find and the size.
  it("gives a Markdown note its tools in sebaro's row, the switch first", () => {
    open("a.md");
    render(<DocTools />);

    expect(row()?.className).toBe("sb-doc-bar nv-doc-tools");
    expect(names()).toEqual([
      "editor.preview",
      "menu.edit.bold",
      "menu.edit.italic",
      "menu.edit.insertLink",
      "editor.tools.heading1",
      "editor.tools.heading2",
      "editor.tools.heading3",
      "palette.cmd.list",
      "palette.cmd.task",
      "palette.cmd.code",
      "palette.cmd.quote",
      "editor.tools.find",
      "menu.view.fontSmaller",
      "menu.view.fontLarger",
    ]);
    // Four groups after the switch, a divider before each.
    expect(row()!.querySelectorAll(":scope > .sb-doc-bar__sep")).toHaveLength(4);
    expect(row()!.querySelectorAll(":scope > .nv-doc-tools__group")).toHaveLength(4);
    // Every tool is a tab stop, as in sebaro's reader row.
    for (const button of row()!.querySelectorAll("button")) expect(button.tabIndex).toBe(0);
  });

  // ADR-0020, ADR-0051 #16, #73: sebaro's compact switch with the eye and
  // its word (D102 (2), D105 (2)), at the row's start.
  it("leads with the preview switch, its word and its chord, and dispatches the toggle", () => {
    open("a.md");
    render(<DocTools />);

    const button = tool("editor.preview");
    expect(button.className).toBe("sb-secondary-action sb-secondary-action--compact");
    expect(button.textContent).toBe("editor.preview");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+E");
    expect(button.hasAttribute("data-sb-own-shortcut")).toBe(true);
    expect(button.firstElementChild?.getAttribute("class")).toBe("sb-icon sb-icon--20");
    expect(button.querySelector("use")?.getAttribute("href")).toBe("#eye");

    fireEvent.click(button);
    expect(dispatchCommand).toHaveBeenCalledWith("note.togglePreview");
  });

  // ADR-0051 #75: no sebaro icon yet, so a compact word button, its word
  // its name; the tooltip names the chord, and what a short word stands for.
  it("makes the formats without a sebaro icon word buttons with the chord in their tooltip", () => {
    open("a.md");
    render(<DocTools />);

    const bold = tool("menu.edit.bold");
    expect(bold.className).toBe("sb-secondary-action sb-secondary-action--compact");
    expect(bold.hasAttribute("aria-label")).toBe(false);
    expect(bold.getAttribute("aria-keyshortcuts")).toBe("Meta+B");
    const boldTip = document.getElementById(bold.getAttribute("aria-describedby")!)!;
    expect(boldTip.className).toBe("sb-tooltip");
    expect(boldTip.firstElementChild?.getAttribute("aria-hidden")).toBe("true");

    const h1 = tool("editor.tools.heading1");
    expect(h1.getAttribute("aria-keyshortcuts")).toBe("Alt+Meta+1");
    expect(h1.hasAttribute("data-sb-own-shortcut")).toBe(true);
    const h1Tip = document.getElementById(h1.getAttribute("aria-describedby")!)!;
    expect(h1Tip.firstElementChild?.textContent).toBe("palette.cmd.heading1");
    expect(h1Tip.firstElementChild?.hasAttribute("aria-hidden")).toBe(false);
    expect(tool("palette.cmd.list").getAttribute("aria-keyshortcuts")).toBe("Shift+Meta+8");
    expect(tool("palette.cmd.task").getAttribute("aria-keyshortcuts")).toBe("Shift+Meta+9");
  });

  it("makes Link, Code, Quote, Find and the text size icon tools", () => {
    open("a.md");
    render(<DocTools />);
    const icons: [string, string, string | null][] = [
      ["menu.edit.insertLink", "#link", "Shift+Meta+K"],
      ["palette.cmd.code", "#code", null],
      ["palette.cmd.quote", "#quote", null],
      ["editor.tools.find", "#search", "Meta+F"],
      ["menu.view.fontSmaller", "#zoom-out", "Meta+Minus"],
      ["menu.view.fontLarger", "#zoom-in", "Meta+Plus"],
    ];
    for (const [name, href, chord] of icons) {
      const button = tool(name);
      expect(button.className, name).toBe("sb-icon-button sb-icon-button--compact");
      expect(button.querySelector("use")?.getAttribute("href"), name).toBe(href);
      expect(button.getAttribute("aria-keyshortcuts"), name).toBe(chord);
    }
    // ⌘F and ⌘+ / ⌘− are sebaro's fixed chords: not the app's own.
    expect(tool("editor.tools.find").hasAttribute("data-sb-own-shortcut")).toBe(false);
  });

  it("dispatches each tool's command", () => {
    open("a.md");
    render(<DocTools />);
    const commands: [string, string][] = [
      ["menu.edit.bold", "markdown.bold"],
      ["menu.edit.italic", "markdown.italic"],
      ["menu.edit.insertLink", "markdown.link"],
      ["editor.tools.heading1", "markdown.heading1"],
      ["editor.tools.heading2", "markdown.heading2"],
      ["editor.tools.heading3", "markdown.heading3"],
      ["palette.cmd.list", "markdown.list"],
      ["palette.cmd.task", "markdown.task"],
      ["palette.cmd.code", "markdown.code"],
      ["palette.cmd.quote", "markdown.quote"],
      ["editor.tools.find", "find.open"],
      ["menu.view.fontSmaller", "view.fontSmaller"],
      ["menu.view.fontLarger", "view.fontLarger"],
    ];
    for (const [name, command] of commands) {
      fireEvent.click(tool(name));
      expect(dispatchCommand).toHaveBeenLastCalledWith(command);
    }
  });

  // NV-H9: a press on a tool leaves focus in the text.
  it("keeps focus where it is when a tool is pressed", () => {
    open("a.md");
    render(<DocTools />);
    for (const name of ["menu.edit.bold", "editor.tools.find", "menu.view.fontLarger"]) {
      expect(fireEvent.mouseDown(tool(name)), name).toBe(false);
    }
  });

  // ADR-0051 #74: off in their place while the preview shows; Find and the
  // size act on the preview too.
  it("turns the format tools off while the preview shows, and keeps every tool in its place", () => {
    open("a.md");
    const { rerender } = render(<DocTools />);
    const before = names();
    useUi.setState({ previewing: { "a.md": true } });
    rerender(<DocTools />);

    expect(names()).toEqual(before);
    expect(tool("editor.preview").getAttribute("aria-pressed")).toBe("true");
    for (const name of before.slice(1, 11)) {
      const button = tool(name!) as HTMLButtonElement;
      expect(button.getAttribute("aria-disabled"), name!).toBe("true");
      // aria-disabled, not the native attribute: it stays a tab stop.
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
    }
    expect(dispatchCommand).not.toHaveBeenCalled();
    for (const name of ["editor.tools.find", "menu.view.fontSmaller", "menu.view.fontLarger"]) {
      expect(tool(name).hasAttribute("aria-disabled"), name).toBe(false);
    }
  });

  it("turns the formats off in a file the editor cannot write", () => {
    open("a.md", true);
    render(<DocTools />);
    expect(tool("menu.edit.bold").getAttribute("aria-disabled")).toBe("true");
    expect(tool("editor.tools.find").hasAttribute("aria-disabled")).toBe(false);
  });

  // spec/02 §4.19: ⌘− at the first and ⌘+ at the last size do nothing.
  it("turns a text size tool off at its end", () => {
    open("a.md");
    useUi.setState({ settings: { editor: { fontSize: 32 } } as never });
    const { rerender } = render(<DocTools />);
    expect(tool("menu.view.fontLarger").getAttribute("aria-disabled")).toBe("true");
    expect(tool("menu.view.fontSmaller").hasAttribute("aria-disabled")).toBe(false);

    useUi.setState({ settings: { editor: { fontSize: 9 } } as never });
    rerender(<DocTools />);
    expect(tool("menu.view.fontSmaller").getAttribute("aria-disabled")).toBe("true");
  });

  // ADR-0051 #73: a CSV, a TSV and an SVG have the switch alone.
  it("gives a CSV, a TSV and an SVG the preview switch alone", () => {
    for (const path of ["d.csv", "d.tsv", "i.svg"]) {
      open(path);
      const { unmount } = render(<DocTools />);
      expect(names(), path).toEqual(["editor.preview"]);
      expect(row()!.querySelector(".sb-doc-bar__sep"), path).toBeNull();
      unmount();
    }
  });

  it("is not there for a text or code file, a viewer's file, the board or a file on its way", () => {
    for (const path of ["b.txt", "c.ts", "x.pdf"]) {
      open(path);
      const { unmount } = render(<DocTools />);
      expect(row(), path).toBeNull();
      unmount();
    }

    open("a.md");
    useUi.setState({ boardVisible: true });
    const { unmount } = render(<DocTools />);
    expect(row()).toBeNull();
    unmount();

    useUi.setState({ boardVisible: false });
    useEditorSave.setState({ docs: {} });
    render(<DocTools />);
    expect(row()).toBeNull();
  });
});

// ADR-0051 #68, #73: read as text, jsdom computes no style (ADR-0011).
describe("the tool row's CSS", () => {
  it("makes the preview switch 24 px high for a pointer and leaves touch its 48", () => {
    const at = appCss.indexOf("@media not (pointer: coarse) {\n  .nv-doc-tools > .sb-secondary-action--compact {");
    expect(at).toBeGreaterThanOrEqual(0);
    const media = appCss.slice(at, appCss.indexOf("\n}\n", at));
    expect(media).toContain("min-block-size: var(--sb-size-target-pointer);");
    expect(media).toContain("line-height: 1;");
  });

  it("keeps no rule for the switch at the tab row's end", () => {
    expect(appCss).not.toContain("nv-doc-head__tools");
  });
});
