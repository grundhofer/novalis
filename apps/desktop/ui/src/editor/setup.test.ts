import { indentUnit, language, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getStyleTags, tags as t } from "@lezer/highlight";
import { describe, expect, it, vi } from "vitest";

import { buildExtensions, type EditorHooks } from "./setup";

vi.mock("../ipc/client", () => ({
  commands: {},
  unwrap: vi.fn(),
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));

async function stateFor(path: string, text: string, spellcheck = false): Promise<EditorState> {
  const hooks: EditorHooks = {
    onChange: () => undefined,
    onFollowLink: () => undefined,
    onSave: () => undefined,
    notePaths: () => [],
    noteText: async () => null,
    text,
    readOnly: false,
    plainMode: false,
    spellcheck,
  };
  return EditorState.create({ doc: text, extensions: await buildExtensions(path, hooks) });
}

/** The static editor/content attributes a state asks for, merged. */
function attrs(state: EditorState, facet: typeof EditorView.editorAttributes): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const source of state.facet(facet)) {
    if (typeof source === "function") continue;
    for (const [name, value] of Object.entries(source)) merged[name] = `${merged[name] ?? ""} ${value}`.trim();
  }
  return merged;
}

describe("buildExtensions", () => {
  it("keys the Markdown bundle on the grammar name, so a note named Dockerfile.md is a note", async () => {
    const state = await stateFor("Dockerfile.md", "# Title\n\n- a\n  - b\n");
    // The bundle is Markdown wrapped in the YAML-frontmatter language.
    expect(state.facet(language)?.name).toBe("yaml-frontmatter");
    expect(state.facet(indentUnit)).toBe("  ");
    // A Markdown dialect is a file with the same bundle (ADR-0022, amended 2026-09-21).
    const dialect = await stateFor("post.mdx", "# Title\n");
    expect(state.facet(language)?.name).toBe(dialect.facet(language)?.name);
    expect(attrs(dialect, EditorView.editorAttributes).class).toBeUndefined();
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

  // The code dress (ADR-0022): every preset but prose is mono, full width,
  // with indentation guides on the file's own unit, and never spellchecked.
  it("dresses code in mono with guides on its indent unit, and prose not", async () => {
    const rust = await stateFor("a.rs", "fn main() {\n    x();\n}\n", true);
    expect(attrs(rust, EditorView.editorAttributes).class).toBe("nv-mono");
    expect(attrs(rust, EditorView.editorAttributes).style).toContain("--nv-indent: calc(4 * ");
    expect(attrs(rust, EditorView.contentAttributes).spellcheck).toBe("false");

    const make = await stateFor("Makefile", "all:\n\tcc a.c\n", true);
    expect(attrs(make, EditorView.editorAttributes).style).toContain("--nv-indent: calc(4 * ");
    const json = await stateFor("a.json", "{}\n", true);
    expect(attrs(json, EditorView.editorAttributes).style).toContain("--nv-indent: calc(2 * ");

    const note = await stateFor("a.md", "# Title\n", true);
    expect(attrs(note, EditorView.editorAttributes).class).toBeUndefined();
    expect(attrs(note, EditorView.editorAttributes).style).toBeUndefined();
    expect(attrs(note, EditorView.contentAttributes).spellcheck).toBe("true");
    const off = await stateFor("a.md", "# Title\n", false);
    expect(attrs(off, EditorView.contentAttributes).spellcheck).toBe("false");
  });

  // Upstream marks the frontmatter's `---` as `meta`, which the code rules
  // colour as a keyword; here it is a marker like every other.
  it("keeps the frontmatter's dashes a marker", async () => {
    const state = await stateFor("a.md", "---\ntitle: x\n---\n\n# Title\n");
    const dashes: string[] = [];
    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.name === "DashLine") dashes.push(String(getStyleTags(node)?.tags[0]));
      },
    });
    expect(dashes).toEqual([String(t.processingInstruction), String(t.processingInstruction)]);
  });
});
