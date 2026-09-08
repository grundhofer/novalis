import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorSave } from "./editorSave";

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
  NovalisError: class extends Error {},
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
