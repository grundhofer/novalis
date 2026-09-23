import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CI runs in UTC, where a `toISOString()` regression of the local date would
// be invisible; east of UTC, 00:30 local is still the day before in UTC.
vi.stubEnv("TZ", "Europe/Berlin");

import { commands, NovalisError, unwrap } from "../ipc/client";
import { useEditorSave } from "../stores/editorSave";
import { useFiles } from "../stores/files";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import { dispatchCommand, moveEntry, openTreeContextMenu, QUIT_FLUSH_MS } from "./commands";

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
  useVault.setState({ reload, selected: null });
  useFiles.setState({ refresh });
  useTabs.setState({ open, active: null });
  useUi.setState({ prompt: null, toast: null });
  return { reload, refresh, open };
}

/** Run a dialog-driven command the way the dialog would: dispatch, then OK. */
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
    expect(useUi.getState().toast).toBeNull();
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
  it("opens the existing note on already_exists without a toast", async () => {
    vi.mocked(unwrap).mockRejectedValueOnce(failure("already_exists"));

    dispatchCommand("file.todayNote");
    await flush();

    expect(stores.open).toHaveBeenCalledWith("journal/2026-09-14.md");
    expect(stores.reload).not.toHaveBeenCalled();
    expect(stores.refresh).not.toHaveBeenCalled();
    expect(useUi.getState().toast).toBeNull();
  });

  it("reports any other failure as a toast and opens nothing", async () => {
    vi.mocked(unwrap).mockRejectedValueOnce(failure("io"));

    dispatchCommand("file.todayNote");
    await flush();

    expect(useUi.getState().toast?.key).toBe("errors.io");
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
    expect(useUi.getState().toast).toBeNull();
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

describe("settings.open", () => {
  it("opens the palette on the settings", () => {
    useUi.setState({ overlay: { kind: "none" } });
    dispatchCommand("settings.open");
    expect(useUi.getState().overlay).toEqual({ kind: "settings" });
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
    await openTreeContextMenu("Notes/a.md", false);
    expect(useVault.getState().selected).toBe("Notes/a.md");
    expect(commands.contextMenu).toHaveBeenLastCalledWith({ kind: "tree", board: false });

    await openTreeContextMenu("boards/atlas", true);
    expect(useVault.getState().selected).toBe("boards/atlas");
    expect(commands.contextMenu).toHaveBeenLastCalledWith({ kind: "tree", board: true });
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
    useBoard.setState({ boards: [] });
    expect(ids()).not.toContain("board.newCard");
    useBoard.setState({ boards: [{ slug: "plan", name: "Plan", order: null }] as never });
    expect(ids()).toContain("board.newCard");
    useBoard.setState({ boards: [{ slug: "a" }, { slug: "b" }] as never });
    expect(ids()).not.toContain("board.newCard");
    useUi.setState({ activeBoard: "b" });
    expect(ids()).toContain("board.newCard");
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
    expect(prompt?.titleKey).toBe("board.deleteBoard");
    expect(prompt?.confirm?.values).toEqual({ name: "Plan" });
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
// before OK.
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
