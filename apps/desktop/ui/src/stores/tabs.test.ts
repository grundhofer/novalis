import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorSave } from "./editorSave";
import { useTabs } from "./tabs";
import { useUi } from "./ui";
import { useVault } from "./vault";

// The store reaches the shell through `../ipc/client`; a store test has no
// Tauri to talk to, so the boundary is mocked and only the store's own logic
// runs (ADR-0011).
vi.mock("../ipc/client", () => ({
  commands: {},
  unwrap: vi.fn(),
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));

describe("useTabs and the board pane", () => {
  beforeEach(() => {
    useTabs.setState({ tabs: [], active: null, closed: [], history: [], historyIndex: -1 });
    // The buffer and the tree are not under test; a tab is just a path here.
    useEditorSave.setState({
      open: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
    });
    useVault.setState({ reveal: vi.fn().mockResolvedValue(undefined) });
    useUi.setState({ boardVisible: true, activeBoard: "plan", toast: null });
  });

  // The defect: while the board was visible the main pane rendered the board
  // and not the editor, so a note opened from the tree, quick-open or a new
  // note landed in a tab nobody could see — "I cannot create Markdown
  // files". Only the card click hid the board. Making a tab current now does
  // (D21); the board keeps its slug, so the toggle returns to it.
  it("hides a visible board when a note is opened in the foreground", async () => {
    await useTabs.getState().open("a.md");

    expect(useTabs.getState().active).toBe("a.md");
    expect(useUi.getState().boardVisible).toBe(false);
    expect(useUi.getState().activeBoard).toBe("plan");
  });

  // Boot restores the last session's tabs this way, and a board that was
  // showing when the app quit must not be hidden by its own restore.
  it("leaves the board alone when a tab is opened in the background", async () => {
    await useTabs.getState().open("a.md", { background: true });

    expect(useTabs.getState().tabs).toEqual(["a.md"]);
    expect(useTabs.getState().active).toBeNull();
    expect(useUi.getState().boardVisible).toBe(true);
  });

  it("hides it when a tab is activated", async () => {
    useTabs.setState({ tabs: ["a.md", "b.md"], active: "a.md", history: ["a.md"], historyIndex: 0 });

    await useTabs.getState().activate("b.md");

    expect(useTabs.getState().active).toBe("b.md");
    expect(useUi.getState().boardVisible).toBe(false);
  });

  it("hides it when the tab that is already current is activated again", async () => {
    useTabs.setState({ tabs: ["a.md"], active: "a.md", history: ["a.md"], historyIndex: 0 });

    await useTabs.getState().activate("a.md");

    expect(useUi.getState().boardVisible).toBe(false);
  });

  it("hides it on back and on forward", async () => {
    useTabs.setState({
      tabs: ["a.md", "b.md"],
      active: "b.md",
      history: ["a.md", "b.md"],
      historyIndex: 1,
    });

    await useTabs.getState().back();
    expect(useTabs.getState().active).toBe("a.md");
    expect(useUi.getState().boardVisible).toBe(false);

    useUi.getState().setActiveBoard("plan");
    await useTabs.getState().forward();
    expect(useTabs.getState().active).toBe("b.md");
    expect(useUi.getState().boardVisible).toBe(false);
  });
});

describe("useTabs and the viewer", () => {
  beforeEach(() => {
    useTabs.setState({ tabs: [], active: null, closed: [], history: [], historyIndex: -1 });
    useEditorSave.setState({
      open: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
    });
    useVault.setState({ reveal: vi.fn().mockResolvedValue(undefined) });
  });

  // A PDF has no text buffer (ADR-0015): reading it as a note was a wasted
  // read and a "not UTF-8" banner. The viewer reads the file itself.
  it("opens a PDF as a tab without a text buffer", async () => {
    await useTabs.getState().open("papers/a.pdf");

    expect(useTabs.getState().tabs).toEqual(["papers/a.pdf"]);
    expect(useTabs.getState().active).toBe("papers/a.pdf");
    expect(useEditorSave.getState().open).not.toHaveBeenCalled();
  });

  it("still reads a note into the buffer", async () => {
    await useTabs.getState().open("a.md");
    expect(useEditorSave.getState().open).toHaveBeenCalledWith("a.md");
  });
});
