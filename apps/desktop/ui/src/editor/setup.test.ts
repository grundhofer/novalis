import { indentUnit, language } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";

import { buildExtensions, type EditorHooks } from "./setup";

vi.mock("../ipc/client", () => ({
  commands: {},
  unwrap: vi.fn(),
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));

async function stateFor(path: string, text: string): Promise<EditorState> {
  const hooks: EditorHooks = {
    onChange: () => undefined,
    onFollowLink: () => undefined,
    onSave: () => undefined,
    notePaths: () => [],
    noteText: async () => null,
    text,
    readOnly: false,
    plainMode: false,
    spellcheck: false,
  };
  return EditorState.create({ doc: text, extensions: await buildExtensions(path, hooks) });
}

describe("buildExtensions", () => {
  it("keys the Markdown bundle on the grammar name, so a note named Dockerfile.md is a note", async () => {
    const state = await stateFor("Dockerfile.md", "# Title\n\n- a\n  - b\n");
    // The bundle is Markdown wrapped in the YAML-frontmatter language.
    expect(state.facet(language)?.name).toBe("yaml-frontmatter");
    expect(state.facet(indentUnit)).toBe("  ");
  });

  // `make` accepts nothing but a tab: the detector may not talk it into
  // the two spaces an `ifeq` block uses.
  it("keeps the tab for a Makefile whatever its head is indented with", async () => {
    const head = "ifeq ($(V),1)\n  quiet=\n  Q=\nelse\n  quiet=quiet_\n  Q=@\nendif\n";
    const state = await stateFor("Makefile", `${head}all:\n\tcc a.c\n`);
    expect(state.facet(language)).toBeNull();
    expect(state.facet(indentUnit)).toBe("\t");
  });

  it("lets a file's own indentation overrule the preset elsewhere", async () => {
    const state = await stateFor("a.py", "def f():\n  a = 1\n  if a:\n    b()\n  c()\n");
    expect(state.facet(indentUnit)).toBe("  ");
    const plain = await stateFor("a.py", "x = 1\n");
    expect(plain.facet(indentUnit)).toBe("    ");
  });
});
