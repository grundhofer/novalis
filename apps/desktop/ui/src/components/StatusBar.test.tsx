import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCommand } from "../lib/commands";
import { useCursor } from "../stores/cursor";
import { useEditorSave } from "../stores/editorSave";
import { useTabs } from "../stores/tabs";
import { BACKGROUND_MESSAGE_MS, useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import StatusBar, { countWords, inVaultValues } from "./StatusBar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number; path?: string; name?: string }) =>
      values?.path !== undefined
        ? `${key}:${values.path}`
        : values?.name !== undefined
          ? `${key}:${values.name}`
          : values?.count === undefined
            ? key
            : `${key}:${values.count}`,
  }),
}));
vi.mock("../ipc/client", () => ({
  commands: {},
  unwrap: vi.fn(),
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));

vi.mock("../lib/commands", () => ({ dispatchCommand: vi.fn() }));

/** The two frames after which a shown message's sentence is written. */
const frames = () =>
  act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });

function doc(text: string, plainMode = false) {
  return {
    path: "a.md",
    text,
    savedText: text,
    writePath: "a.md",
    precondition: null,
    lastWriteHash: null,
    dirty: false,
    saving: false,
    readOnly: false,
    plainMode,
    banner: null,
    revision: 0,
  };
}

describe("StatusBar", () => {
  beforeEach(() => {
    useTabs.setState({ tabs: ["a.md"], active: "a.md" });
    useUi.setState({ boardVisible: false, settingsView: false });
  });

  it("counts words and characters of the mirror", () => {
    useEditorSave.setState({ docs: { "a.md": doc("one two  three\n") } });
    render(<StatusBar />);
    expect(screen.getByText("status.words:3")).toBeTruthy();
    expect(screen.getByText("status.characters:15")).toBeTruthy();
  });

  // ADR-0022 F7: a plain-mode buffer (5 MB and up) is never split into words;
  // its length is free. The count itself is pinned below the render guard.
  it("never splits a plain-mode text", () => {
    const text = "one two three";
    const split = vi.spyOn(String.prototype, "split");
    expect(countWords(text, true)).toBe(0);
    expect(split).not.toHaveBeenCalled();
    expect(countWords(text, false)).toBe(3);
    expect(countWords("  ", false)).toBe(0);
    expect(countWords(undefined, false)).toBe(0);
    split.mockRestore();
  });

  it("counts no words in plain mode", () => {
    useEditorSave.setState({ docs: { "a.md": doc("one two three", true) } });
    render(<StatusBar />);
    expect(screen.queryByText(/status\.words/)).toBeNull();
    expect(screen.getByText("status.characters:13")).toBeTruthy();
    expect(document.querySelector(".sb-primary-action-bar__status")?.textContent).toBe("status.plainMode.");
  });

  // STA-07: the board shows no note, so nothing counts or states the one
  // behind it.
  it("says nothing about the note behind the board", () => {
    useEditorSave.setState({ docs: { "a.md": { ...doc("one two"), readOnly: true } } });
    useUi.setState({ boardVisible: true });
    render(<StatusBar />);
    expect(document.querySelector(".sb-primary-action-bar__counts")?.textContent ?? "").toBe("");
    expect(screen.queryByText(/status\.readOnly/)).toBeNull();
  });

  // sebaro D108 (5), spec/02 §4.17: the counter line keeps its place while
  // nothing is counted, so the zone does not jump: the last document's parts
  // stay in it, hidden by sebaro.css (`data-sb-held`); before any document
  // it is one empty line, and without a vault there is none.
  it("holds the counter line's place while the board shows", () => {
    useVault.setState({ vault: { root: "/v", name: "v", kind: "local", boards: [] } as never });
    useEditorSave.setState({ docs: { "a.md": doc("one two") } });
    const counts = () => document.querySelector(".sb-primary-action-bar__counts");
    useUi.setState({ boardVisible: true });
    const { unmount } = render(<StatusBar />);
    expect(counts()?.textContent).toBe("");
    expect(counts()?.hasAttribute("data-sb-held")).toBe(false);
    act(() => useUi.setState({ boardVisible: false }));
    expect(counts()?.textContent).toContain("status.words:2");
    expect(counts()?.hasAttribute("data-sb-held")).toBe(false);
    act(() => useUi.setState({ boardVisible: true }));
    expect(counts()?.textContent).toContain("status.words:2");
    expect(counts()?.getAttribute("data-sb-held")).toBe("");
    expect(counts()?.closest("[role=status]")).toBeNull();
    unmount();
    useVault.setState({ vault: null });
    render(<StatusBar />);
    expect(counts()).toBeNull();
  });

  // spec/02 §4.24, D74 (ADR-0051 #1): the settings view has no action zone;
  // App shows the zone there only for a failure (or a toast), and the bar
  // then holds the failure alone.
  it("holds only the failure while the settings view shows", async () => {
    useEditorSave.setState({ docs: { "a.md": { ...doc("one two"), readOnly: true } } });
    useVault.setState({ vault: { root: "/v", name: "v", kind: "local", boards: [] } as never });
    useUi.setState({ settingsView: true, message: { key: "errors.io", values: {} } });
    render(<StatusBar />);
    await frames();
    expect(document.querySelector(".sb-primary-action-bar__message")?.textContent).toBe("errors.io");
    expect(document.querySelector(".sb-primary-action-bar__counts")).toBeNull();
    expect(document.querySelector(".sb-primary-action-bar__status")).toBeNull();
    expect(document.querySelector(".sb-primary-action")).toBeNull();
    act(() => useUi.setState({ message: null }));
  });

  // feature-gaps A9 (PLAN.md §5.3 "words · line:col · cloud state"): the
  // position always, the selection and the cursors only when they say
  // something.
  describe("the cursor", () => {
    beforeEach(() => {
      useEditorSave.setState({ docs: { "a.md": doc("one two\n") } });
      useUi.setState({ previewing: {} });
      useCursor.setState({ cursor: null });
    });

    it("shows the line and column, and nothing about a selection when there is none", () => {
      useCursor.getState().set({ path: "a.md", line: 3, column: 7, selected: 0, cursors: 1 });
      render(<StatusBar />);
      expect(screen.getByText("status.position")).toBeTruthy();
      expect(screen.queryByText(/status\.selected/)).toBeNull();
      expect(screen.queryByText(/status\.cursors/)).toBeNull();
    });

    it("counts the selected characters and the cursors when there are some", () => {
      useCursor.getState().set({ path: "a.md", line: 1, column: 1, selected: 12, cursors: 3 });
      render(<StatusBar />);
      expect(screen.getByText("status.selected:12")).toBeTruthy();
      expect(screen.getByText("status.cursors:3")).toBeTruthy();
    });

    it("keeps the counter line's parts apart in its text, not only by the gap", () => {
      useCursor.getState().set({ path: "a.md", line: 1, column: 1, selected: 12, cursors: 3 });
      render(<StatusBar />);
      const counts = document.querySelector(".sb-primary-action-bar__counts")!;
      expect(counts.textContent).toBe(
        "status.words:2 · status.characters:8 · status.position · status.selected:12 · status.cursors:3",
      );
      // The separators are for a copy and a screen reader; the gap shows them.
      const separators = counts.querySelectorAll(".sb-visually-hidden");
      expect(separators).toHaveLength(4);
      expect(counts.firstElementChild?.className).toBe("");
    });

    it("says nothing about another tab's cursor, or while the note is previewed", () => {
      useCursor.getState().set({ path: "b.md", line: 1, column: 1, selected: 0, cursors: 1 });
      const { unmount } = render(<StatusBar />);
      expect(screen.queryByText("status.position")).toBeNull();
      unmount();

      useCursor.getState().set({ path: "a.md", line: 1, column: 1, selected: 0, cursors: 1 });
      useUi.setState({ previewing: { "a.md": true } });
      render(<StatusBar />);
      expect(screen.queryByText("status.position")).toBeNull();
    });

    // ADR-0051 #15: the counter line counts text; an SVG's rendered picture
    // is none, its source's words are not what the panel shows.
    it("shows no counter line while an SVG's picture shows", () => {
      useTabs.setState({ active: "p.svg" });
      useEditorSave.setState({ docs: { "p.svg": doc("<svg/>") } });
      useUi.setState({ previewing: { "p.svg": true } });
      const { unmount } = render(<StatusBar />);
      expect(document.querySelector(".sb-primary-action-bar__counts")?.textContent ?? "").toBe("");
      unmount();
      useUi.setState({ previewing: {} });
      render(<StatusBar />);
      expect(document.querySelector(".sb-primary-action-bar__counts")).toBeTruthy();
    });
  });

  // ADR-0051 #14 (EBE-05, spec/03 §12, §16, D83 (2)): a failed command
  // says why in `__message`, which replaces the state sentence (sebaro.css
  // hides `__status` while it is filled), until the next key or pointer
  // press; the counts stay.
  describe("a failure reason", () => {
    beforeEach(() => {
      useEditorSave.setState({ docs: { "a.md": { ...doc("one two\n"), readOnly: true } } });
      useVault.setState({ vault: { name: "v", root: "/v", kind: "mirrored", boards: [] } as never });
      useUi.setState({ message: null, previewing: {} });
    });

    const zone = () => document.querySelector(".sb-primary-action-bar")!;
    const messageOf = () => zone().querySelector(".sb-primary-action-bar__message")!;

    it("fills a live region that stays in the page, glyph first, before the state sentence", async () => {
      render(<StatusBar />);
      const region = messageOf();
      expect(region.getAttribute("role")).toBe("status");
      // Empty, so sebaro.css shows the state sentence instead (`:empty`).
      expect(region.childNodes).toHaveLength(0);

      act(() => useUi.getState().showMessage("errors.io", { detail: "EACCES" }));
      expect(messageOf()).toBe(region);
      // The glyph alone first: the region is shown (no longer `:empty`) and
      // in the accessibility tree before its sentence arrives.
      expect(region.children).toHaveLength(1);
      expect(region.textContent).toBe("");
      await frames();
      const glyph = region.firstElementChild!;
      expect(glyph.getAttribute("class")).toBe("sb-icon sb-icon--16");
      expect(glyph.getAttribute("aria-hidden")).toBe("true");
      expect(glyph.querySelector("use")?.getAttribute("href")).toBe("#error--16");
      // The sentence is one element beside the glyph; the system's own text
      // follows it under a closed „Details“ (spec/02 §3.28, TXT-07), so the
      // region is a `div`.
      expect(region.tagName).toBe("DIV");
      expect(region.children).toHaveLength(3);
      expect(region.children[1]!.tagName).toBe("SPAN");
      expect(region.children[1]!.textContent).toBe("errors.io");
      const details = region.children[2] as HTMLDetailsElement;
      expect(details.tagName).toBe("DETAILS");
      expect(details.className).toBe("sb-details");
      expect(details.open).toBe(false);
      expect(details.querySelector("summary > svg use")?.getAttribute("href")).toBe("#chevron-down--16");
      expect(details.querySelector("summary")?.textContent).toBe("errors.details");
      expect(details.querySelector("samp.sb-details__text")?.textContent).toBe("EACCES");
      // A press on „Details“ is inside the sentence: it keeps it.
      fireEvent.pointerDown(details.querySelector("summary")!);
      fireEvent.keyDown(details.querySelector("summary")!, { key: "Enter" });
      expect(useUi.getState().message).not.toBeNull();

      // The message comes before the state sentence it replaces; that one
      // stays in the page for sebaro.css to hide, the counts stay shown.
      const status = zone().querySelector(".sb-primary-action-bar__status")!;
      expect(region.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByText("status.words:2")).toBeTruthy();
      expect(screen.getByRole("button", { name: "menu.file.newNote" })).toBeTruthy();
    });

    // D100 (6): a note or file name in the sentence breaks after - . _ /.
    it("breaks a name in the sentence as a file name", async () => {
      render(<StatusBar />);
      act(() => useUi.getState().showMessage("errors.invalidName", { name: "a-b.md" }));
      await frames();
      const name = messageOf().querySelector(":scope > span > .sb-file-name")!;
      expect(name.textContent).toBe("a-b.md");
      expect(name.querySelectorAll("wbr")).toHaveLength(2);
    });

    // spec/07: a path in the vault is named as the tree names it; one
    // outside keeps its own (ADR-0047).
    it("names a path in the vault relative to it", async () => {
      render(<StatusBar />);
      act(() => useUi.getState().showMessage("errors.alreadyExists", { path: "/v/medien/a b.md" }));
      await frames();
      expect(messageOf().querySelector(".sb-file-name")?.textContent).toBe("medien/a b.md");
      expect(inVaultValues({ path: "/elsewhere/a.md" }, "/v")).toEqual({ path: "/elsewhere/a.md" });
      expect(inVaultValues({ path: "/vault/a.md" }, "/v")).toEqual({ path: "/vault/a.md" });
      expect(inVaultValues({ path: "a.md" }, "/v")).toEqual({ path: "a.md" });
      expect(inVaultValues({ path: "/v/a.md" }, undefined)).toEqual({ path: "/v/a.md" });
    });

    // spec/02 §3.28: never a „Details“ without content, nor for a sentence
    // that already says everything.
    it("gives „Details“ only to a failure with the system's own text", async () => {
      render(<StatusBar />);
      act(() => useUi.getState().showMessage("errors.alreadyExists", { path: "a.md", detail: "x" }));
      await frames();
      expect(messageOf().querySelector("details")).toBeNull();
      act(() => useUi.getState().showMessage("errors.io", { detail: " " }));
      await frames();
      expect(messageOf().querySelector("details")).toBeNull();
    });

    it("writes a new message's sentence after its glyph again", async () => {
      render(<StatusBar />);
      act(() => useUi.getState().showMessage("errors.io"));
      await frames();
      act(() => useUi.getState().showMessage("errors.ambiguous", { name: "x" }));
      expect(messageOf().textContent).toBe("");
      await frames();
      expect(messageOf().textContent).toBe("errors.ambiguous:x");
    });

    it("ends with Escape and empties again", () => {
      render(<StatusBar />);
      act(() => useUi.getState().showMessage("errors.io"));
      // A modifier alone does nothing yet.
      fireEvent.keyDown(window, { key: "Meta" });
      expect(useUi.getState().message).not.toBeNull();

      fireEvent.keyDown(window, { key: "Escape" });
      expect(useUi.getState().message).toBeNull();
      expect(messageOf().childNodes).toHaveLength(0);
      expect(screen.getByText(/status\.readOnly/)).toBeTruthy();
    });

    it("ends with the next pointer press anywhere", () => {
      render(<StatusBar />);
      act(() => useUi.getState().showMessage("errors.io"));
      expect(messageOf().getAttribute("data-sb-message")).toBe("command");
      fireEvent.pointerDown(document.body);
      expect(useUi.getState().message).toBeNull();
    });

    // spec/02 §4.17, D102 (11): Tab only moves focus, a press inside the
    // sentence is a press on it; neither ends it.
    it("stays through Tab and a press inside the sentence", () => {
      render(<StatusBar />);
      act(() => useUi.getState().showMessage("errors.io"));
      fireEvent.keyDown(window, { key: "Tab" });
      fireEvent.pointerDown(messageOf());
      expect(useUi.getState().message).not.toBeNull();
    });

    // A failure no action caused (autosave, watcher) stays at least 10 s.
    it("keeps a failure without a trigger for 10 s, then ends it with the next key", () => {
      vi.useFakeTimers();
      try {
        render(<StatusBar />);
        act(() => useUi.getState().showMessage("errors.io", {}, true));
        expect(messageOf().getAttribute("data-sb-message")).toBe("background");
        fireEvent.keyDown(window, { key: "a" });
        fireEvent.pointerDown(document.body);
        expect(useUi.getState().message).not.toBeNull();
        vi.advanceTimersByTime(BACKGROUND_MESSAGE_MS);
        fireEvent.keyDown(window, { key: "a" });
        expect(useUi.getState().message).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // STA-07, D72, STA-08, HAL-05: the one total of what is open, once, as a
  // sentence in a live region; a conflict carries the warning glyph and its
  // word, never a dot or a coloured word.
  describe("the state sentence", () => {
    const status = () => document.querySelector(".sb-primary-action-bar__status")!;

    beforeEach(() => {
      useUi.setState({ message: null, previewing: {} });
      useCursor.setState({ cursor: null });
      useVault.setState({
        vault: {
          name: "v",
          root: "/Users/x/Library/CloudStorage/iCloudDrive-x/v",
          kind: "fileProvider",
          boards: [],
        } as never,
        children: {
          "": [
            { path: "a.md", name: "a.md", dir: false, cloudOnly: true } as never,
            { path: "b.md", name: "b.md", dir: false, conflictCopyOf: "a.md" } as never,
            { path: "c.md", name: "c.md", dir: false, conflictCopyOf: "a.md" } as never,
          ],
        },
      });
    });

    // spec/02 §4.17, D104 (35): one span, „ · “ with a no-break space before
    // the dot, the period after the last part.
    it("says the note's state and the vault's in one sentence, the conflicts with the warning glyph", () => {
      useEditorSave.setState({ docs: { "a.md": { ...doc("x"), readOnly: true } } });
      render(<StatusBar />);
      const region = status();
      expect(region.getAttribute("role")).toBe("status");
      expect(region.textContent).toBe(
        "status.readOnly\u00a0· status.cloud.fileProvider\u00a0· status.cloud.cloudOnly:1\u00a0· status.cloud.conflicts:2.",
      );
      const conflict = region.querySelector(".sb-status")!;
      expect(conflict.className).toBe("sb-status sb-status--warning");
      expect(conflict.textContent).toBe("status.cloud.conflicts:2");
      expect(conflict.querySelector("use")?.getAttribute("href")).toBe("#warning--16");
      expect(document.querySelector(".status-dot, .warn")).toBeNull();
    });

    it("says the active conflict copy with the warning glyph, its path breaking", () => {
      useVault.setState({ vault: { name: "v", root: "/v", kind: "local", boards: [] } as never, children: {} });
      useEditorSave.setState({ docs: { "a.md": { ...doc("x"), writePath: "x/y-z.md" } } });
      render(<StatusBar />);
      const region = status();
      expect(region.textContent).toBe("status.conflictCopyActive:x/y-z.md.");
      const copy = region.querySelector(".sb-status")!;
      expect(copy.className).toBe("sb-status sb-status--warning");
      expect(copy.querySelector("use")?.getAttribute("href")).toBe("#warning--16");
      const name = copy.querySelector(":scope > span > .sb-file-name")!;
      expect(name.textContent).toBe("x/y-z.md");
      expect(name.querySelectorAll("wbr")).toHaveLength(3);
    });

    it("keeps the counts out of the live region", () => {
      useEditorSave.setState({ docs: { "a.md": doc("one two") } });
      render(<StatusBar />);
      const counts = document.querySelector(".sb-primary-action-bar__counts")!;
      expect(counts.textContent).toContain("status.words:2");
      expect(counts.closest("[role=status]")).toBeNull();
      expect(status().textContent).not.toContain("status.words");
      // The counter line comes before the sentence.
      expect(counts.compareDocumentPosition(status()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("is empty when nothing is open", () => {
      useVault.setState({ vault: { name: "v", root: "/v", kind: "local", boards: [] } as never, children: {} });
      useEditorSave.setState({ docs: { "a.md": doc("x") } });
      render(<StatusBar />);
      expect(status().textContent).toBe("");
    });
  });

  // ADR-0048, AKT-01, AKT-05, spec/02 §1.1: the one lime primary action,
  // last in the zone, with sebaro's label and progress bar.
  describe("primary action", () => {
    it("makes a new note while a vault is open", () => {
      useVault.setState({ vault: { name: "v", root: "/v", kind: "local", boards: [] } as never });
      render(<StatusBar />);
      const button = screen.getByRole("button", { name: "menu.file.newNote" });
      expect(button.className).toBe("sb-primary-action");
      expect(button.parentElement!.lastElementChild).toBe(button);
      expect(button.querySelector("svg use")?.getAttribute("href")).toBe("#plus");
      expect(button.querySelector("svg")?.getAttribute("class")).toBe("sb-icon sb-icon--24");
      expect(button.querySelector(".sb-primary-action__label")?.textContent).toBe("menu.file.newNote");
      // sebaro's fixed ⌘N is the primary action's (spec/02 §4.19).
      expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+N");
      expect(button.hasAttribute("data-sb-own-shortcut")).toBe(false);
      const bar = button.lastElementChild!;
      expect(bar.className).toBe("sb-primary-action__bar");
      expect(bar.getAttribute("aria-hidden")).toBe("true");
      fireEvent.click(button);
      expect(dispatchCommand).toHaveBeenCalledWith("file.newNote");
    });

    it("opens a vault while none is open", () => {
      useVault.setState({ vault: null });
      render(<StatusBar />);
      const button = screen.getByRole("button", { name: "app.openVault.button" });
      expect(button.className).toBe("sb-primary-action");
      expect(button.querySelector("svg")).toBeNull();
      expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+O");
      fireEvent.click(button);
      expect(dispatchCommand).toHaveBeenCalledWith("vault.open");
    });
  });
});
