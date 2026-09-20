import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { commands, unwrap } from "../ipc/client";
import { AUTOSAVE_MS, useEditorSave } from "./editorSave";
import { useUi } from "./ui";
import { useVault } from "./vault";

// The store reaches the shell through `../ipc/client`; a store test has no
// Tauri to talk to, so the boundary is mocked and only the store's own logic
// runs (ADR-0011).
vi.mock("../ipc/client", () => ({
  commands: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    writeConflictCopy: vi.fn(),
    trash: vi.fn(),
  },
  unwrap: vi.fn(),
  isConflict: (error: unknown) => error instanceof Error && "conflict" in error,
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));

/** A document as `open()` would have left it. */
function doc(path: string) {
  return {
    path,
    text: "body",
    savedText: "body",
    writePath: path,
    precondition: { mtimeNs: "1", size: "4", hash: "h" },
    lastWriteHash: null,
    dirty: false,
    saving: false,
    readOnly: false,
    plainMode: false,
    banner: null,
    revision: 0,
  };
}

describe("useEditorSave.rename", () => {
  beforeEach(() => {
    useEditorSave.setState({ docs: {} });
  });

  // The defect: the map is keyed by path and nothing re-keyed it, so after a
  // rename the pane looked up the new path, found nothing, and fell through to
  // the empty state. Clicking the tab did not recover it.
  it("re-keys the open document so the new path resolves", () => {
    useEditorSave.setState({ docs: { "a.md": doc("a.md") } });

    useEditorSave.getState().rename("a.md", "b.md");

    const { docs } = useEditorSave.getState();
    expect(docs["a.md"]).toBeUndefined();
    expect(docs["b.md"]).toBeDefined();
    expect(docs["b.md"]?.path).toBe("b.md");
  });

  it("follows the rename with the write path while we write to the note itself", () => {
    useEditorSave.setState({ docs: { "a.md": doc("a.md") } });

    useEditorSave.getState().rename("a.md", "b.md");

    expect(useEditorSave.getState().docs["b.md"]?.writePath).toBe("b.md");
  });

  // §5.3 step 3: once we are writing to a conflict copy, that path is its own
  // and must not be dragged along by a rename of the original.
  it("leaves a conflict copy's write path alone", () => {
    const withCopy = { ...doc("a.md"), writePath: "a (conflict).md" };
    useEditorSave.setState({ docs: { "a.md": withCopy } });

    useEditorSave.getState().rename("a.md", "b.md");

    expect(useEditorSave.getState().docs["b.md"]?.writePath).toBe("a (conflict).md");
  });

  it("carries the precondition across, because a rename changes no content", () => {
    useEditorSave.setState({ docs: { "a.md": doc("a.md") } });

    useEditorSave.getState().rename("a.md", "b.md");

    expect(useEditorSave.getState().docs["b.md"]?.precondition).toEqual({
      mtimeNs: "1",
      size: "4",
      hash: "h",
    });
  });

  it("does nothing for a path it does not hold, or for a no-op rename", () => {
    useEditorSave.setState({ docs: { "a.md": doc("a.md") } });

    useEditorSave.getState().rename("missing.md", "x.md");
    useEditorSave.getState().rename("a.md", "a.md");

    expect(Object.keys(useEditorSave.getState().docs)).toEqual(["a.md"]);
  });
});

describe("useEditorSave.setText", () => {
  beforeEach(() => {
    useEditorSave.setState({ docs: {} });
    useUi.setState({ toast: null });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // The defect: the autosave timer fired `void get().save(path)` with no
  // handler. A save that fails for any reason but a conflict (§5.3 handles
  // that one inside `save`) rethrows, and from a timer there is nobody to
  // rethrow to: it went to `unhandledrejection` and painted the fatal overlay
  // while the user was typing. It is a toast now (`report`, stores/ui.ts).
  it("reports a failed autosave as a toast", async () => {
    const boom = new Error("EROFS");
    useEditorSave.setState({
      docs: { "a.md": doc("a.md") },
      save: vi.fn().mockRejectedValue(boom),
    });

    useEditorSave.getState().setText("a.md", "body edited");
    await vi.runAllTimersAsync();

    expect(useEditorSave.getState().save).toHaveBeenCalledWith("a.md");
    expect(useUi.getState().toast).toEqual({
      key: "errors.internal",
      values: { detail: String(boom) },
    });
  });
});

describe("useEditorSave.save", () => {
  const written = { mtimeNs: "5", size: "7", hash: "h" };
  const treeEntry = () => useVault.getState().children[""]?.find((e) => e.path === "a.md");

  beforeEach(() => {
    // The describe above replaces `save` on the store; this one needs the real one.
    useEditorSave.setState({ docs: {}, save: useEditorSave.getInitialState().save });
    useVault.getState().setVault({ root: "/v", name: "v", kind: "local", boards: [] }, [
      {
        path: "a.md",
        name: "a.md",
        dir: false,
        size: "4",
        mtimeNs: "1",
        cloudOnly: false,
        boardSlug: null,
        conflictCopyOf: null,
      },
    ]);
    vi.mocked(unwrap).mockReset();
  });

  // The defect: the shell drops the watcher events of our own writes (§5.3
  // step 4), so the tree never learned the mtime a save produced and its
  // "Modified" column showed the time the note was opened.
  it("tells the tree the size and mtime the write produced", async () => {
    useEditorSave.setState({ docs: { "a.md": { ...doc("a.md"), text: "body ed", dirty: true } } });
    vi.mocked(unwrap).mockResolvedValueOnce(written);

    await useEditorSave.getState().save("a.md");

    expect(treeEntry()?.mtimeNs).toBe("5");
    expect(treeEntry()?.size).toBe("7");
    expect(useEditorSave.getState().docs["a.md"]?.precondition).toEqual(written);
  });

  // A conflict copy (§5.3 step 3) is ours alone and not the note's row.
  it("leaves the tree alone while writing to a conflict copy", async () => {
    useEditorSave.setState({
      docs: { "a.md": { ...doc("a.md"), text: "body ed", dirty: true, writePath: "a (conflict).md" } },
    });
    vi.mocked(unwrap).mockResolvedValueOnce(written);

    await useEditorSave.getState().save("a.md");

    expect(treeEntry()?.mtimeNs).toBe("1");
    expect(treeEntry()?.size).toBe("4");
  });
});

describe("the lazy text mirror (ADR-0022 F7)", () => {
  const written = { mtimeNs: "5", size: "7", hash: "h" };
  /** What `read_file` answers, as the shell would. */
  const onDisk = (text: string) => ({
    path: "a.md",
    text,
    precondition: { mtimeNs: "9", size: String(text.length), hash: "disk" },
    utf8: true,
    plainMode: false,
    huge: false,
  });
  const writtenTexts = () => vi.mocked(commands.writeFile).mock.calls.map((call) => call[1]);

  beforeEach(() => {
    useEditorSave.setState({ docs: { "a.md": doc("a.md") }, save: useEditorSave.getInitialState().save });
    useVault.getState().setVault({ root: "/v", name: "v", kind: "local", boards: [] }, []);
    vi.mocked(unwrap).mockReset();
    vi.mocked(commands.writeFile).mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // The cost being removed: `doc.toString()` plus a word count on every
  // keystroke, 18–30 ms in a 5 MB note. A keystroke now marks the doc dirty
  // and nothing reads the buffer until something needs it.
  it("touch marks the doc dirty without reading the buffer; flush reads it once", () => {
    const read = vi.fn(() => "body typed");
    useEditorSave.getState().attach("a.md", read);

    useEditorSave.getState().touch("a.md");
    const afterFirst = useEditorSave.getState().docs["a.md"];
    useEditorSave.getState().touch("a.md");

    expect(afterFirst?.dirty).toBe(true);
    expect(afterFirst?.text).toBe("body");
    expect(read).not.toHaveBeenCalled();
    // The second keystroke changed nothing the UI subscribes to.
    expect(useEditorSave.getState().docs["a.md"]).toBe(afterFirst);

    expect(useEditorSave.getState().flush("a.md")).toBe("body typed");
    expect(useEditorSave.getState().flush("a.md")).toBe("body typed");
    expect(read).toHaveBeenCalledTimes(1);
    expect(useEditorSave.getState().docs["a.md"]?.text).toBe("body typed");
  });

  it("the autosave tick writes what the buffer holds, not the stale mirror", async () => {
    useEditorSave.getState().attach("a.md", () => "body typed");
    vi.mocked(unwrap).mockResolvedValueOnce(written);

    useEditorSave.getState().touch("a.md");
    await vi.runAllTimersAsync();

    expect(writtenTexts()).toEqual(["body typed"]);
    expect(useEditorSave.getState().docs["a.md"]).toMatchObject({ dirty: false, savedText: "body typed" });
  });

  // A keystroke while the write is in flight: the tick that fires meanwhile
  // finds `saving` and leaves, so the completed save must notice the buffer
  // moved on and arm the clock again — else the text waits for the next key.
  it("typing during a save keeps the doc dirty and the next tick writes it", async () => {
    let buffer = "v1";
    useEditorSave.getState().attach("a.md", () => buffer);
    let finishWrite: (value: unknown) => void = () => undefined;
    vi.mocked(unwrap).mockImplementationOnce(() => new Promise((resolve) => (finishWrite = resolve)));
    vi.mocked(unwrap).mockResolvedValueOnce(written);

    useEditorSave.getState().touch("a.md");
    const saving = useEditorSave.getState().save("a.md");
    buffer = "v2";
    useEditorSave.getState().touch("a.md");
    // The write outlasts the autosave pause: the tick fires into `saving`.
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    expect(writtenTexts()).toEqual(["v1"]);
    finishWrite(written);
    await saving;

    expect(useEditorSave.getState().docs["a.md"]?.dirty).toBe(true);
    await vi.runAllTimersAsync();
    expect(writtenTexts()).toEqual(["v1", "v2"]);
    expect(useEditorSave.getState().docs["a.md"]?.dirty).toBe(false);
  });

  // A link rewrite merged into a dirty buffer replaces the mirror and rebuilds
  // the view. Nothing may be pending after the merge, so the departing view
  // reads nothing back over the merged text.
  it("after a merge nothing is pending, so the departing view reads nothing back", async () => {
    const base = "see [[x]]\nsecond";
    useEditorSave.setState({
      docs: { "a.md": { ...doc("a.md"), text: base, savedText: base, dirty: true } },
    });
    const read = vi.fn(() => "see [[x]]\nsecond typed");
    useEditorSave.getState().attach("a.md", read);
    useEditorSave.getState().touch("a.md");
    vi.mocked(unwrap).mockResolvedValueOnce(onDisk("see [[y]]\nsecond"));

    await useEditorSave.getState().externalChange("a.md");

    const merged = useEditorSave.getState().docs["a.md"];
    expect(merged?.text).toBe("see [[y]]\nsecond typed");
    expect(merged?.revision).toBe(1);
    const reads = read.mock.calls.length;
    expect(useEditorSave.getState().flush("a.md")).toBe("see [[y]]\nsecond typed");
    expect(read).toHaveBeenCalledTimes(reads);
  });

  it("reload from disk discards the pending buffer", async () => {
    const read = vi.fn(() => "body typed");
    useEditorSave.getState().attach("a.md", read);
    useEditorSave.getState().touch("a.md");
    vi.mocked(unwrap).mockResolvedValueOnce(onDisk("from disk"));

    await useEditorSave.getState().reloadFromDisk("a.md");

    expect(useEditorSave.getState().flush("a.md")).toBe("from disk");
    expect(read).not.toHaveBeenCalled();
    expect(useEditorSave.getState().docs["a.md"]).toMatchObject({ dirty: false, revision: 1 });
  });

  it("closing writes the buffer and forgets the doc", async () => {
    useEditorSave.getState().attach("a.md", () => "body typed");
    vi.mocked(unwrap).mockResolvedValueOnce(written);
    useEditorSave.getState().touch("a.md");

    await useEditorSave.getState().close("a.md");

    expect(writtenTexts()).toEqual(["body typed"]);
    expect(useEditorSave.getState().docs["a.md"]).toBeUndefined();
  });

  // The regression the review caught: a rename by the CLI, the Finder or the
  // sync client under an open note arrives through the watcher, which does
  // not save first. The re-keyed doc must carry the buffer, not a mirror up
  // to a second old.
  it("a rename carries the keystrokes typed since the last flush", () => {
    const read = vi.fn(() => "body typed");
    useEditorSave.getState().attach("a.md", read);
    useEditorSave.getState().touch("a.md");

    useEditorSave.getState().rename("a.md", "b.md");

    expect(read).toHaveBeenCalledTimes(1);
    expect(useEditorSave.getState().docs["b.md"]).toMatchObject({ path: "b.md", text: "body typed", dirty: true });
    // The old view's way out finds nothing under the old key and reads nothing.
    expect(useEditorSave.getState().flush("a.md")).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
  });

  // A write shorter than the autosave pause: the tick has not fired yet when
  // the save completes, so the completion must see the buffer moved on.
  it("typing during a short write is saved by the tick that follows", async () => {
    let buffer = "v1";
    useEditorSave.getState().attach("a.md", () => buffer);
    let finishWrite: (value: unknown) => void = () => undefined;
    vi.mocked(unwrap).mockImplementationOnce(() => new Promise((resolve) => (finishWrite = resolve)));
    vi.mocked(unwrap).mockResolvedValueOnce(written);

    useEditorSave.getState().touch("a.md");
    const saving = useEditorSave.getState().save("a.md");
    buffer = "v2";
    useEditorSave.getState().touch("a.md");
    finishWrite(written);
    await saving;

    expect(useEditorSave.getState().docs["a.md"]).toMatchObject({ dirty: true, savedText: "v1", text: "v2" });
    await vi.runAllTimersAsync();
    expect(writtenTexts()).toEqual(["v1", "v2"]);
  });

  it("a conflicting write goes to the copy and keeps saving there what was typed meanwhile", async () => {
    let buffer = "v1";
    useEditorSave.getState().attach("a.md", () => buffer);
    const conflict = Object.assign(new Error("conflict"), { conflict: true });
    vi.mocked(unwrap).mockRejectedValueOnce(conflict); // writeFile: precondition failed
    vi.mocked(unwrap).mockImplementationOnce(async () => {
      buffer = "v2";
      useEditorSave.getState().touch("a.md");
      return "a (conflict).md"; // writeConflictCopy
    });
    vi.mocked(unwrap).mockResolvedValueOnce(written);

    useEditorSave.getState().touch("a.md");
    await useEditorSave.getState().save("a.md");

    expect(useEditorSave.getState().docs["a.md"]).toMatchObject({
      writePath: "a (conflict).md",
      dirty: true,
      banner: { kind: "changedOnDisk" },
    });
    await vi.runAllTimersAsync();
    expect(writtenTexts()).toEqual(["v1", "v2"]);
    expect(vi.mocked(commands.writeFile).mock.calls[1]?.[0]).toBe("a (conflict).md");
  });

  // The watcher's read takes time; a key typed meanwhile belongs in the merge.
  it("a keystroke during the merge's read is merged, not overwritten", async () => {
    const base = "see [[x]]\nsecond";
    useEditorSave.setState({
      docs: { "a.md": { ...doc("a.md"), text: base, savedText: base, dirty: true } },
    });
    let buffer = "see [[x]]\nsecond typed";
    useEditorSave.getState().attach("a.md", () => buffer);
    useEditorSave.getState().touch("a.md");
    vi.mocked(unwrap).mockImplementationOnce(async () => {
      buffer = "see [[x]]\nsecond typed more";
      useEditorSave.getState().touch("a.md");
      return onDisk("see [[y]]\nsecond");
    });

    await useEditorSave.getState().externalChange("a.md");

    expect(useEditorSave.getState().docs["a.md"]?.text).toBe("see [[y]]\nsecond typed more");
  });

  it("keep mine writes the buffer, and what is typed during the write follows on the tick", async () => {
    let buffer = "mine";
    useEditorSave.getState().attach("a.md", () => buffer);
    useEditorSave.getState().touch("a.md");
    vi.mocked(unwrap).mockImplementationOnce(async () => {
      buffer = "mine more";
      useEditorSave.getState().touch("a.md");
      return written; // writeFile
    });
    vi.mocked(unwrap).mockResolvedValueOnce(written);

    await useEditorSave.getState().keepMine("a.md", "fileProvider");

    expect(writtenTexts()).toEqual(["mine"]);
    expect(useEditorSave.getState().docs["a.md"]).toMatchObject({ savedText: "mine", dirty: true, banner: null });
    await vi.runAllTimersAsync();
    expect(writtenTexts()).toEqual(["mine", "mine more"]);
  });

  it("detach forgets only the reader it was given", () => {
    const first = () => "first";
    const second = () => "second";
    useEditorSave.getState().attach("a.md", first);
    useEditorSave.getState().attach("a.md", second);
    useEditorSave.getState().detach("a.md", first);
    useEditorSave.getState().touch("a.md");

    expect(useEditorSave.getState().flush("a.md")).toBe("second");
  });
});
