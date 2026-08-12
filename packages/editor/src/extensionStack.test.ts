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
