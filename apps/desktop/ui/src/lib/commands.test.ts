import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CI runs in UTC, where a `toISOString()` regression of the local date would
// be invisible; east of UTC, 00:30 local is still the day before in UTC.
vi.stubEnv("TZ", "Europe/Berlin");

import { commands, NovalisError, unwrap } from "../ipc/client";
import { useNotes } from "../stores/notes";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import { dispatchCommand, moveEntry, openTreeContextMenu } from "./commands";

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
      listNotes: vi.fn(),
      rename: vi.fn(),
      reveal: vi.fn(),
      treeContextMenu: vi.fn(),
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
  useNotes.setState({ refresh });
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

  it("does nothing for a tab that is not a note", () => {
    useTabs.setState({ active: "a.pdf" });

    dispatchCommand("note.togglePreview");
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
    vi.mocked(commands.treeContextMenu).mockClear();
    vi.mocked(commands.reveal).mockClear();
  });

  it("selects the row, then asks the shell for the menu — a board row for its short form", async () => {
    await openTreeContextMenu("Notes/a.md", false);
    expect(useVault.getState().selected).toBe("Notes/a.md");
    expect(commands.treeContextMenu).toHaveBeenLastCalledWith(false);

    await openTreeContextMenu("boards/atlas", true);
    expect(useVault.getState().selected).toBe("boards/atlas");
    expect(commands.treeContextMenu).toHaveBeenLastCalledWith(true);
  });

  it("reveals the selected row, else the active tab, else nothing", async () => {
    useVault.setState({ selected: "Notes" });
    useTabs.setState({ active: "Notes/a.md" });
    await dispatchCommand("tree.reveal");
    expect(commands.reveal).toHaveBeenLastCalledWith("Notes");

    useVault.setState({ selected: null });
    await dispatchCommand("tree.reveal");
    expect(commands.reveal).toHaveBeenLastCalledWith("Notes/a.md");

    useTabs.setState({ active: null });
    vi.mocked(commands.reveal).mockClear();
    await dispatchCommand("tree.reveal");
    expect(commands.reveal).not.toHaveBeenCalled();
  });
});
