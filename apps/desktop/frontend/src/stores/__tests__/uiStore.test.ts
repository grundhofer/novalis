// Closing a tab, closing a pane, splitting and moving a tab all destroy an
// editor, and unmounting an editor does NOT flush it. Each of those actions
// therefore drains the pending autosave first and BAILS if that save failed —
// at that point the editor holds the only copy of the edit, so proceeding would
// destroy it. These tests pin that contract; without them the ordering is one
// refactor away from silently inverting, and the failure mode is lost work
// rather than a crash.
//
// vaultStore's actions live in its state, so they are stubbed by setting them
// rather than by mocking the module — the seam the store itself uses.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Pane, Workspace } from "../../lib/workspacePrefs";
import { useUi } from "../uiStore";
import { useVault } from "../vaultStore";

function pane(id: string, tabs: string[], activeTab: string | null = tabs[0] ?? null): Pane {
  return { id, tabs, activeTab };
}

function workspace(panes: Pane[], focusedPaneId = panes[0].id): Workspace {
  return { panes, focusedPaneId, direction: "row" };
}

/** Stub the vault seam. `flushActive` records the workspace as it looked at
 *  flush time, which is how the ordering assertions are made. */
function stubVault(opts: { saveFailedFor?: string | null } = {}) {
  const atFlush: Workspace[] = [];
  const flushActive = vi.fn(async () => {
    atFlush.push(useUi.getState().workspace);
  });
  const surfaceSaveError = vi.fn((p: string) => p === opts.saveFailedFor);
  useVault.setState({
    vaultPath: null, // keeps `persist` a no-op — no prefs written from a test
    flushActive,
    surfaceSaveError,
    pruneNoteState: vi.fn(),
    adoptFocusedNote: vi.fn(async () => {}),
  } as unknown as Parameters<typeof useVault.setState>[0]);
  return { flushActive, surfaceSaveError, atFlush };
}

describe("uiStore flush-before-destroy contract", () => {
  beforeEach(() => {
    useUi.setState({ workspace: workspace([pane("main", ["a.md"])]) });
  });

  it("closeTab drains the pending autosave while the tab is still open", async () => {
    useUi.setState({ workspace: workspace([pane("main", ["a.md", "b.md"], "a.md")]) });
    const { flushActive, atFlush } = stubVault();

    await useUi.getState().closeTab("a.md");

    expect(flushActive).toHaveBeenCalledTimes(1);
    // Ordering is the whole point: flushing after the tab is gone drains an
    // editor that has already unmounted.
    expect(atFlush[0].panes[0].tabs).toContain("a.md");
    expect(useUi.getState().workspace.panes[0].tabs).toEqual(["b.md"]);
  });

  it("closeTab keeps the tab open when its save failed", async () => {
    useUi.setState({ workspace: workspace([pane("main", ["a.md", "b.md"], "a.md")]) });
    stubVault({ saveFailedFor: "a.md" });

    await useUi.getState().closeTab("a.md");

    // The edit exists only on the editor; closing the tab would discard it.
    expect(useUi.getState().workspace.panes[0].tabs).toEqual(["a.md", "b.md"]);
    expect(useUi.getState().workspace.panes[0].activeTab).toBe("a.md");
  });

  it("closeTab does not write back the tab list it snapshotted before the await", async () => {
    useUi.setState({ workspace: workspace([pane("main", ["a.md", "b.md"], "a.md")]) });
    stubVault();
    // While the flush is in flight the pane changes underneath: "a.md" is
    // already gone and "c.md" has been opened. Writing back a list derived from
    // the pre-await snapshot would resurrect the old tabs and drop "c.md" —
    // a note the user just opened vanishing without a trace.
    useVault.setState({
      flushActive: vi.fn(async () => {
        useUi.setState({ workspace: workspace([pane("main", ["b.md", "c.md"], "c.md")]) });
      }),
    } as unknown as Parameters<typeof useVault.setState>[0]);

    await useUi.getState().closeTab("a.md");

    const p = useUi.getState().workspace.panes[0];
    expect(p.tabs).toEqual(["b.md", "c.md"]);
    expect(p.activeTab).toBe("c.md");
  });

  it("closePane drains every editor before one unmounts, and bails on a failed save", async () => {
    const two = workspace([pane("left", ["a.md"]), pane("right", ["b.md"])], "right");
    useUi.setState({ workspace: two });
    const { flushActive, atFlush } = stubVault();

    await useUi.getState().closePane("right");

    expect(flushActive).toHaveBeenCalledTimes(1);
    expect(atFlush[0].panes).toHaveLength(2); // flushed while both still existed
    expect(useUi.getState().workspace.panes.map((p) => p.id)).toEqual(["left"]);

    // Same move, but the closing pane's visible note failed to save.
    useUi.setState({ workspace: two });
    stubVault({ saveFailedFor: "b.md" });

    await useUi.getState().closePane("right");

    expect(useUi.getState().workspace.panes.map((p) => p.id)).toEqual(["left", "right"]);
  });

  it("splitPane flushes before duplicating, so the copy cannot fork at the last save", async () => {
    const { flushActive, atFlush } = stubVault();

    await useUi.getState().splitPane("main", "row");

    expect(flushActive).toHaveBeenCalledTimes(1);
    // The new pane mounts from openNotes, which reflects COMPLETED saves only —
    // duplicating first would lose the debounce window's edits.
    expect(atFlush[0].panes).toHaveLength(1);
    expect(useUi.getState().workspace.panes).toHaveLength(2);
  });

  it("splitPane does not duplicate a note that failed to save", async () => {
    stubVault({ saveFailedFor: "a.md" });

    await useUi.getState().splitPane("main", "row");

    expect(useUi.getState().workspace.panes).toHaveLength(1);
  });

  it("moveTabToPane bails when the TARGET pane's visible note failed to save", async () => {
    // The source pane is the obvious one to check; the target pane's editor is
    // replaced by the arriving tab and loses its own unflushed edit just as
    // surely.
    useUi.setState({
      workspace: workspace([pane("left", ["a.md"]), pane("right", ["b.md"])], "left"),
    });
    stubVault({ saveFailedFor: "b.md" });

    await useUi.getState().moveTabToPane("a.md", "left", "right");

    const ws = useUi.getState().workspace;
    expect(ws.panes.find((p) => p.id === "left")?.tabs).toEqual(["a.md"]);
    expect(ws.panes.find((p) => p.id === "right")?.tabs).toEqual(["b.md"]);
  });

  it("moveTabToPane moves the tab once both panes are clean", async () => {
    useUi.setState({
      workspace: workspace([pane("left", ["a.md"]), pane("right", ["b.md"])], "left"),
    });
    const { flushActive } = stubVault();

    await useUi.getState().moveTabToPane("a.md", "left", "right");

    const ws = useUi.getState().workspace;
    expect(flushActive).toHaveBeenCalledTimes(1);
    // The emptied source pane closes; the target holds both tabs and takes focus.
    expect(ws.panes.map((p) => p.id)).toEqual(["right"]);
    expect(ws.panes[0].tabs).toEqual(["b.md", "a.md"]);
    expect(ws.panes[0].activeTab).toBe("a.md");
    expect(ws.focusedPaneId).toBe("right");
  });
});
