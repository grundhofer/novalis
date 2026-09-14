import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { commands, NovalisError, unwrap } from "../ipc/client";
import { useNotes } from "../stores/notes";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import { dispatchCommand } from "./commands";

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
    commands: { createNote: vi.fn(), createFolder: vi.fn(), listDir: vi.fn(), listNotes: vi.fn() },
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
