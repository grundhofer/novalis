import { highlightingFor, indentUnit, language, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { getStyleTags, tags as t } from "@lezer/highlight";
import { describe, expect, it, vi } from "vitest";

import { fenceLanguage } from "./fences";
import { codeTag, noteTag } from "./markdownExt";
import { buildExtensions, type EditorHooks } from "./setup";
import { codeHighlight, markdownHighlight } from "./theme";

vi.mock("../ipc/client", () => ({
  commands: {},
  unwrap: vi.fn(),
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));

async function stateFor(
  path: string,
  text: string,
  spellcheck = false,
  invisibles = false,
): Promise<EditorState> {
  const hooks: EditorHooks = {
    onChange: () => undefined,
    onFollowLink: () => undefined,
    onFollowTag: () => undefined,
    onSave: () => undefined,
    notePaths: () => [],
    noteText: async () => null,
    text,
    readOnly: false,
    plainMode: false,
    spellcheck,
    invisibles,
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

  // A fence names its grammar exactly, through the function the preview
  // uses (./fences): ```py is Python and ```text is not LaTeX. The grammar is
  // loaded first, since nothing re-parses a state that has no view.
  it("resolves a fence's grammar the way the preview does", async () => {
    await fenceLanguage("py")?.load();
    const text = "```py\nx = 1\n```\n\n```text\n\\x\n```\n";
    const state = await stateFor("a.md", text);
    const chain = (pos: number) => {
      const names: string[] = [];
      const tree = syntaxTree(state);
      let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, 1);
      for (; node; node = node.parent) names.push(node.name);
      return names;
    };
    expect(chain(text.indexOf("x = 1"))).toContain("Script");
    expect(chain(text.indexOf("\\x"))).toEqual(["CodeText", "FencedCode", "Document", "Document"]);
  });

  // A code block's face is the line's, so a fence with a grammar — whose
  // parse hides the outer node from the highlighter — reads in mono like a
  // plain one; the node keeps its colour on a tag of its own, and inline
  // code keeps `monospace`.
  // ADR-0029: drawn only while the toggle is on, and never trimmed.
  it("marks spaces, tabs and trailing whitespace only while invisibles are on", async () => {
    const text = "a b\n\tc  \n";
    const marks = async (invisibles: boolean) => {
      const view = new EditorView({
        state: await stateFor("a.txt", text, false, invisibles),
        parent: document.body,
      });
      const found = ["cm-highlightSpace", "cm-highlightTab", "cm-trailingSpace"].map(
        (name) => view.dom.querySelectorAll(`.${name}`).length > 0,
      );
      expect(view.state.doc.toString()).toBe(text);
      view.destroy();
      return found;
    };
    expect(await marks(true)).toEqual([true, true, true]);
    expect(await marks(false)).toEqual([false, false, false]);
  });

  it("puts the code face on a block's lines, with or without a grammar", async () => {
    await fenceLanguage("py")?.load();
    const text = "`a`\n\n```py\nx = 1\n```\n\n```text\n\\x\n```\n";
    const state = await stateFor("a.md", text);
    const view = new EditorView({ state, parent: document.body });
    const lines = [...view.dom.querySelectorAll(".cm-line")].map((line) => [
      line.textContent,
      line.classList.contains("nv-code"),
    ]);
    view.destroy();
    expect(lines).toEqual([
      ["`a`", false],
      ["", false],
      ["```py", false],
      ["x = 1", true],
      ["```", false],
      ["", false],
      ["```text", false],
      ["\\x", true],
      ["```", false],
      ["", false],
    ]);
    const tagsOf = (name: string) => {
      let found: string[] | undefined;
      syntaxTree(state).iterate({
        enter: (node) => {
          if (found === undefined && node.name === name) found = getStyleTags(node)?.tags.map(String);
        },
      });
      return found;
    };
    expect(tagsOf("InlineCode")).toEqual([String(t.monospace)]);
    expect(tagsOf("CodeText")).toEqual([String(codeTag)]);
  });

  // Upstream marks the frontmatter's `---` as `meta`, which the code rules
  // colour as a keyword; here it is a marker like every other.
  // spec/01 §1.8.1, TEC-08: a code file gets the code looks alone; the
  // Markdown source's rules (muted markers, bold headings, the sunken fill)
  // are a note's. `<?php` is a processing instruction, which lezer derives
  // from `meta`: in code it takes sebaroHighlight's keyword look, not the
  // markers' grey.
  it("highlights a code file with the code rules only", async () => {
    const php = await stateFor("a.php", "<?php echo 1; ?>\n");
    for (const tag of [t.heading, t.strong, t.emphasis, t.monospace, t.quote, t.link]) {
      expect(highlightingFor(php, [tag]), tag.toString()).toBeNull();
    }
    expect(highlightingFor(php, [t.keyword])).toBe(codeHighlight.style([t.keyword]));
    expect(highlightingFor(php, [t.processingInstruction])).toBe(codeHighlight.style([t.keyword]));
    const note = await stateFor("a.md", "# Title\n");
    expect(highlightingFor(note, [t.heading])).toBe(markdownHighlight.style([t.heading]));
    expect(highlightingFor(note, [t.processingInstruction])).not.toBeNull();
  });

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

  // ADR-0037: a `#tag` is found where a ⌘-click lands, and a link is not a tag.
  it("finds the tag under a position", async () => {
    const { tagAt } = await import("./decorations");
    const state = await stateFor("a.md", "see #atlas and [x](#anchor)\n");
    expect(tagAt(state, 6)).toBe("atlas");
    expect(tagAt(state, 4)).toBe("atlas");
    expect(tagAt(state, 20)).toBeNull();
  });

  // ADR-0051 #18: the tag in the link style, its `#` a marker of its own.
  it("gives a tag's `#` the marker's tag and its word the tag's", async () => {
    const state = await stateFor("a.md", "see #atlas\n");
    const found: [string, number, number, string][] = [];
    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.name === "TagRef" || node.name === "TagMark") {
          found.push([node.name, node.from, node.to, String(getStyleTags(node)?.tags[0])]);
        }
      },
    });
    expect(found).toEqual([
      ["TagRef", 4, 10, String(noteTag)],
      ["TagMark", 4, 5, String(t.processingInstruction)],
    ]);
  });

  // ADR-0051 #27.19: the find bar and Go to Line are novalis's panels, also
  // on the search keymap's own ⌥⌘G.
  it("opens the sebaro find bar and Go to Line panels", async () => {
    const { openSearchPanel } = await import("@codemirror/search");
    const view = new EditorView({ state: await stateFor("a.md", "one\ntwo\n"), parent: document.body });
    openSearchPanel(view);
    expect(view.dom.querySelector(".cm-panels-top .sb-find-bar .sb-search")).not.toBeNull();

    const mac = /Mac/.test(navigator.platform);
    const init = { key: "g", code: "KeyG", keyCode: 71, altKey: true, metaKey: mac, ctrlKey: !mac };
    expect(runScopeHandlers(view, new KeyboardEvent("keydown", init), "editor")).toBe(true);
    // Under the tabs, over the text, as the find row (spec/02 §4.25.2).
    expect(view.dom.querySelector(".cm-panels-top form.sb-find-bar [data-sb-find-row=line]")).not.toBeNull();
    expect(view.dom.querySelector(".cm-goto-line, .cm-dialog")).toBeNull();
    view.destroy();
  });

  // ADR-0051: ⌘K is the palette, and Insert Link moved to ⇧⌘K, which
  // CodeMirror's default keymap spends on Delete Line.
  it("inserts a link on Shift-Mod-k instead of deleting the line", async () => {
    const state = await stateFor("a.md", "one\ntwo\n");
    const view = new EditorView({ state, parent: document.body });
    view.dispatch({ selection: { anchor: 0, head: 3 } });
    // `Mod` is ⌘ on a Mac and Ctrl in jsdom; CodeMirror names a shifted
    // letter by its `keyCode`.
    const mac = /Mac/.test(navigator.platform);
    const init = { key: "K", code: "KeyK", keyCode: 75, shiftKey: true, metaKey: mac, ctrlKey: !mac };
    const event = new KeyboardEvent("keydown", init);

    expect(runScopeHandlers(view, event, "editor")).toBe(true);
    expect(view.state.doc.toString()).toBe("[one]()\ntwo\n");
    view.destroy();
  });
});
