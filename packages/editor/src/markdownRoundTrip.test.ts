// @vitest-environment jsdom
//
// Golden-file round-trip corpus for markdown serialization. Every save
// re-serializes the whole document, so any escaping bug here silently rewrites
// notes on disk (the historical defect: `[[Note]]` → `\[\[Note\]\]`,
// `5 < 7` → `5 &lt; 7`, `$\frac{a}{b}$` → `$\\frac{a}{b}$`). These tests
// instantiate the exact extension stack the app ships (buildEditorExtensions)
// and pin the serialized output byte-for-byte:
//   - "byte-equal" fixtures must round-trip unchanged — regressions here mean
//     on-disk corruption;
//   - "documented normalization" fixtures pin the exact rewritten output, so
//     any future change to a normalization is a conscious decision, not an
//     accident.

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { buildEditorExtensions } from "./NovalisEditor";

const editors: Editor[] = [];

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

function createEditor(markdown: string): Editor {
  const editor = new Editor({
    extensions: buildEditorExtensions(),
    content: markdown,
  });
  editors.push(editor);
  return editor;
}

function serialize(editor: Editor): string {
  return editor.storage.markdown.getMarkdown();
}

/** Parse markdown into the editor, serialize it back out. */
function roundTrip(markdown: string): string {
  return serialize(createEditor(markdown));
}

describe("markdown round-trip: byte-equal", () => {
  const cases: [name: string, markdown: string][] = [
    ["wikilink", "Link to [[Meeting Notes]] here."],
    // The link mark gained a `title` attr in @tiptap/extension-link v3, so the
    // title now survives a save. Before that it was silently stripped on every
    // save — an unpinned output change, which is what this corpus exists to
    // stop; pinned here so a flip back is a failure rather than a discovery.
    ["link with a title", '[docs](https://example.com "Internal wiki")'],
    ["wikilink with heading anchor", "See [[Project Plan#Goals]]."],
    ["wikilink with alias", "See [[Meeting Notes|the notes]]."],
    ["embed", "![[Diagram.png]]"],
    ["embed with section anchor", "![[Design Doc#API]]"],
    ["inline math with backslash", "The rule $\\frac{a}{b}$ applies."],
    ["inline math with underscore and asterisk", "Sum $x_i * y$ done."],
    ["inline math exponents", "Euler: $e^{i\\pi} + 1 = 0$."],
    ["single-line block math", "$$\\sum_{i=0}^{n} x_i$$"],
    ["less-than in prose", "5 < 7 and 9 > 3"],
    ["angle brackets around identifier", "#include <vector>"],
    ["lone tilde", "a ~ b"],
    ["real strikethrough", "~~gone~~"],
    ["escaped tildes stay escaped", "\\~\\~not struck\\~\\~"],
    ["tags", "#foo/bar and #x"],
    ["task line", "- [ ] thing @due(2026-01-01)"],
    ["checked task line", "- [x] done thing"],
    ["inline code with less-than", "Use `a < b` here."],
    // Code fences are exempt from all of this (verbatim path) — pin it.
    ["code fence containing wikilink and math", "```text\n[[Not A Link]] and $not math$\n```"],
    ["real autolink", "<https://example.com>"],
    ["heading and tight list", "# Title\n\n- one\n- two"],
    ["single-line callout", "> [!NOTE] Remember this"],
    ["literal star-brackets already escaped", "\\*not bold\\* and \\[brackets\\]"],
    // Block references: the `((^id))` reference and the trailing ` ^id` marker
    // are plain base36 text — they must survive every save byte-for-byte, on a
    // paragraph, heading, and list item, and alongside other constructs.
    ["block reference", "See ((^k3f9qz)) for the argument."],
    ["block id marker on a paragraph", "An important claim. ^k3f9qz"],
    ["block id marker on a heading", "# Section Title ^head01"],
    ["block id marker on a list item", "- first item ^li0001"],
    ["reference next to a wikilink", "Per ((^k3f9qz)) and [[Meeting Notes]]."],
    ["marker on a line that also has math", "The rule $e^{i\\pi}$ holds. ^math01"],
  ];

  it.each(cases)("%s", (_name, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });
});

describe("markdown round-trip: all optional features disabled", () => {
  // Serialization safety is flag-independent: MarkdownText (the round-trip-safe
  // serializer) stays registered regardless of feature flags, and the gated
  // extensions are decoration-only. Disabling every feature must therefore
  // never touch the markdown — a regression here means a feature toggle
  // silently rewrites notes on disk.
  function roundTripAllOff(markdown: string): string {
    const editor = new Editor({
      extensions: buildEditorExtensions({
        features: {
          math: false,
          mermaid: false,
          embeds: false,
          blockRefs: false,
          callouts: false,
          codeHighlight: false,
          tagAutocomplete: false,
        },
      }),
      content: markdown,
    });
    editors.push(editor);
    return serialize(editor);
  }

  const cases: [name: string, markdown: string][] = [
    ["wikilink, embed and math", "See [[Meeting Notes]] and ![[Diagram.png]] and $x_i * y$"],
    ["inline math with backslash", "The rule $\\frac{a}{b}$ applies."],
    ["single-line block math", "$$\\sum_{i=0}^{n} x_i$$"],
    ["block reference and marker", "Per ((^k3f9qz)) — a claim. ^k3f9qz"],
    ["single-line callout", "> [!NOTE] Remember this"],
    ["mermaid code fence", "```mermaid\ngraph TD; A-->B;\n```"],
    ["code fence containing wikilink and math", "```text\n[[Not A Link]] and $not math$\n```"],
    ["tags", "#foo/bar and #x"],
    ["less-than in prose", "5 < 7 and 9 > 3"],
  ];

  it.each(cases)("%s", (_name, markdown) => {
    expect(roundTripAllOff(markdown)).toBe(markdown);
  });
});

describe("markdown round-trip: documented normalizations", () => {
  const cases: [name: string, markdown: string, normalized: string][] = [
    // prosemirror-markdown escapes markdown punctuation in plain text; the
    // escape is un-done on reload, so the text is stable from the second save
    // on and renders identically everywhere.
    ["bare asterisk gains a backslash", "a * b literal", "a \\* b literal"],
    // markdown-it parses the outer `_…_` as emphasis; the emphasis mark
    // serializes with `*` delimiters (delimiter normalization, not data loss).
    ["underscore emphasis normalizes to asterisks", "_underscores_in_words_", "*underscores_in_words*"],
    // Soft line breaks inside a paragraph collapse to spaces (ProseMirror
    // whitespace handling on parse — pre-existing, independent of escaping).
    ["hard-wrapped paragraph joins lines", "line one\nline two", "line one line two"],
    // Same collapse applies inside multi-line `$$…$$` (the span survives, on
    // one line) and callout bodies.
    ["multi-line block math joins lines", "$$\nE = mc^2\n$$", "$$ E = mc^2 $$"],
    ["callout body joins the marker line", "> [!NOTE] Title\n> body text", "> [!NOTE] Title body text"],
    // linkify:true turns a bare URL into a link mark; prosemirror-markdown
    // serializes a plain link (text == href) in autolink form.
    ["bare URL becomes an autolink", "https://example.com", "<https://example.com>"],
    // markdown-it decodes entities on parse; with html:false nothing
    // re-encodes them (the decoded form round-trips stably afterwards).
    ["HTML entity is decoded", "5 &lt; 7", "5 < 7"],
    // linkify:true always re-links the URL text, so literal angle brackets
    // around a URL can't stay plain text. The document text is preserved
    // (`<https://example.com> is literal`); only the on-disk framing settles
    // into the `<<url>>` form (outer pair literal, inner pair autolink).
    [
      "escaped angle-bracket URL settles as literal-plus-autolink",
      "\\<https://example.com> is literal",
      "<<https://example.com>> is literal",
    ],
  ];

  it.each(cases)("%s", (_name, markdown, normalized) => {
    expect(roundTrip(markdown)).toBe(normalized);
    // Normalizations must be stable: a second round-trip changes nothing.
    expect(roundTrip(normalized)).toBe(normalized);
  });
});

describe("markdown serialization of typed (unparsed) text", () => {
  // Text typed in the GUI never went through markdown-it, so this is the exact
  // path that used to corrupt notes. Inserting a raw text node mimics typing.
  function typed(text: string): string {
    const editor = createEditor("");
    editor.commands.insertContentAt(1, { type: "text", text });
    return serialize(editor);
  }

  it("keeps wikilinks, embeds and math verbatim", () => {
    expect(typed("See [[Meeting Notes]] and ![[Diagram.png]] and $x_i * y$")).toBe(
      "See [[Meeting Notes]] and ![[Diagram.png]] and $x_i * y$",
    );
  });

  it("never entity-escapes angle brackets", () => {
    expect(typed("5 < 7 and #include <vector>")).toBe("5 < 7 and #include <vector>");
  });

  it("keeps lone tildes but escapes strikethrough runs", () => {
    expect(typed("a ~ b and ~~literal~~")).toBe("a ~ b and \\~\\~literal\\~\\~");
  });

  it("still escapes markdown punctuation in ordinary text", () => {
    expect(typed("*not bold* and [brackets]")).toBe("\\*not bold\\* and \\[brackets\\]");
  });

  it("guards a typed autolink-shaped run so reload keeps it literal", () => {
    expect(typed("see <https://example.com> here")).toBe("see \\<https://example.com> here");
    // Reloading the guarded form keeps the identical document text; on disk it
    // settles into the `<<url>>` framing (see the normalization corpus).
    expect(roundTrip("see \\<https://example.com> here")).toBe("see <<https://example.com>> here");
  });
});

describe("GFM tables", () => {
  // tiptap-markdown's table serializer always terminates the table with a
  // newline, so a note ENDING in a table carries a trailing "\n" (gained once,
  // then stable — the fixtures below include it).
  it("round-trips a pipe table byte-equal", () => {
    const table = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    expect(roundTrip(table)).toBe(table);
  });

  it("drops column alignment (documented normalization)", () => {
    // The cells DO carry an `align` attr (added in @tiptap/extension-table v3)
    // and it is populated on parse — but tiptap-markdown's pipe-table
    // serializer has no representation for it, so the `:---:` colons are lost
    // on the way back out. The table itself survives.
    const aligned = "| a | b |\n| :--- | ---: |\n| 1 | 2 |\n";
    const normalized = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    expect(roundTrip(aligned)).toBe(normalized);
    expect(roundTrip(normalized)).toBe(normalized);
  });

  it("keeps wikilinks and math verbatim inside cells", () => {
    const table = "| link | math |\n| --- | --- |\n| [[Note]] | $x_i$ |\n";
    expect(roundTrip(table)).toBe(table);
  });

  // A pipe table cannot hold block content or merged cells, and the stock
  // serializer answers that by discarding the WHOLE table — it writes the
  // literal text `[table]`. Every case below used to produce exactly that, and
  // autosave persisted it. See MarkdownTable.ts.
  describe("cells that markdown cannot represent degrade, never disappear", () => {
    const table = "| a | b |\n| --- | --- |\n| c | d |\n";

    /** Caret immediately after the given text. */
    function caretAfter(editor: Editor, text: string): number {
      let pos = -1;
      editor.state.doc.descendants((node, at) => {
        if (pos < 0 && node.isText && node.text === text) pos = at + 1;
        return pos < 0;
      });
      return pos;
    }

    it("does not let Enter split a cell in the first place", () => {
      const editor = createEditor(table);
      editor.commands.setTextSelection(caretAfter(editor, "c"));
      const handled = editor.view.someProp(
        "handleKeyDown",
        (fn) => fn(editor.view, new KeyboardEvent("keydown", { key: "Enter" })) === true,
      );
      expect(handled).toBe(true); // swallowed, not passed on
      expect(serialize(editor)).toBe(table);
    });

    it("flattens block content inserted into a cell, keeping every word", () => {
      const editor = createEditor(table);
      editor.commands.setTextSelection(caretAfter(editor, "c"));
      editor.chain().focus().insertContent("# Heading\n\nBody line").run();

      const out = serialize(editor);
      expect(out).toBe("| a | b |\n| --- | --- |\n| c Heading Body line | d |\n");
      expect(roundTrip(out)).toBe(out); // and the degraded form is stable
    });

    it("keeps a list pasted into a cell on one row", () => {
      // Rendering a list inline emits its own block structure; one stray
      // newline ends the row and turns the rest of the table into paragraphs.
      const editor = createEditor(table);
      editor.commands.setTextSelection(caretAfter(editor, "c"));
      editor.chain().focus().toggleBulletList().run();
      expect(serialize(editor)).toBe(table);
    });

    it("keeps escaped pipes escaped, so a cell survives repeated saves", () => {
      // This serializer writes the row separators itself, so a raw `|` in a
      // cell splits the row on the NEXT read. The corruption takes two saves
      // and looks fine in between: save one strips the backslash, save two
      // re-parses the cell as two cells and the last one falls off the end.
      // MarkdownText disables escaping inside `[[…]]`, `$…$` and `((^id))`, so
      // an aliased wikilink's pipe is guaranteed to arrive here raw.
      const cases = [
        "| construct | note |\n| --- | --- |\n| [[Meeting Notes\\|the notes]] | aliased |\n",
        "| a | b |\n| --- | --- |\n| x \\| y | c |\n",
        "| a | b |\n| --- | --- |\n| `git log \\| head` | shell |\n",
      ];
      for (const table of cases) {
        expect(roundTrip(table)).toBe(table);
        expect(roundTrip(roundTrip(table))).toBe(table); // and again — no backslash growth
      }
    });

    it("escapes a pipe typed into a cell", () => {
      const editor = createEditor("| a | b |\n| --- | --- |\n| c | d |\n");
      editor.commands.setTextSelection(caretAfter(editor, "c"));
      editor.chain().focus().insertContent(" | x").run();

      const out = serialize(editor);
      expect(out).toBe("| a | b |\n| --- | --- |\n| c \\| x | d |\n");
      expect(roundTrip(out)).toBe(out); // still two columns after a reload
    });

    it("still emits a table when cells are merged", () => {
      // Not reachable from this app's UI — but pasting a table from a web page
      // brings colspan/rowspan in, and the stock serializer discards those too.
      const cell = (type: string, text: string, attrs?: Record<string, unknown>) => ({
        type,
        ...(attrs ? { attrs } : {}),
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      });
      // Built as ProseMirror JSON: the stack parses string content as markdown
      // (`html: false`), so an HTML fixture would arrive as literal text.
      const editor = new Editor({
        extensions: buildEditorExtensions(),
        content: {
          type: "doc",
          content: [
            {
              type: "table",
              content: [
                { type: "tableRow", content: [cell("tableHeader", "a"), cell("tableHeader", "b")] },
                { type: "tableRow", content: [cell("tableCell", "wide", { colspan: 2 })] },
              ],
            },
          ],
        },
      });
      editors.push(editor);
      const out = serialize(editor);
      expect(out).not.toContain("[table]");
      expect(out).toContain("| a | b |");
      expect(out).toContain("wide");
    });
  });
});
