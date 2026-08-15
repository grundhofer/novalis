// handleExternalChange must never clean-adopt disk content over a pane that
// holds unflushed edits. The per-path save state turns "dirty" only after the
// editor's serialize debounce, so a watcher `note-changed` landing inside that
// window has to consult the flush registry (PaneFlush.pendingPath) — otherwise
// the last debounce window of typing is silently discarded (the OneDrive-vault
// data-loss case).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getNote: vi.fn(), updateNote: vi.fn() }));

vi.mock("../../ipc/api", () => ({
  api: { getNote: mocks.getNote, updateNote: mocks.updateNote },
  NovalisError: class NovalisError extends Error {
    kind: string;
    constructor(err: { kind: string; message: string }) {
      super(err.message);
      this.kind = err.kind;
    }
  },
}));

import type { Note } from "../../ipc/api";
import { useUi } from "../uiStore";
import { useVault, type PaneFlush } from "../vaultStore";

function diskNote(path: string, content: string): Note {
  return { path, title: path, content, frontmatter: {}, wordCount: 0 };
}

/** Point the workspace's single pane at `path` so the note counts as visible. */
function showInPane(path: string): void {
  useUi.setState({
    workspace: {
      panes: [{ id: "main", tabs: [path], activeTab: path }],
      focusedPaneId: "main",
      direction: "row",
    },
  });
}

function paneEntry(pendingPath: string | null): PaneFlush {
  return { flush: async () => {}, pendingPath: () => pendingPath, discard: () => {} };
}

describe("vaultStore.handleExternalChange", () => {
  beforeEach(() => {
    mocks.getNote.mockReset();
    useVault.setState({
      openNotes: new Map(),
      paneEpochs: new Map(),
      saveStates: new Map(),
      saveErrors: new Map(),
      externalChange: null,
    });
  });

  afterEach(() => {
    // The flush registry is module-level state — always unregister the pane.
    useVault.getState().registerFlush("main", null);
  });

  it("prompts (no adopt, no remount) when a pane holds live edits the debounce has not surfaced", async () => {
    // Save state is NOT dirty yet — markDirty only fires after the editor's
    // serialize debounce — but the pane reports an unflushed edit.
    showInPane("live.md");
    useVault.getState().registerFlush("main", paneEntry("live.md"));
    mocks.getNote.mockResolvedValue(diskNote("live.md", "external content"));

    await useVault.getState().handleExternalChange("live.md");

    const s = useVault.getState();
    expect(s.externalChange).toBe("live.md");
    expect(s.openNotes.has("live.md")).toBe(false); // disk content NOT adopted
    expect(s.paneEpochs.get("main")).toBeUndefined(); // typing pane NOT remounted
  });

  it("prompts when the per-path save state is dirty", async () => {
    showInPane("dirty.md");
    useVault.getState().markDirty("dirty.md");
    mocks.getNote.mockResolvedValue(diskNote("dirty.md", "external content"));

    await useVault.getState().handleExternalChange("dirty.md");

    const s = useVault.getState();
    expect(s.externalChange).toBe("dirty.md");
    expect(s.openNotes.has("dirty.md")).toBe(false);
  });

  it("adopts disk content and remounts the pane when it is clean", async () => {
    showInPane("clean.md");
    useVault.getState().registerFlush("main", paneEntry(null));
    mocks.getNote.mockResolvedValue(diskNote("clean.md", "external content"));

    await useVault.getState().handleExternalChange("clean.md");

    const s = useVault.getState();
    expect(s.externalChange).toBeNull();
    expect(s.openNotes.get("clean.md")?.content).toBe("external content");
    expect(s.paneEpochs.get("main")).toBe(1); // remounted with the adopted content
    expect(s.saveStates.get("clean.md")).toBe("idle");
  });

  it("ignores our own write echo even while the pane is typing again", async () => {
    // First event: clean adopt caches the disk content.
    showInPane("echo.md");
    mocks.getNote.mockResolvedValue(diskNote("echo.md", "same content"));
    await useVault.getState().handleExternalChange("echo.md");
    expect(useVault.getState().paneEpochs.get("main")).toBe(1);

    // Second event carries identical disk content (the watcher echoing a
    // write): the echo check must win over the live-edit conflict path.
    useVault.getState().registerFlush("main", paneEntry("echo.md"));
    await useVault.getState().handleExternalChange("echo.md");

    const s = useVault.getState();
    expect(s.externalChange).toBeNull();
    expect(s.paneEpochs.get("main")).toBe(1); // no second remount
  });
});

/** Point each named pane at its own note, in one workspace. */
function showInPanes(...panes: { id: string; path: string }[]): void {
  useUi.setState({
    workspace: {
      panes: panes.map((p) => ({ id: p.id, tabs: [p.path], activeTab: p.path })),
      focusedPaneId: panes[0].id,
      direction: "row",
    },
  });
}

// saveNote is the last thing between the editor and the file on disk, and every
// guard in it exists because of a way content got lost. It has no tests: the
// suite covers handleExternalChange (above), and the two data-loss bugs fixed
// for v0.2.1-rc1 (#80, 887d424) are pinned in packages/editor — but both
// produced corrupt markdown that THIS path then persisted without complaint.
// What follows pins the guards, not the bugs.
//
// The module-level maps in vaultStore.ts (lastRequest, writeInFlight, noteCache)
// are deliberately not reset between tests — there is no hook to reset them —
// so every test below uses a path of its own.
describe("vaultStore.saveNote", () => {
  beforeEach(() => {
    mocks.updateNote.mockReset();
    useVault.setState({
      openNotes: new Map(),
      paneEpochs: new Map(),
      saveStates: new Map(),
      saveErrors: new Map(),
      externalChange: null,
      error: null,
    });
  });

  it("waits for the real outcome when identical content is already in flight", async () => {
    // The skip-identical-write shortcut must not answer "saved" for a write that
    // is still open. Callers flush-then-check — closing a tab or switching panes
    // bails on an error — so a premature success drops the edit on the floor.
    const path = "inflight.md";
    showInPanes({ id: "main", path });
    let failWrite: (e: Error) => void = () => {};
    mocks.updateNote.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        failWrite = reject;
      }),
    );

    const first = useVault.getState().saveNote(path, "content");
    let stateWhenSecondResolved: string | undefined;
    const second = useVault
      .getState()
      .saveNote(path, "content")
      .then(() => {
        stateWhenSecondResolved = useVault.getState().saveStates.get(path);
      });

    failWrite(new Error("disk full"));
    await Promise.all([first, second]);

    expect(stateWhenSecondResolved).toBe("error"); // not "saved", not "saving"
    expect(mocks.updateNote).toHaveBeenCalledTimes(1); // and no duplicate write
  });

  it("lets the same content be retried after a failed write", async () => {
    // The failure path clears lastRequest. Without that, the retry looks like a
    // redundant write, is skipped, reports "saved", and the content never lands.
    const path = "retry.md";
    showInPanes({ id: "main", path });
    mocks.updateNote
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(diskNote(path, "content"));

    await useVault.getState().saveNote(path, "content");
    expect(useVault.getState().saveStates.get(path)).toBe("error");

    await useVault.getState().saveNote(path, "content");

    expect(mocks.updateNote).toHaveBeenCalledTimes(2);
    expect(useVault.getState().saveStates.get(path)).toBe("saved");
  });

  it("mirror-on-save spares the typing pane and any pane holding its own edit", async () => {
    // Remounting a pane replaces its editor content. Doing that to a pane the
    // user is mid-sentence in discards the unflushed edit.
    const path = "shared.md";
    showInPanes({ id: "source", path }, { id: "typing", path }, { id: "idle", path });
    useVault.getState().registerFlush("typing", paneEntry(path));
    useVault.getState().registerFlush("idle", paneEntry(null));
    mocks.updateNote.mockResolvedValue(diskNote(path, "saved content"));

    await useVault.getState().saveNote(path, "saved content", "source");

    const epochs = useVault.getState().paneEpochs;
    expect(epochs.get("source")).toBeUndefined(); // the pane that produced the save
    expect(epochs.get("typing")).toBeUndefined(); // holds an unflushed edit
    expect(epochs.get("idle")).toBe(1); // control: mirroring does happen

    useVault.getState().registerFlush("typing", null);
    useVault.getState().registerFlush("idle", null);
  });

  it("clears the external-change banner it just overwrote, and only that one", async () => {
    const path = "banner.md";
    showInPanes({ id: "main", path });
    useVault.setState({ externalChange: path });
    mocks.updateNote.mockResolvedValue(diskNote(path, "ours"));

    await useVault.getState().saveNote(path, "ours");
    expect(useVault.getState().externalChange).toBeNull();

    // A banner for a different note is someone else's conflict, still unresolved.
    const other = "banner-other.md";
    showInPanes({ id: "main", path: other });
    useVault.setState({ externalChange: "elsewhere.md" });
    mocks.updateNote.mockResolvedValue(diskNote(other, "ours"));

    await useVault.getState().saveNote(other, "ours");
    expect(useVault.getState().externalChange).toBe("elsewhere.md");
  });

  it("keeps a background tab's save error off the global banner until surfaced", async () => {
    // Per-path, not "is this the active note": a banner for a note the user is
    // not looking at is noise, but the error must still be retrievable.
    const path = "background.md";
    showInPanes({ id: "main", path: "foreground.md" }); // `path` is not visible
    mocks.updateNote.mockRejectedValue(new Error("disk full"));

    await useVault.getState().saveNote(path, "content");

    expect(useVault.getState().saveStates.get(path)).toBe("error");
    expect(useVault.getState().saveErrors.get(path)).toContain("disk full");
    expect(useVault.getState().error).toBeNull();

    expect(useVault.getState().surfaceSaveError(path)).toBe(true);
    expect(useVault.getState().error).toContain("disk full");
  });
});
