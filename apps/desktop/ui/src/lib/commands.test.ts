import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CI runs in UTC, where a `toISOString()` regression of the local date would
// be invisible; east of UTC, 00:30 local is still the day before in UTC.
vi.stubEnv("TZ", "Europe/Berlin");

import { commands, NovalisError, unwrap } from "../ipc/client";
import { useEditorSave } from "../stores/editorSave";
import { useFiles } from "../stores/files";
import { useTabs } from "../stores/tabs";
import { BACKGROUND_MESSAGE_MS, useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import { createDispatch, DEDUPE_MS, dispatchCommand, moveEntry, openTreeContextMenu, QUIT_FLUSH_MS } from "./commands";

// The dispatcher reaches the shell through `../ipc/client`; a lib test has no
// Tauri to talk to, so the boundary is mocked and only the dispatcher's own
// logic runs (ADR-0011).
vi.mock("../ipc/client", () => {
  class NovalisError extends Error {
    ipc: { code: string };
    constructor(ipc: { code: string }) {
      super(ipc.code);
      this.ipc = ipc;
    }
    get code(): string {
      return this.ipc.code;
    }
  }
  return {
    commands: {
      createNote: vi.fn(),
      createFolder: vi.fn(),
      listDir: vi.fn(),
      listFiles: vi.fn(),
      rename: vi.fn(),
      systemOpen: vi.fn(),
      trash: vi.fn(),
      contextMenu: vi.fn(),
      stateSave: vi.fn(),
    },
    unwrap: vi.fn(),
    NovalisError,
    errorKey: (error: unknown) => (error instanceof NovalisError ? `errors.${error.code}` : "errors.internal"),
    errorValues: () => ({}),
  };
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const entry = (path: string, dir: boolean, boardSlug: string | null = null) => ({
  path,
  name: path,
  dir,
  size: "0",
  mtimeNs: "0",
  cloudOnly: false,
  boardSlug,
  conflictCopyOf: null,
});

const failure = (code: string) =>
  new NovalisError({ code, path: null, detail: null, name: null, candidates: [] });

/** The store actions a create touches, stubbed so only the dispatch runs. */
function stubStores() {
  const reload = vi.fn().mockResolvedValue(undefined);
  const refresh = vi.fn().mockResolvedValue(undefined);
  const open = vi.fn().mockResolvedValue(undefined);
  useVault.setState({ reload, selected: null, focused: null });
  useFiles.setState({ refresh });
  useTabs.setState({ open, active: null });
  useUi.setState({ prompt: null, toast: null, message: null });
  return { reload, refresh, open };
}

/** Run a dialog-driven command the way the dialog would: dispatch, then submit. */
async function submitPrompt(id: string, value: string): Promise<void> {
  dispatchCommand(id);
  const prompt = useUi.getState().prompt;
  expect(prompt).not.toBeNull();
  await prompt!.submit(value);
}

describe("file.todayNote", () => {
  let stores: ReturnType<typeof stubStores>;

  beforeEach(() => {
    stores = stubStores();
    useVault.setState({ children: { "": [entry("Notes", true), entry("a.md", false)] } });
    // Local 00:30 on the 14th: the day is the 14th in every zone, while
    // `toISOString()` would say the 13th anywhere east of UTC.
    vi.setSystemTime(new Date(2026, 8, 14, 0, 30));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates journal/<today>.md, lists the new folder, and opens the note", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce(entry("journal/2026-09-14.md", false));

    dispatchCommand("file.todayNote");
    await flush();

    expect(commands.createNote).toHaveBeenCalledWith("journal", "2026-09-14");
    // The root did not list `journal` before this note made it.
    expect(stores.reload.mock.calls).toEqual([[""], ["journal"]]);
    expect(stores.refresh).toHaveBeenCalled();
    expect(stores.open).toHaveBeenCalledWith("journal/2026-09-14.md");
    expect(useUi.getState().message).toBeNull();
  });

  it("leaves the root listing alone when it already has the journal folder", async () => {
    useVault.setState({ children: { "": [entry("journal", true)] } });
    vi.mocked(unwrap).mockResolvedValueOnce(entry("journal/2026-09-14.md", false));

    dispatchCommand("file.todayNote");
    await flush();

    expect(stores.reload.mock.calls).toEqual([["journal"]]);
  });

  // `create_atomic` is RENAME_EXCL, so the second call of the day is refused
  // with `already_exists` — which means the note is there: open it.
  it("opens the existing note on already_exists without a message", async () => {
    vi.mocked(unwrap).mockRejectedValueOnce(failure("already_exists"));

    dispatchCommand("file.todayNote");
    await flush();

    expect(stores.open).toHaveBeenCalledWith("journal/2026-09-14.md");
    expect(stores.reload).not.toHaveBeenCalled();
    expect(stores.refresh).not.toHaveBeenCalled();
    expect(useUi.getState().message).toBeNull();
  });

  it("reports any other failure in the action zone and opens nothing", async () => {
    vi.mocked(unwrap).mockRejectedValueOnce(failure("io"));

    dispatchCommand("file.todayNote");
    await flush();

    expect(useUi.getState().message?.key).toBe("errors.io");
    expect(stores.open).not.toHaveBeenCalled();
  });
});

// ADR-0026: the neighbour among the day notes that exist; from any other tab
// the step starts at today, and going forward never skips today.
describe("journal.previousDay / journal.nextDay", () => {
  let stores: ReturnType<typeof stubStores>;

  beforeEach(() => {
    stores = stubStores();
    useVault.setState({ children: { "": [entry("journal", true)] } });
    useFiles.setState({
      notes: [
        "journal/2026-09-12.md",
        "journal/2026-09-10.md",
        "journal/2026-09-11 retro.md",
        "Notes/2026-09-13.md",
        "a.md",
      ],
    });
    vi.setSystemTime(new Date(2026, 8, 14, 0, 30));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function step(id: string, active: string | null): Promise<void> {
    useTabs.setState({ active });
    dispatchCommand(id);
    await flush();
  }

  it("goes to the nearest earlier day that exists, skipping gaps and other files", async () => {
    await step("journal.previousDay", "journal/2026-09-12.md");
    expect(stores.open).toHaveBeenCalledWith("journal/2026-09-10.md");
  });

  it("goes to the nearest later day that exists", async () => {
    await step("journal.nextDay", "journal/2026-09-10.md");
    expect(stores.open).toHaveBeenCalledWith("journal/2026-09-12.md");
  });

  it("goes forward from the last earlier day to today, creating it", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce(entry("journal/2026-09-14.md", false));
    await step("journal.nextDay", "journal/2026-09-12.md");
    expect(commands.createNote).toHaveBeenCalledWith("journal", "2026-09-14");
    expect(stores.open).toHaveBeenCalledWith("journal/2026-09-14.md");
  });

  it("counts from today when the active tab is not a day note", async () => {
    await step("journal.previousDay", "Notes/2026-09-13.md");
    expect(stores.open).toHaveBeenCalledWith("journal/2026-09-12.md");
  });

  it("does nothing past the first day or past today", async () => {
    await step("journal.previousDay", "journal/2026-09-10.md");
    await step("journal.nextDay", "journal/2026-09-14.md");
    await step("journal.nextDay", null);
    expect(stores.open).not.toHaveBeenCalled();
    expect(commands.createNote).not.toHaveBeenCalled();
    expect(useUi.getState().message).toBeNull();
  });
});

// The defect: `Cmd+N` created beside a selected folder while `Shift+Cmd+N`
// created inside it, and the latter told a folder from a file by the `.md`
// extension, so a selected `.wav` was taken for a folder. One rule now, for
// both: inside the selected folder, beside the selected file, in the root.
describe("placement of a new note or folder", () => {
  beforeEach(() => {
    stubStores();
    useVault.setState({
      children: {
        "": [entry("Notes", true), entry("boards", true), entry("a.md", false)],
        Notes: [entry("Notes/b.md", false), entry("Notes/clip.wav", false)],
        boards: [entry("boards/plan", true, "plan")],
      },
    });
    vi.mocked(unwrap).mockResolvedValue(entry("x.md", false));
  });

  it("creates inside a selected folder", async () => {
    useVault.setState({ selected: "Notes" });
    await submitPrompt("file.newNote", "x");
    expect(commands.createNote).toHaveBeenCalledWith("Notes", "x");
  });

  it("creates beside a selected note", async () => {
    useVault.setState({ selected: "Notes/b.md" });
    await submitPrompt("file.newNote", "x");
    expect(commands.createNote).toHaveBeenCalledWith("Notes", "x");
  });

  it("treats a board item as a file, not a folder to create into", async () => {
    useVault.setState({ selected: "boards/plan" });
    await submitPrompt("file.newNote", "x");
    expect(commands.createNote).toHaveBeenCalledWith("boards", "x");
  });

  it("creates in the vault root with nothing selected and no active tab", async () => {
    await submitPrompt("file.newNote", "x");
    expect(commands.createNote).toHaveBeenCalledWith("", "x");
  });

  it("creates beside the active tab when the tree has not listed its folder", async () => {
    useTabs.setState({ active: "Deep/note.md" });
    await submitPrompt("file.newNote", "x");
    expect(commands.createNote).toHaveBeenCalledWith("Deep", "x");
  });

  it("creates a folder beside a selected non-note file, never under it", async () => {
    useVault.setState({ selected: "Notes/clip.wav" });
    await submitPrompt("tree.newFolder", "sub");
    expect(commands.createFolder).toHaveBeenCalledWith("Notes", "sub");
  });

  it("creates a folder inside a selected folder, like the note", async () => {
    useVault.setState({ selected: "Notes" });
    await submitPrompt("tree.newFolder", "sub");
    expect(commands.createFolder).toHaveBeenCalledWith("Notes", "sub");
  });
});

// DSK-02, ADR-0051 #1: ⌘, (and the menu, the palette, the sidebar's place)
// opens the settings view; ⌘W leaves it first, before a board or a tab.
describe("settings.open", () => {
  it("opens the settings view, and ⌘W leaves it before it closes anything", async () => {
    const closeActive = vi.fn(async () => undefined);
    useTabs.setState({ tabs: ["a.md"], active: "a.md", closeActive });
    useUi.setState({ overlay: { kind: "none" }, settingsView: false, boardVisible: true, activeBoard: "plan" });
    dispatchCommand("settings.open");
    expect(useUi.getState().settingsView).toBe(true);
    expect(useUi.getState().overlay).toEqual({ kind: "none" });

    dispatchCommand("tab.close");
    expect(useUi.getState().settingsView).toBe(false);
    expect(useUi.getState()).toMatchObject({ boardVisible: true, activeBoard: "plan" });
    expect(closeActive).not.toHaveBeenCalled();
    // The view is gone: the board's tab is pinned (ADR-0051 #35), so the
    // next ⌘W closes neither it nor the note behind it.
    dispatchCommand("tab.close");
    expect(useUi.getState()).toMatchObject({ boardVisible: true, activeBoard: "plan" });
    expect(closeActive).not.toHaveBeenCalled();
    await flush();
  });
});

// ADR-0051 #35, D102 (5): the board's tab is pinned; the board tool and
// View ▸ Board are how it comes and goes, Close All Tabs leaves it.
describe("the board's pinned tab", () => {
  it("comes and goes with board.toggle and stays through tab.closeAll", async () => {
    const closeAll = vi.fn(async () => undefined);
    useTabs.setState({ tabs: ["a.md"], active: "a.md", closeAll });
    useUi.setState({ settingsView: false, boardVisible: false, activeBoard: "plan" });
    dispatchCommand("board.toggle");
    expect(useUi.getState()).toMatchObject({ boardVisible: true, activeBoard: "plan" });
    dispatchCommand("tab.closeAll");
    expect(closeAll).toHaveBeenCalled();
    expect(useUi.getState()).toMatchObject({ boardVisible: true, activeBoard: "plan" });
    dispatchCommand("board.toggle");
    expect(useUi.getState()).toMatchObject({ boardVisible: false, activeBoard: null });
    await flush();
  });

  it("names the loaded board when board.toggle shows it, so a note tab made current keeps its tab", async () => {
    const { useBoard } = await import("../stores/board");
    useBoard.setState({ slug: "plan" });
    useUi.setState({ settingsView: false, boardVisible: false, activeBoard: null });
    dispatchCommand("board.toggle");
    expect(useUi.getState()).toMatchObject({ boardVisible: true, activeBoard: "plan" });
    // A note tab made current (stores/tabs.ts) only hides the board.
    useUi.getState().hideBoard();
    expect(useUi.getState()).toMatchObject({ boardVisible: false, activeBoard: "plan" });
    useBoard.setState({ slug: null });
    await flush();
  });
});

// spec/02 §4.16: ⌘K opens the palette and, pressed again, closes it; over
// another overlay it opens the palette.
describe("palette.open", () => {
  it("opens the palette, closes it when it is open, and replaces another overlay", () => {
    useUi.setState({ overlay: { kind: "none" } });
    dispatchCommand("palette.open");
    expect(useUi.getState().overlay).toEqual({ kind: "palette" });
    dispatchCommand("palette.open");
    expect(useUi.getState().overlay).toEqual({ kind: "none" });
    useUi.setState({ overlay: { kind: "quickOpen" } });
    dispatchCommand("palette.open");
    expect(useUi.getState().overlay).toEqual({ kind: "palette" });
  });
});

// ADR-0018: a file row dropped on a folder row. The move is the dialog's
// rename with the name kept, so the same store bookkeeping has to follow it.
describe("moveEntry", () => {
  let stores: ReturnType<typeof stubStores>;

  beforeEach(() => {
    stores = stubStores();
    useVault.setState({
      children: {
        "": [entry("Archive", true), entry("Notes", true)],
        Notes: [entry("Notes/sub", true), entry("Notes/a.md", false)],
      },
    });
    vi.mocked(unwrap).mockResolvedValue(undefined);
  });

  it("renames into the target folder, relists both folders and refreshes the notes", async () => {
    await moveEntry("Notes/a.md", "Archive");

    expect(commands.rename).toHaveBeenCalledWith("Notes/a.md", "Archive/a.md");
    expect(stores.reload.mock.calls).toEqual([["Notes"], ["Archive"]]);
    expect(stores.refresh).toHaveBeenCalled();
  });

  // ADR-0042: the shell rewrote the moved note's own relative links; its
  // open, unchanged buffer takes the disk's text, a changed one is left be.
  it("reloads the open, unchanged buffers the shell rewrote", async () => {
    const reloadFromDisk = vi.fn().mockResolvedValue(undefined);
    useEditorSave.setState({
      save: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn(),
      reloadFromDisk,
      docs: {
        "Archive/a.md": { path: "Archive/a.md", dirty: false } as never,
        "Other.md": { path: "Other.md", dirty: true } as never,
      },
    });
    vi.mocked(unwrap).mockResolvedValueOnce({ path: "Archive/a.md", rewritten: ["Archive/a.md", "Other.md"] } as never);

    await moveEntry("Notes/a.md", "Archive");

    expect(reloadFromDisk.mock.calls).toEqual([["Archive/a.md"]]);
  });

  it("does nothing when the file is dropped on the folder it is in", async () => {
    await moveEntry("Notes/a.md", "Notes");

    expect(commands.rename).not.toHaveBeenCalled();
    expect(stores.reload).not.toHaveBeenCalled();
  });

  // The core relinks the notes pointing at a moved note, not the links inside
  // a moved folder's notes nor the cards under it: a folder stays put.
  it("does not move a folder", async () => {
    await moveEntry("Notes/sub", "Archive");

    expect(commands.rename).not.toHaveBeenCalled();
  });

  it("re-keys a tab open on the moved file", async () => {
    useTabs.setState({ tabs: ["Notes/a.md"], active: "Notes/a.md" });

    await moveEntry("Notes/a.md", "Archive");

    expect(useTabs.getState().tabs).toEqual(["Archive/a.md"]);
    expect(useTabs.getState().active).toBe("Archive/a.md");
  });

  it("moves into the vault root", async () => {
    await moveEntry("Notes/a.md", "");

    expect(commands.rename).toHaveBeenCalledWith("Notes/a.md", "a.md");
    expect(stores.reload.mock.calls).toEqual([["Notes"], [""]]);
  });
});

// ADR-0020: `Cmd+E`, the menu item and the tab-strip button all arrive here.
// The preview is a per-note flag in the UI store; only a note has one.
describe("note.togglePreview", () => {
  beforeEach(() => {
    stubStores();
    useUi.setState({ previewing: {} });
  });

  it("toggles the preview of the active note on and off", () => {
    useTabs.setState({ active: "Notes/a.md" });

    dispatchCommand("note.togglePreview");
    expect(useUi.getState().previewing).toEqual({ "Notes/a.md": true });

    dispatchCommand("note.togglePreview");
    expect(useUi.getState().previewing).toEqual({});
  });

  it("does nothing for a tab that has no second representation", () => {
    for (const active of ["a.pdf", "a.txt", "a.json"]) {
      useTabs.setState({ active });
      dispatchCommand("note.togglePreview");
    }
    expect(useUi.getState().previewing).toEqual({});
  });

  // ADR-0025: a CSV or TSV has a table, an SVG its picture.
  it("toggles the table of a CSV and the picture of an SVG", () => {
    useTabs.setState({ active: "data/a.csv" });
    dispatchCommand("note.togglePreview");
    useTabs.setState({ active: "icon.svg" });
    dispatchCommand("note.togglePreview");
    expect(useUi.getState().previewing).toEqual({ "data/a.csv": true, "icon.svg": true });
  });

  it("returns a table to the text on an editor chord, as it cannot take one", () => {
    useTabs.setState({ active: "a.tsv" });
    dispatchCommand("note.togglePreview");

    dispatchCommand("find.open");
    expect(useUi.getState().previewing).toEqual({});
  });

  it("does nothing with no tab", () => {
    dispatchCommand("note.togglePreview");
    expect(useUi.getState().previewing).toEqual({});
  });
});

// ADR-0021: the context menu is the shell's native popup over File menu ids;
// the UI's part is to select the row first, so the ids act on it.
describe("tree context menu and reveal", () => {
  beforeEach(() => {
    stubStores();
    vi.mocked(unwrap).mockImplementation((call) => Promise.resolve(call as never));
    vi.mocked(commands.contextMenu).mockClear();
    vi.mocked(commands.systemOpen).mockClear();
  });

  it("selects the row, then asks the shell for the menu — a board row for its short form", async () => {
    await openTreeContextMenu("Notes/a.md", false, false);
    expect(useVault.getState().selected).toBe("Notes/a.md");
    expect(commands.contextMenu).toHaveBeenLastCalledWith({ kind: "tree", board: false, folder: false });

    await openTreeContextMenu("Notes", false, true);
    expect(commands.contextMenu).toHaveBeenLastCalledWith({ kind: "tree", board: false, folder: true });

    await openTreeContextMenu("boards/atlas", true, true);
    expect(useVault.getState().selected).toBe("boards/atlas");
    expect(commands.contextMenu).toHaveBeenLastCalledWith({ kind: "tree", board: true, folder: true });
  });

  // NAV-11: the tree's arrows move focus without choosing; a tree command
  // acts on the row focus is on.
  it("acts on the focused row before the chosen one", async () => {
    useVault.setState({ selected: "Notes", focused: "Notes/a.md" });
    await dispatchCommand("tree.reveal");
    expect(commands.systemOpen).toHaveBeenLastCalledWith({ kind: "reveal", path: "Notes/a.md" });
  });

  it("reveals the selected row, else the active tab, else nothing", async () => {
    useVault.setState({ selected: "Notes" });
    useTabs.setState({ active: "Notes/a.md" });
    await dispatchCommand("tree.reveal");
    expect(commands.systemOpen).toHaveBeenLastCalledWith({ kind: "reveal", path: "Notes" });

    useVault.setState({ selected: null });
    await dispatchCommand("tree.reveal");
    expect(commands.systemOpen).toHaveBeenLastCalledWith({ kind: "reveal", path: "Notes/a.md" });

    useTabs.setState({ active: null });
    vi.mocked(commands.systemOpen).mockClear();
    await dispatchCommand("tree.reveal");
    expect(commands.systemOpen).not.toHaveBeenCalled();
  });

  // ADR-0043: the file in its default app; a board row is no file.
  it("opens the target in the default app, never a board row", async () => {
    const { useBoard } = await import("../stores/board");
    useBoard.setState({ boards: [{ slug: "plan", name: "Plan", order: null }] as never });
    useVault.setState({ selected: "Notes/a.md" });
    await dispatchCommand("tree.openDefault");
    expect(commands.systemOpen).toHaveBeenLastCalledWith({ kind: "default", path: "Notes/a.md" });
    vi.mocked(commands.systemOpen).mockClear();
    useVault.setState({ selected: "boards/plan" });
    await dispatchCommand("tree.openDefault");
    expect(commands.systemOpen).not.toHaveBeenCalled();
  });
});

// ADR-0043: the copy commands write the clipboard and say what they copied.
describe("copy path and link", () => {
  it("copies the absolute path, and a note's [[link]]", async () => {
    stubStores();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    useVault.setState({ vault: { root: "/Users/me/Vault" } as never, selected: "Notes/a.md" });
    useFiles.setState({ notes: ["Notes/a.md", "Other/a.md"] });
    dispatchCommand("file.copyPath");
    await flush();
    expect(writeText).toHaveBeenLastCalledWith("/Users/me/Vault/Notes/a.md");
    dispatchCommand("file.copyLink");
    await flush();
    expect(writeText).toHaveBeenLastCalledWith("[[Notes/a]]");
    expect(useUi.getState().toast).toEqual({ key: "palette.copied", values: { text: "[[Notes/a]]" } });
  });
});

// D19: ⌘Q, the menu's Quit and the close button write every buffer before
// the shell exits, and never wait longer than two seconds for it.
describe("app.quit", () => {
  const flushAll = useEditorSave.getState().flushAll;
  beforeEach(() => {
    stubStores();
    vi.mocked(unwrap).mockImplementation((call) => Promise.resolve(call as never));
    vi.mocked(commands.stateSave).mockReset();
    useTabs.setState({ tabs: ["a.md"], active: "a.md" });
  });
  afterEach(() => {
    vi.useRealTimers();
    useEditorSave.setState({ flushAll });
  });

  it("saves every buffer, then sends the state with quit", async () => {
    const order: string[] = [];
    useEditorSave.setState({
      flushAll: vi.fn(async () => {
        await flush();
        order.push("flush");
      }),
    });
    vi.mocked(commands.stateSave).mockImplementation((state) => {
      order.push(`state:${String(state.quit)}`);
      return null as never;
    });

    dispatchCommand("app.quit");
    for (let i = 0; i < 4; i += 1) await flush();

    expect(order).toEqual(["flush", "state:true"]);
    expect(vi.mocked(commands.stateSave).mock.calls[0]?.[0]).toMatchObject({
      openTabs: ["a.md"],
      activeTab: "a.md",
      quit: true,
    });
  });

  it("quits after two seconds when a save hangs", async () => {
    vi.useFakeTimers();
    useEditorSave.setState({ flushAll: vi.fn(() => new Promise<void>(() => {})) });

    dispatchCommand("app.quit");
    await vi.advanceTimersByTimeAsync(QUIT_FLUSH_MS - 1);
    expect(commands.stateSave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(commands.stateSave).toHaveBeenCalledTimes(1);
  });
});

// ADR-0030: New Card is offered only where there is a board to put it on.
describe("board.newCard in the palette", () => {
  it("is listed for an active board or a single one, and not without", async () => {
    const { paletteCommands } = await import("./commands");
    const { useBoard } = await import("../stores/board");
    const ids = () => paletteCommands().map((c) => c.id);
    useUi.setState({ activeBoard: null });
    useBoard.setState({ boards: [], slug: null });
    expect(ids()).not.toContain("board.newCard");
    useBoard.setState({ boards: [{ slug: "plan", name: "Plan", order: null }] as never });
    expect(ids()).toContain("board.newCard");
    useBoard.setState({ boards: [{ slug: "a" }, { slug: "b" }] as never });
    expect(ids()).not.toContain("board.newCard");
    useUi.setState({ activeBoard: "b" });
    expect(ids()).toContain("board.newCard");
    // Hidden by the board tool, the board loses its tab (ADR-0051 #35) and
    // stays loaded: still the one New Card puts its card on.
    useUi.setState({ activeBoard: null });
    useBoard.setState({ slug: "b" });
    expect(ids()).toContain("board.newCard");
    useBoard.setState({ slug: null });
  });
});

// AKT-08 (ADR-0051): the question names what goes, the text says where it
// goes and that it comes back from there, the button repeats the verb.
describe("moving to the Trash", () => {
  it("names the file or folder and says it can come back", () => {
    stubStores();
    useVault.setState({
      selected: "notes/a.md",
      children: { notes: [entry("notes/a.md", false), entry("notes/old", true)] },
    });

    dispatchCommand("tree.trash");
    let prompt = useUi.getState().prompt;
    expect(prompt?.titleKey).toBe("app.confirmTrash.title");
    expect(prompt?.titleValues).toEqual({ name: "a.md" });
    expect(prompt?.confirm?.bodyKey).toBe("app.confirmTrash.body");
    expect(prompt?.confirm?.confirmKey).toBe("app.confirmTrash.confirm");

    useUi.setState({ prompt: null });
    useVault.setState({ selected: "notes/old" });
    dispatchCommand("tree.trash");
    prompt = useUi.getState().prompt;
    expect(prompt?.titleValues).toEqual({ name: "old" });
    expect(prompt?.confirm?.bodyKey).toBe("app.confirmTrash.bodyFolder");
    expect(commands.trash).not.toHaveBeenCalled();
  });
});

// ADR-0034: a board is deleted by its own confirmation, from the pane or from
// Move to Trash on its tree row, and nothing of it outlives the delete.
describe("deleting a board", () => {
  it("routes Move to Trash on a board row to the board's confirmation, then cleans up", async () => {
    const { useBoard } = await import("../stores/board");
    const reload = vi.fn().mockResolvedValue(undefined);
    useVault.setState({ reload, selected: "boards/plan" });
    useTabs.setState({ active: null });
    useUi.setState({ prompt: null, activeBoard: "plan" });
    useBoard.setState({
      boards: [{ slug: "plan", name: "Plan", order: null }, { slug: "ideas", name: "Ideas", order: null }] as never,
      slug: "plan",
      board: { slug: "plan" } as never,
    });
    vi.mocked(unwrap).mockResolvedValue(undefined as never);

    dispatchCommand("tree.trash");
    const prompt = useUi.getState().prompt;
    expect(prompt?.titleKey).toBe("board.deleteBoardTitle");
    expect(prompt?.titleValues).toEqual({ name: "Plan" });
    expect(prompt?.confirm?.values).toEqual({ name: "Plan" });
    // To the Trash, worded as a file to the Trash (AKT-08).
    expect(prompt?.confirm?.confirmKey).toBe("app.confirmTrash.confirm");
    expect(commands.trash).not.toHaveBeenCalled();

    await prompt!.submit("");
    expect(commands.trash).toHaveBeenCalledWith("boards/plan");
    expect(useBoard.getState().boards.map((b) => b.slug)).toEqual(["ideas"]);
    expect(useBoard.getState().board).toBeNull();
    expect(useUi.getState().activeBoard).toBeNull();
    expect(reload).toHaveBeenCalledWith("boards");
  });
});

// ADR-0035: card and note made from each other.
describe("card ↔ note", () => {
  const card = {
    id: "c1",
    title: "Ship: v2/beta",
    column: "todo",
    order: "a0",
    notes: [],
    created: "",
    updated: "",
    description: null,
    descriptionHtml: null,
  };

  async function boardWith(cards: unknown[]) {
    const { useBoard } = await import("../stores/board");
    const apply = vi.fn().mockResolvedValue(undefined);
    useBoard.setState({
      boards: [{ slug: "plan", name: "Plan", order: null }] as never,
      slug: "plan",
      board: { slug: "plan", name: "Plan", columns: [{ id: "todo", name: "To do" }], cards } as never,
      apply,
      load: vi.fn().mockResolvedValue(undefined),
    });
    return apply;
  }

  it("names a note after a card and a card after a line, without the Markdown", async () => {
    const { noteNameOfTitle, cardTitleOfLine } = await import("./commands");
    expect(noteNameOfTitle("Ship: v2/beta")).toBe("Ship- v2-beta");
    expect(noteNameOfTitle(".hidden plan")).toBe("hidden plan");
    expect(cardTitleOfLine("\n  - [ ] Call the shop\nmore")).toBe("Call the shop");
    expect(cardTitleOfLine("## Next steps")).toBe("Next steps");
    expect(cardTitleOfLine("3. third")).toBe("third");
  });

  it("creates a note from the card the menu was opened on, links it and opens it", async () => {
    const stores = stubStores();
    const apply = await boardWith([card]);
    const { openCardContextMenu } = await import("./cardActions");
    vi.mocked(unwrap).mockImplementation((call) => Promise.resolve(call as never));
    vi.mocked(commands.contextMenu).mockResolvedValue(undefined as never);
    await openCardContextMenu(card as never, { columns: [], cards: [card] } as never);
    vi.mocked(commands.createNote).mockResolvedValue(entry("Ship- v2-beta.md", false) as never);

    dispatchCommand("card.createNote");
    await flush();
    await flush();

    expect(commands.createNote).toHaveBeenCalledWith("", "Ship- v2-beta");
    expect(apply).toHaveBeenCalledWith({ kind: "linkNote", id: "c1", path: "Ship- v2-beta.md" });
    expect(stores.open).toHaveBeenCalledWith("Ship- v2-beta.md");
  });

  it("makes a card from the selected line, linked to the note, and says where", async () => {
    stubStores();
    const apply = await boardWith([]);
    useUi.setState({ activeBoard: "plan", toast: null });
    useTabs.setState({ active: "Notes/a.md" });
    const { setEditorBridge } = await import("./editorBridge");
    setEditorBridge({
      run: () => false,
      has: () => false,
      goToLine: () => undefined,
      selectionOrLine: () => "- [ ] Call the shop\nsecond line",
      selection: () => "",
    });

    dispatchCommand("board.cardFromSelection");
    await flush();

    expect(apply).toHaveBeenCalledWith({
      kind: "add",
      title: "Call the shop",
      column: "todo",
      notes: ["Notes/a.md"],
      position: { kind: "last" },
    });
    expect(useUi.getState().toast).toEqual({ key: "board.cardAdded", values: { board: "Plan" } });
    setEditorBridge(null);
  });
});

// ADR-0037: ⇧⌘F starts from a one-line selection, and Go to Heading opens
// the palette on the headings.
describe("search seeded from the selection", () => {
  it("passes a short one-line selection, and nothing for a long or multi-line one", async () => {
    const { setEditorBridge } = await import("./editorBridge");
    let selected = "  Rendering Spec ";
    setEditorBridge({
      run: () => false,
      has: () => false,
      goToLine: () => undefined,
      selectionOrLine: () => null,
      selection: () => selected,
    });
    dispatchCommand("search.vault");
    expect(useUi.getState().overlay).toEqual({ kind: "search", query: "Rendering Spec" });
    selected = "one\ntwo";
    dispatchCommand("search.vault");
    expect(useUi.getState().overlay).toEqual({ kind: "search", query: undefined });
    selected = "x".repeat(101);
    dispatchCommand("search.vault");
    expect(useUi.getState().overlay).toEqual({ kind: "search", query: undefined });
    setEditorBridge(null);
  });

  it("opens Go to Heading as its own palette", () => {
    dispatchCommand("palette.gotoHeading");
    expect(useUi.getState().overlay).toEqual({ kind: "headings" });
  });
});

// ADR-0038: a link to no note opens New Note with its name, nothing written
// before Create.
describe("newNote with a name", () => {
  it("opens the dialog in the given folder with the name filled in", async () => {
    const stores = stubStores();
    const { newNote } = await import("./commands");
    vi.mocked(unwrap).mockResolvedValue(entry("Notes/Missing.md", false) as never);
    newNote("Notes", "Missing");
    const prompt = useUi.getState().prompt;
    expect(prompt?.initial).toBe("Missing");
    expect(commands.createNote).not.toHaveBeenCalled();
    await prompt!.submit("Missing");
    expect(commands.createNote).toHaveBeenCalledWith("Notes", "Missing");
    expect(stores.open).toHaveBeenCalledWith("Notes/Missing.md");
  });
});

// View ▸ Sidebar Width ▸ Narrow · Normal · Wide and its palette rows
// (spec/02 §4.23, DSK-07, ADR-0051): a width without dragging.
describe("sidebar width without dragging", () => {
  it("sets 200, 240 or 360 px and opens a hidden sidebar", () => {
    useUi.setState({ sidebarWidth: 300, sidebarVisible: true });
    dispatchCommand("sidebar.width.min");
    expect(useUi.getState().sidebarWidth).toBe(200);
    dispatchCommand("sidebar.width.max");
    expect(useUi.getState().sidebarWidth).toBe(360);
    useUi.setState({ sidebarVisible: false });
    dispatchCommand("sidebar.width.start");
    expect(useUi.getState()).toMatchObject({ sidebarWidth: 240, sidebarVisible: true });
  });

  // DSK-07: in a window too narrow for the sidebar the choice only keeps the
  // width; a closed overlay stays closed, the choice beside the content too.
  it("only keeps the width while the sidebar lies over a narrow window", () => {
    useUi.setState({ sidebarWidth: 240, sidebarVisible: false, sidebarOverlay: true, sidebarOverlayOpen: false });
    dispatchCommand("sidebar.width.max");
    expect(useUi.getState()).toMatchObject({
      sidebarWidth: 360,
      sidebarVisible: false,
      sidebarOverlay: true,
      sidebarOverlayOpen: false,
    });
    useUi.setState({ sidebarOverlay: false });
  });

  it("is in the palette with the three words, next to Next / Previous Area", async () => {
    const { paletteCommands } = await import("./commands");
    const rows = paletteCommands().filter((c) => c.id.startsWith("sidebar.width.") || c.id.startsWith("area."));
    expect(rows).toEqual([
      { id: "sidebar.width.min", labelKey: "palette.cmd.sidebarWidth", valueKey: "sidebar.width.narrow" },
      { id: "sidebar.width.start", labelKey: "palette.cmd.sidebarWidth", valueKey: "sidebar.width.normal" },
      { id: "sidebar.width.max", labelKey: "palette.cmd.sidebarWidth", valueKey: "sidebar.width.wide" },
      { id: "area.next", labelKey: "menu.window.nextArea" },
      { id: "area.previous", labelKey: "menu.window.previousArea" },
    ]);
  });
});

// Move To… (DSK-11, spec/02 §4.22, ADR-0051 #5): the way to move a file
// without dragging. The folder is picked in quick-open; the move is the
// drop's own, so links are rebased (ADR-0042).
describe("tree.moveTo", () => {
  let stores: ReturnType<typeof stubStores>;
  const reveal = vi.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    stores = stubStores();
    reveal.mockClear();
    const { useBoard } = await import("../stores/board");
    useBoard.setState({ boards: [{ slug: "plan", name: "Plan", order: null }] as never });
    useVault.setState({
      reveal,
      children: {
        "": [entry("Archive", true), entry("Empty", true), entry("Notes", true), entry("boards", true)],
        Notes: [entry("Notes/sub", true), entry("Notes/a.md", false)],
      },
    });
    useFiles.setState({
      files: ["Notes/a.md", "Notes/sub/deep/b.md", "Archive/c.md", "boards/plan/cards/x.md", "top.md"],
    });
    useUi.setState({ overlay: { kind: "none" }, sidebarVisible: true });
    vi.mocked(unwrap).mockResolvedValue(undefined);
    vi.mocked(commands.rename).mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  /** Focus inside one of the window's areas, as the command finds it. */
  const focusIn = (area: string) => {
    document.body.innerHTML = area;
    document.querySelector<HTMLElement>("[tabindex]")?.focus();
  };

  it("offers the root and every folder but the file's own and the boards', then moves there", async () => {
    // Given from the tree: the moved row takes focus there.
    focusIn('<nav class="sb-side-nav sb-window__sidebar" id="sidebar"><div role="treeitem" tabindex="0"></div></nav>');
    useVault.setState({ focused: "Notes/a.md" });
    dispatchCommand("tree.moveTo");
    const overlay = useUi.getState().overlay;
    expect(overlay.kind).toBe("pickFolder");
    if (overlay.kind !== "pickFolder") return;
    expect(overlay.name).toBe("a.md");
    expect(overlay.folders).toEqual(["", "Archive", "boards", "Empty", "Notes/sub", "Notes/sub/deep"]);

    await overlay.onPick("Archive");

    expect(commands.rename).toHaveBeenCalledWith("Notes/a.md", "Archive/a.md");
    expect(stores.reload.mock.calls).toEqual([["Notes"], ["Archive"]]);
    expect(stores.refresh).toHaveBeenCalled();
    // The moved row is shown and takes focus: the move is seen, no toast.
    expect(reveal).toHaveBeenCalledWith("Archive/a.md");
    expect(useVault.getState()).toMatchObject({ focused: "Archive/a.md", takeFocus: true, showFocused: true });
    expect(useUi.getState().toast).toBeNull();
  });

  // ZUG-06: from the editor (the Edit menu, the palette) the row is shown
  // and becomes the tab stop, but the keyboard stays where the user writes.
  it("leaves focus in the editor when the command came from there", async () => {
    focusIn('<main class="main"><div contenteditable="true" tabindex="0"></div></main>');
    useTabs.setState({ active: "Notes/a.md", tabs: ["Notes/a.md"] });
    dispatchCommand("tree.moveTo");
    const overlay = useUi.getState().overlay;
    if (overlay.kind !== "pickFolder") throw new Error("no folder picker");
    await overlay.onPick("Archive");
    expect(useVault.getState()).toMatchObject({ focused: "Archive/a.md", takeFocus: false, showFocused: true });
    expect(useUi.getState().toast).toBeNull();
  });

  // DSK-11: a hidden tree shows no row, so a toast says where the file went
  // and offers „Rückgängig“ (D102 (16), ADR-0051 #39).
  it("says where the file went when the sidebar is hidden", async () => {
    useUi.setState({ sidebarVisible: false, toast: null });
    useVault.setState({ focused: "Notes/a.md", vault: { root: "/v", name: "Mein Vault", kind: "local", boards: [] } as never });
    dispatchCommand("tree.moveTo");
    let overlay = useUi.getState().overlay;
    if (overlay.kind !== "pickFolder") throw new Error("no folder picker");
    await overlay.onPick("Archive");
    expect(useUi.getState().toast).toMatchObject({
      key: "tree.movedTo",
      values: { folder: "Archive" },
      action: { labelKey: "app.undo" },
    });
    expect(useVault.getState()).toMatchObject({ focused: "Archive/a.md", takeFocus: false, showFocused: false });

    useVault.setState({ focused: "Archive/a.md" });
    useFiles.setState({ files: ["Archive/a.md"] });
    dispatchCommand("tree.moveTo");
    overlay = useUi.getState().overlay;
    if (overlay.kind !== "pickFolder") throw new Error("no folder picker");
    await overlay.onPick("");
    // The vault root goes by the vault's name, as in the picker.
    expect(useUi.getState().toast).toMatchObject({ key: "tree.movedTo", values: { folder: "Mein Vault" } });
  });

  // ADR-0051 #39: „Rückgängig“ moves the file back through the same rename
  // (no IPC command of its own), links rebased again, the row where it was.
  it("moves the file back on „Rückgängig“", async () => {
    useUi.setState({ sidebarVisible: false, toast: null, message: null });
    useVault.setState({ focused: "Notes/a.md" });
    useTabs.setState({ active: "Notes/a.md", tabs: ["Notes/a.md"] });
    dispatchCommand("tree.moveTo");
    const overlay = useUi.getState().overlay;
    if (overlay.kind !== "pickFolder") throw new Error("no folder picker");
    await overlay.onPick("Archive");
    stores.reload.mockClear();
    reveal.mockClear();

    await useUi.getState().toast!.action!.run();

    expect(commands.rename).toHaveBeenLastCalledWith("Archive/a.md", "Notes/a.md");
    expect(commands.rename).toHaveBeenCalledTimes(2);
    expect(stores.reload.mock.calls).toEqual([["Archive"], ["Notes"]]);
    expect(useTabs.getState().active).toBe("Notes/a.md");
    expect(reveal).toHaveBeenCalledWith("Notes/a.md");
    expect(useVault.getState()).toMatchObject({ focused: "Notes/a.md", takeFocus: false });
    expect(useUi.getState().message).toBeNull();
  });

  // The core never overwrites: a file that took the old place since keeps
  // it, and the action zone says why the move back did not happen.
  it("refuses to move back onto a file that took the old place, with a sentence", async () => {
    useUi.setState({ sidebarVisible: false, toast: null, message: null });
    useVault.setState({ focused: "Notes/a.md" });
    dispatchCommand("tree.moveTo");
    const overlay = useUi.getState().overlay;
    if (overlay.kind !== "pickFolder") throw new Error("no folder picker");
    await overlay.onPick("Archive");
    const undo = useUi.getState().toast!.action!;

    vi.mocked(unwrap).mockRejectedValueOnce(failure("already_exists"));
    await undo.run();
    expect(useUi.getState().message).toEqual({
      key: "tree.moveBackTaken",
      values: { name: "a.md", folder: "Notes" },
    });
    expect(useVault.getState().focused).toBe("Archive/a.md");

    // Any other failure is the core's own sentence, reported by the toast.
    vi.mocked(unwrap).mockRejectedValueOnce(failure("not_found"));
    await expect(undo.run()).rejects.toThrow("not_found");
  });

  // The chosen row goes along with the file: focus leaving the tree hands
  // the commands back to it, and they must find the file where it went.
  it("carries the chosen row along, so the next command finds the moved file", async () => {
    useVault.setState({ selected: "Notes/a.md", focused: "Notes/a.md" });
    useTabs.setState({ active: "Notes/a.md", tabs: ["Notes/a.md"] });
    dispatchCommand("tree.moveTo");
    let overlay = useUi.getState().overlay;
    if (overlay.kind !== "pickFolder") throw new Error("no folder picker");
    await overlay.onPick("Archive");
    expect(useVault.getState()).toMatchObject({ selected: "Archive/a.md", focused: "Archive/a.md" });

    // What the tree does when focus lands in another area.
    useVault.getState().focus(useVault.getState().selected);
    useFiles.setState({ files: ["Archive/a.md", "Notes/x.md"] });
    useUi.setState({ overlay: { kind: "none" } });
    dispatchCommand("tree.moveTo");
    overlay = useUi.getState().overlay;
    if (overlay.kind !== "pickFolder") throw new Error("no folder picker");
    await overlay.onPick("Notes");
    expect(commands.rename).toHaveBeenLastCalledWith("Archive/a.md", "Notes/a.md");
  });

  it("moves the active tab's file into the vault root when no row is focused", async () => {
    useTabs.setState({ active: "Notes/a.md", tabs: ["Notes/a.md"] });
    dispatchCommand("tree.moveTo");
    const overlay = useUi.getState().overlay;
    if (overlay.kind !== "pickFolder") throw new Error("no folder picker");
    await overlay.onPick("");
    expect(commands.rename).toHaveBeenCalledWith("Notes/a.md", "a.md");
    expect(useTabs.getState().active).toBe("a.md");
  });

  it("does nothing for a folder, a board row or a file from outside the vault", async () => {
    const { paletteCommands } = await import("./commands");
    for (const focused of ["Notes", "boards/plan", "/elsewhere/x.md"]) {
      useVault.setState({ focused });
      dispatchCommand("tree.moveTo");
      expect(useUi.getState().overlay.kind).toBe("none");
      expect(paletteCommands().some((c) => c.id === "tree.moveTo")).toBe(false);
    }
    useVault.setState({ focused: "top.md" });
    expect(paletteCommands().find((c) => c.id === "tree.moveTo")).toEqual({
      id: "tree.moveTo",
      labelKey: "menu.edit.moveTo",
    });
  });
});

// ADR-0051 #14: a native menu item is the third way a failure reason ends,
// and the second delivery of one chord must not end the first one's reason.
describe("the app's dispatcher", () => {
  let clock = 0;
  let dispatch: (id: string) => void;

  beforeEach(() => {
    stubStores();
    useUi.setState({ sidebarVisible: true });
    clock = 1000;
    dispatch = createDispatch(() => clock);
  });

  it("ends a standing reason when a menu item runs", () => {
    useUi.getState().showMessage("errors.io");
    dispatch("sidebar.toggle");
    expect(useUi.getState().message).toBeNull();
    expect(useUi.getState().sidebarVisible).toBe(false);
  });

  it("keeps a reason the first delivery caused when the same chord arrives again", () => {
    dispatch("sidebar.toggle");
    useUi.getState().showMessage("errors.io");
    clock += DEDUPE_MS - 1;
    dispatch("sidebar.toggle");
    expect(useUi.getState().message?.key).toBe("errors.io");
    expect(useUi.getState().sidebarVisible).toBe(false);
  });

  it("ends the reason for another command, or the same one later", () => {
    dispatch("sidebar.toggle");
    useUi.getState().showMessage("errors.io");
    clock += 1;
    dispatch("view.toggleInvisibles");
    expect(useUi.getState().message).toBeNull();

    useUi.getState().showMessage("errors.io");
    clock += DEDUPE_MS;
    dispatch("view.toggleInvisibles");
    expect(useUi.getState().message).toBeNull();
  });

  // spec/02 §4.17, D102 (11): a chord the app handles is the next key too,
  // and a failure without a trigger outlives it for its first 10 s.
  it("keeps a failure without a trigger for 10 s, then ends it", () => {
    vi.useFakeTimers();
    try {
      useUi.getState().showMessage("errors.io", {}, true);
      dispatch("sidebar.toggle");
      expect(useUi.getState().message?.key).toBe("errors.io");
      vi.advanceTimersByTime(BACKGROUND_MESSAGE_MS);
      clock += DEDUPE_MS;
      dispatch("sidebar.toggle");
      expect(useUi.getState().message).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// spec/02 §4.21, D102 (5), WCAG 2.5.7: the way to reorder the tabs without
// dragging, from Window and the palette.
describe("tab.moveEarlier / tab.moveLater", () => {
  beforeEach(() => {
    stubStores();
    useUi.setState({ boardVisible: false });
    useTabs.setState({ tabs: ["a.md", "b.md", "c.md"], active: "b.md" });
  });

  it("moves the current tab one place, and no further than the ends", () => {
    dispatchCommand("tab.moveEarlier");
    expect(useTabs.getState().tabs).toEqual(["b.md", "a.md", "c.md"]);
    dispatchCommand("tab.moveEarlier");
    expect(useTabs.getState().tabs).toEqual(["b.md", "a.md", "c.md"]);
    dispatchCommand("tab.moveLater");
    dispatchCommand("tab.moveLater");
    expect(useTabs.getState().tabs).toEqual(["a.md", "c.md", "b.md"]);
    expect(useTabs.getState().active).toBe("b.md");
  });

  it("leaves the tabs alone while the board's tab is current", () => {
    useUi.setState({ boardVisible: true });
    dispatchCommand("tab.moveEarlier");
    expect(useTabs.getState().tabs).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("is in the palette where the current tab can move that way", async () => {
    const { paletteCommands } = await import("./commands");
    const rows = () => paletteCommands().filter((c) => c.id.startsWith("tab.move"));
    expect(rows()).toEqual([
      { id: "tab.moveEarlier", labelKey: "menu.window.moveTabEarlier" },
      { id: "tab.moveLater", labelKey: "menu.window.moveTabLater" },
    ]);
    useTabs.setState({ active: "a.md" });
    expect(rows().map((c) => c.id)).toEqual(["tab.moveLater"]);
  });
});

// D102 (9), spec/02 §4.24: the native menu switches an item off whose command
// has no target; the flags are the commands' own conditions.
describe("menuTargetsNow", () => {
  beforeEach(() => {
    stubStores();
    useUi.setState({ boardVisible: false, settingsView: false });
    useVault.setState({ vault: null, selected: null, focused: null });
    useTabs.setState({ tabs: [], active: null, closed: [], history: [], historyIndex: -1 });
  });

  it("has no target without a vault, a tab or a row", async () => {
    const { menuTargetsNow } = await import("./commands");
    expect(Object.values(menuTargetsNow()).every((on) => !on)).toBe(true);
  });

  it("follows the tabs, the history, the closed tabs and the board", async () => {
    const { menuTargetsNow } = await import("./commands");
    useTabs.setState({
      tabs: ["a.md", "b.pdf"],
      active: "b.pdf",
      closed: ["c.md"],
      history: ["a.md", "b.pdf"],
      historyIndex: 1,
    });
    expect(menuTargetsNow()).toMatchObject({
      close: true,
      save: false,
      editor: false,
      path: true,
      vaultPath: true,
      back: true,
      forward: false,
      reopen: true,
      cycle: true,
      earlier: true,
      later: false,
    });
    useTabs.setState({ active: "a.md" });
    expect(menuTargetsNow()).toMatchObject({ save: true, editor: true, earlier: false, later: true });
    // The board is current: its tab is pinned, so ⌘W has nothing to close
    // (ADR-0051 #35); the editor's items have no text.
    useUi.setState({ boardVisible: true });
    expect(menuTargetsNow()).toMatchObject({ close: false, save: true, editor: false, earlier: false, later: false });
    // A file from outside the vault is the Finder's to rename or trash (ADR-0047).
    useUi.setState({ boardVisible: false });
    useTabs.setState({ tabs: ["/elsewhere/x.md"], active: "/elsewhere/x.md" });
    expect(menuTargetsNow()).toMatchObject({ path: true, vaultPath: false, movable: false, cycle: false });
  });

  // ADR-0051 #1: ⌘W leaves the settings view, also with nothing behind it,
  // and the view covers the editor as the board does.
  it("follows the settings view", async () => {
    const { menuTargetsNow } = await import("./commands");
    useUi.setState({ settingsView: true });
    expect(menuTargetsNow()).toMatchObject({ close: true, editor: false });
    useTabs.setState({ tabs: ["a.md"], active: "a.md", history: ["a.md"], historyIndex: 0 });
    expect(menuTargetsNow()).toMatchObject({ close: true, save: true, editor: false });
  });

  // ADR-0051 #43: View ▸ Preview is on for a tab with a preview and checked
  // while it shows; the board and the settings view are current over it.
  it("follows the current tab's preview", async () => {
    const { menuTargetsNow } = await import("./commands");
    useTabs.setState({ tabs: ["a.md", "b.pdf"], active: "a.md", history: ["a.md"], historyIndex: 0 });
    useUi.setState({ previewing: {} });
    expect(menuTargetsNow()).toMatchObject({ preview: true, previewing: false });
    useUi.setState({ previewing: { "a.md": true } });
    expect(menuTargetsNow()).toMatchObject({ preview: true, previewing: true });
    useUi.setState({ boardVisible: true });
    expect(menuTargetsNow()).toMatchObject({ preview: false, previewing: false });
    useUi.setState({ boardVisible: false, settingsView: true });
    expect(menuTargetsNow()).toMatchObject({ preview: false, previewing: false });
    // A PDF is already its viewer: no preview.
    useUi.setState({ settingsView: false });
    useTabs.setState({ active: "b.pdf" });
    expect(menuTargetsNow()).toMatchObject({ preview: false, previewing: false });
    useUi.setState({ previewing: {} });
  });

  // spec/02 §4.17, §4.18: View ▸ Sidebar checks what shows; over the content
  // of a narrow window that is the overlay (menu::sidebar_checked).
  it("says when the sidebar lies over the content and whether it is open", async () => {
    const { menuTargetsNow } = await import("./commands");
    useUi.setState({ sidebarOverlay: false, sidebarOverlayOpen: false });
    expect(menuTargetsNow()).toMatchObject({ sidebarOverlay: false, sidebarOverlayOpen: false });
    useUi.setState({ sidebarOverlay: true });
    expect(menuTargetsNow()).toMatchObject({ sidebarOverlay: true, sidebarOverlayOpen: false });
    useUi.setState({ sidebarOverlayOpen: true });
    expect(menuTargetsNow()).toMatchObject({ sidebarOverlay: true, sidebarOverlayOpen: true });
    useUi.setState({ sidebarOverlay: false, sidebarOverlayOpen: false });
  });
});
