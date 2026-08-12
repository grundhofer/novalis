// @vitest-environment jsdom
//
// Invariants of the shipped extension stack that no other test can see.
// markdownRoundTrip pins what the serializer WRITES; this pins what the schema
// CONTAINS and which extensions are registered — the surface a TipTap upgrade
// changes silently, because a new default extension is neither a type error nor
// a changed byte on disk.
//
// Each assertion here exists because a specific upstream default would
// otherwise land unnoticed: a second `link` extension re-enabling click
// navigation, a mark with no markdown representation entering the schema (typed
// with Mod-u, dropped on save), or a node appended to every document.

import { Editor } from "@tiptap/core";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildEditorExtensions } from "./NovalisEditor";

const editors: Editor[] = [];

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

function createEditor(markdown = ""): Editor {
  const editor = new Editor({ extensions: buildEditorExtensions(), content: markdown });
  editors.push(editor);
  return editor;
}

describe("extension registration", () => {
  it("registers no extension name twice", () => {
    // A duplicate is only a console warning upstream, and both copies stay
    // active with their own plugins — so a bundled default silently overriding
    // a deliberate local configuration produces no failure anywhere else.
    const names = createEditor().extensionManager.extensions.map((e) => e.name);
    const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
    expect(duplicates).toEqual([]);
  });

  it("registers exactly this set of extensions", () => {
    // Names, exhaustively. The per-invariant assertions below each cover one
    // known arrival; this covers the ones nobody has thought of yet, which is
    // the actual hole — an upstream extension can arrive as a child of a node
    // (not through StarterKit's options at all) and bind keys with no type
    // error, no changed byte, and no failing test.
    const names = createEditor()
      .extensionManager.extensions.map((e) => e.name)
      .sort();
    expect(names).toMatchInlineSnapshot(`
      [
        "blockRefSuggestion",
        "blockquote",
        "bold",
        "bulletList",
        "clipboardTextSerializer",
        "code",
        "codeBlock",
        "commands",
        "delete",
        "doc",
        "drop",
        "dropCursor",
        "editable",
        "focusEvents",
        "gapCursor",
        "hardBreak",
        "heading",
        "horizontalRule",
        "image",
        "italic",
        "keymap",
        "link",
        "listItem",
        "markdown",
        "markdownClipboard",
        "markdownTightLists",
        "nvBlockRef",
        "nvCallout",
        "nvEmbed",
        "nvFind",
        "nvLazyHighlight",
        "nvMath",
        "nvSuggestRewrite",
        "orderedList",
        "paragraph",
        "paste",
        "placeholder",
        "slashCommand",
        "starterKit",
        "strike",
        "tabindex",
        "table",
        "tableCell",
        "tableHeader",
        "tableRow",
        "tagSuggestion",
        "taskItem",
        "taskList",
        "text",
        "textDirection",
        "undoRedo",
        "wikiLink",
        "wikiLinkSuggestion",
      ]
    `);
  });

  it("registers the syntax-highlight plugin exactly once", () => {
    // MermaidCodeBlock extends CodeBlockLowlight without overriding
    // addProseMirrorPlugins. Under an extend() that copies the parent config,
    // an inherited `[...this.parent(), X]` resolves at both levels and runs the
    // whole-document highlight pass twice per code-block edit.
    // Count, not key name: ProseMirror auto-suffixes colliding PluginKeys per
    // process, so the name depends on how many editors ran before this one.
    const keys = createEditor()
      .state.plugins.map((p) => String((p as unknown as { key: string }).key))
      .filter((k) => k.startsWith("lowlight"));
    expect(keys).toHaveLength(1);
  });

  it("registers exactly one link extension, and it does not open on click", () => {
    // openOnClick: false is deliberate — the host routes link activation itself.
    // A second link extension carrying the upstream default (true) would install
    // its own handleClick plugin and navigate the webview anyway.
    const links = createEditor().extensionManager.extensions.filter((e) => e.name === "link");
    expect(links).toHaveLength(1);
    expect(links[0]?.options).toMatchObject({ openOnClick: false });
  });
});

describe("schema surface", () => {
  // Exhaustive, not a subset: an added node or mark must fail here. Anything
  // arriving in this list needs a markdown representation, or it is data the
  // user can type and the next save discards.
  it("contains exactly the nodes the markdown pipeline can serialize", () => {
    const nodes = Object.keys(createEditor().schema.nodes).sort();
    expect(nodes).toMatchInlineSnapshot(`
      [
        "blockquote",
        "bulletList",
        "codeBlock",
        "doc",
        "hardBreak",
        "heading",
        "horizontalRule",
        "image",
        "listItem",
        "orderedList",
        "paragraph",
        "table",
        "tableCell",
        "tableHeader",
        "tableRow",
        "taskItem",
        "taskList",
        "text",
      ]
    `);
  });

  it("contains exactly the marks the markdown pipeline can serialize", () => {
    const marks = Object.keys(createEditor().schema.marks).sort();
    expect(marks).toMatchInlineSnapshot(`
      [
        "bold",
        "code",
        "italic",
        "link",
        "strike",
      ]
    `);
  });

  it("contains exactly these node and mark attributes", () => {
    // Names alone are not enough: an upstream minor can add an ATTRIBUTE that
    // parses off the clipboard and has no markdown representation, which is the
    // same silent-discard failure as a new node. `tableCell.align` is exactly
    // that — pasting an aligned table shows the alignment, and the next save
    // drops it.
    const schema = createEditor().schema;
    const surface = [...Object.values(schema.nodes), ...Object.values(schema.marks)]
      .map((t) => [t.name, Object.keys(t.spec.attrs ?? {}).sort()] as const)
      .filter(([, a]) => a.length > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, a]) => `${name}: ${a.join(", ")}`);
    expect(surface).toMatchInlineSnapshot(`
      [
        "bulletList: tight",
        "codeBlock: language",
        "heading: level",
        "image: alt, height, src, title, width",
        "link: class, href, rel, target, title",
        "orderedList: start, tight, type",
        "tableCell: align, colspan, colwidth, rowspan",
        "tableHeader: align, colspan, colwidth, rowspan",
        "taskItem: checked",
      ]
    `);
  });
});

describe("list keyboard behaviour", () => {
  it("leaves a nested list alone on Delete at the end of a parent item", () => {
    // ListItem and TaskItem each register a private priority-101 keymap binding
    // Delete/Mod-Delete to hoist a branching nested list one level out. It sits
    // above the core keymap, is not covered by `listKeymap: false`, and turns a
    // keypress that did nothing into one that rewrites the outline — which the
    // debounced onChange then autosaves.
    for (const doc of ["- a\n  - b\n    - c\n- d", "- [ ] a\n  - [ ] b\n    - [ ] c\n- [ ] d"]) {
      const editor = createEditor(doc);
      // End of the first list item's text — where the hoist keymap fires.
      let end = 0;
      editor.state.doc.descendants((node, pos) => {
        if (!end && node.type.name === "paragraph") end = pos + node.nodeSize - 1;
        return !end;
      });
      editor.commands.setTextSelection(end);
      // Compare before/after rather than against `doc`: task lists serialize
      // loose, so the input is not its own round-trip. What matters is that the
      // keypress changes nothing.
      const before = editor.storage.markdown.getMarkdown();
      editor.view.someProp(
        "handleKeyDown",
        (fn) => fn(editor.view, new KeyboardEvent("keydown", { key: "Delete" })) === true,
      );
      expect(editor.storage.markdown.getMarkdown()).toBe(before);
    }
  });
});

describe("suggestion sessions", () => {
  // suggestDismiss.test.ts exercises the matcher wrapper as a pure function
  // against a stub, which cannot observe whether the real plugin ever calls it.
  // This drives the whole contract through the shipped stack instead: a popover
  // opens, Escape ends the SESSION (not just the popup), and a fresh trigger
  // still works. Escape-only-hides is the regression this catches — it leaves
  // the session armed, so the next Enter runs the dismissed suggestion instead
  // of inserting a newline.
  function tagEditor() {
    const editor = new Editor({
      extensions: buildEditorExtensions({
        onSearchTags: () => Promise.resolve(["tag-one", "tag-two"]),
      }),
      content: "",
    });
    editors.push(editor);
    return editor;
  }

  const popup = () => document.querySelector(".nv-suggest");

  // jsdom has no layout, so Range.getClientRects is missing entirely — and
  // ProseMirror calls it to answer "is the cursor at the end of a text block?"
  // for the arrow keys. An empty rect list is enough: the answer only has to be
  // consistent, and nothing here asserts on geometry.
  beforeAll(() => {
    if (!Range.prototype.getClientRects) {
      Range.prototype.getClientRects = () =>
        Object.assign([] as unknown as DOMRectList, { item: () => null });
      Range.prototype.getBoundingClientRect = () => new DOMRect();
    }
  });

  /** Feed a key through ProseMirror's own handleKeyDown chain, the way the
   *  browser would — so the suggestion plugin decides whether it handled it. */
  function press(editor: Editor, key: string): boolean {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    return (
      editor.view.someProp("handleKeyDown", (fn) => fn(editor.view, event) === true) === true
    );
  }

  /** The items() fetch is a promise; let it settle so the popup has content. */
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("opens on #, and Escape ends the session rather than hiding the popup", async () => {
    const editor = tagEditor();
    editor.commands.insertContent("#t");
    await settle();

    expect(popup()).not.toBeNull();
    expect(press(editor, "ArrowDown")).toBe(true); // the session owns the keys

    expect(press(editor, "Escape")).toBe(true);
    await settle();

    expect(popup()).toBeNull();
    // The session is genuinely gone: navigation keys fall through to the editor.
    expect(press(editor, "ArrowDown")).toBe(false);
  });

  it("still keeps the session closed while the dismissed token is typed on", async () => {
    const editor = tagEditor();
    editor.commands.insertContent("#t");
    await settle();
    press(editor, "Escape");
    await settle();

    editor.commands.insertContent("a"); // same token, now "#ta"
    await settle();

    expect(popup()).toBeNull();
  });

  it("keeps the highlighted row across a keystroke, so Enter takes the right one", async () => {
    // The suggestion view fires an interim update with an empty list before it
    // awaits items(), then a second one with the results. Rebuilding state from
    // the empty list resets the highlight to row 0 — so arrowing to a row and
    // typing one more character silently inserts a DIFFERENT tag than the one
    // under the cursor. Nothing throws; the note just gets the wrong text.
    const editor = new Editor({
      extensions: buildEditorExtensions({
        onSearchTags: () => Promise.resolve(["alpha", "apricot", "avocado"]),
      }),
      content: "",
    });
    editors.push(editor);

    editor.commands.insertContent("#a");
    await settle();
    press(editor, "ArrowDown");
    press(editor, "ArrowDown"); // highlight "avocado"

    editor.commands.insertContent("v"); // narrows; interim empty update fires here
    await settle();

    press(editor, "Enter");
    expect(editor.storage.markdown.getMarkdown()).toBe("#avocado");
  });

  it("swallows Enter while results are still in flight", async () => {
    // Until the host's search resolves there are no items, so Enter used to
    // fall through to ProseMirror and split the paragraph in two, leaving the
    // half-typed token as literal text. Tab was worse — nothing binds it in a
    // paragraph, so focus left the editor entirely.
    let release: (v: string[]) => void = () => {};
    const editor = new Editor({
      extensions: buildEditorExtensions({
        onSearchTags: () => new Promise<string[]>((r) => (release = r)),
      }),
      content: "",
    });
    editors.push(editor);

    editor.commands.insertContent("#pro");
    await settle(); // popover open, items still pending

    expect(press(editor, "Enter")).toBe(true);
    expect(editor.state.doc.content.childCount).toBe(1); // not split

    release(["project"]);
    await settle();
    press(editor, "Enter");
    expect(editor.storage.markdown.getMarkdown()).toBe("#project");
  });

  it("opens again for a new token after a dismissal", async () => {
    const editor = tagEditor();
    editor.commands.insertContent("#t");
    await settle();
    press(editor, "Escape");
    await settle();

    editor.commands.insertContent(" #o"); // a different token
    await settle();

    expect(popup()).not.toBeNull();
  });
});

describe("document shape", () => {
  it("does not append a node to a document that ends in a code block", () => {
    // An extension that keeps a trailing paragraph available changes the doc on
    // the first transaction. The markdown is unaffected (an empty paragraph
    // serializes to nothing), so only the node list shows it.
    const editor = createEditor("```js\nconst x = 1;\n```");
    const before = editor.state.doc.content.childCount;
    editor.commands.setTextSelection(1);
    editor.commands.insertContent("x");

    expect(editor.state.doc.content.childCount).toBe(before);
    expect(editor.state.doc.lastChild?.type.name).toBe("codeBlock");
  });
});
