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

  // Boot used to await every restore inside the one promise whose catch
  // replaces the window with "Something went wrong": a note deleted on the
  // phone since the last quit made the app unusable until state.json was
  // edited by hand (block 1 A6, docs/DECISIONS.md 2026-09-20).
  it("restores the last session around a tab whose file is gone, and says so once", async () => {
    const open = vi
      .fn()
      .mockImplementation((path: string) =>
        path === "gone.md" || path === "also-gone.md"
          ? Promise.reject(new Error(path))
          : Promise.resolve(undefined),
      );
    useEditorSave.setState({ open });

    await useTabs.getState().reopen(["a.md", "gone.md", "b.md", "also-gone.md"], "b.md");

    expect(useTabs.getState().tabs).toEqual(["a.md", "b.md"]);
    expect(useTabs.getState().active).toBe("b.md");
    expect(useUi.getState().toast).toEqual({ key: "errors.internal", values: { detail: "Error: gone.md" } });
  });

  it("makes nothing current when the active tab is the one that is gone", async () => {
    useEditorSave.setState({
      open: vi.fn().mockImplementation((path: string) => (path === "gone.md" ? Promise.reject(new Error(path)) : Promise.resolve(undefined))),
    });

    await useTabs.getState().reopen(["a.md", "gone.md"], "gone.md");

    expect(useTabs.getState().tabs).toEqual(["a.md"]);
    expect(useTabs.getState().active).toBeNull();
    // The board that was showing when the app quit is still there to come back over.
    expect(useUi.getState().boardVisible).toBe(true);
  });

  // The tree is usable while the session restores; a note opened and typed
  // into meanwhile is saved when the last session's tab is made current.
  it("reports a save that fails on the way to the last active tab, instead of throwing", async () => {
    useTabs.setState({ tabs: ["meanwhile.md"], active: "meanwhile.md", history: ["meanwhile.md"], historyIndex: 0 });
    useEditorSave.setState({ save: vi.fn().mockRejectedValue(new Error("disk full")) });

    await expect(useTabs.getState().reopen(["a.md"], "a.md")).resolves.toBeUndefined();

    expect(useTabs.getState().tabs).toEqual(["meanwhile.md", "a.md"]);
    expect(useTabs.getState().active).toBe("meanwhile.md");
    expect(useUi.getState().toast?.values).toEqual({ detail: "Error: disk full" });
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

  it("ends a note's preview when its tab closes", async () => {
    useEditorSave.setState({ close: vi.fn().mockResolvedValue(undefined) });
    useTabs.setState({ tabs: ["a.md"], active: "a.md" });
    useUi.getState().togglePreview("a.md");
    await useTabs.getState().close("a.md");
    expect(useUi.getState().previewing["a.md"]).toBeUndefined();
  });

  it("still reads a note into the buffer", async () => {
    await useTabs.getState().open("a.md");
    expect(useEditorSave.getState().open).toHaveBeenCalledWith("a.md");
  });
});

// feature-gaps A7 (PLAN.md §2.3 rule 7): a cloud-only note downloads for up
// to 30 s on open — the tab shows "loading" meanwhile, and a download that
// fails or times out takes the tab away again.
describe("useTabs.open while the file is read", () => {
  beforeEach(() => {
    useTabs.setState({ tabs: ["a.md"], active: "a.md", closed: [], history: ["a.md"], historyIndex: 0 });
    useEditorSave.setState({ save: vi.fn().mockResolvedValue(undefined) });
    useVault.setState({ reveal: vi.fn().mockResolvedValue(undefined) });
  });

  it("shows the tab, current, before the read has finished", async () => {
    let finish: () => void = () => undefined;
    useEditorSave.setState({ open: vi.fn(() => new Promise<never>((resolve) => (finish = () => resolve(undefined as never)))) });

    const opening = useTabs.getState().open("cloud.md");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useTabs.getState()).toMatchObject({ tabs: ["a.md", "cloud.md"], active: "cloud.md" });
    finish();
    await opening;
  });

  it("takes the tab away and returns to the previous one when the read fails", async () => {
    useEditorSave.setState({ open: vi.fn().mockRejectedValue(new Error("materialize_timeout")) });

    await expect(useTabs.getState().open("cloud.md")).rejects.toThrow("materialize_timeout");
    expect(useTabs.getState()).toMatchObject({ tabs: ["a.md"], active: "a.md", history: ["a.md"] });
  });

  it("keeps a tab that was already open when reading it again fails", async () => {
    useTabs.setState({ tabs: ["a.md", "cloud.md"] });
    useEditorSave.setState({ open: vi.fn().mockRejectedValue(new Error("io")) });

    await expect(useTabs.getState().open("cloud.md")).rejects.toThrow("io");
    expect(useTabs.getState().tabs).toEqual(["a.md", "cloud.md"]);
  });
});

