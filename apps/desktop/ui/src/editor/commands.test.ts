import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

// CI runs in UTC; east of UTC, 00:30 local is still the day before in UTC.
vi.stubEnv("TZ", "Europe/Berlin");

import { runEditorCommand } from "../lib/editorBridge";
import { setActiveView } from "./commands";

function view(doc: string, selection: EditorSelection): EditorView {
  const v = new EditorView({
    state: EditorState.create({
      doc,
      selection,
      extensions: [EditorState.allowMultipleSelections.of(true)],
    }),
  });
  setActiveView(v);
  return v;
}

afterEach(() => {
  setActiveView(null);
  vi.useRealTimers();
});

// ADR-0026: the ISO form in local time, at every cursor, over a selection.
describe("editor.insertDateTime", () => {
  it("inserts local YYYY-MM-DD HH:MM at every cursor and replaces a selection", () => {
    vi.setSystemTime(new Date(2026, 8, 14, 0, 5));
    const v = view(
      "a\nold\nb",
      EditorSelection.create([EditorSelection.cursor(1), EditorSelection.range(2, 5)]),
    );

    expect(runEditorCommand("editor.insertDateTime")).toBe(true);

    expect(v.state.doc.toString()).toBe("a2026-09-14 00:05\n2026-09-14 00:05\nb");
    v.destroy();
  });
});

// ADR-0029: the lines a selection covers, or the whole note for sort.
describe("editor.sortLines", () => {
  it("sorts the whole note when nothing is selected, ignoring case, numbers by value", () => {
    const v = view("b\nA\nitem 10\nitem 9\na", EditorSelection.single(0));
    expect(runEditorCommand("editor.sortLines")).toBe(true);
    expect(v.state.doc.toString()).toBe("A\na\nb\nitem 9\nitem 10");
    v.destroy();
  });

  it("sorts only the lines a selection covers, not the line it ends at the start of", () => {
    const doc = "z\nc\nb\na\ny";
    const v = view(doc, EditorSelection.single(2, doc.indexOf("a")));
    runEditorCommand("editor.sortLines");
    expect(v.state.doc.toString()).toBe("z\nb\nc\na\ny");
    v.destroy();
  });

  it("does nothing on sorted lines", () => {
    const v = view("a\nb", EditorSelection.single(0));
    expect(runEditorCommand("editor.sortLines")).toBe(false);
    v.destroy();
  });
});

// ADR-0051 #77: per line over every line the selection touches; one undo step.
describe("the line formats", () => {
  const run = (id: string, doc: string, selection: EditorSelection) => {
    const v = view(doc, selection);
    expect(runEditorCommand(id)).toBe(true);
    const text = v.state.doc.toString();
    const ranges = v.state.selection.ranges.map((r) => [r.anchor, r.head]);
    v.destroy();
    return { text, ranges };
  };
  const all = (doc: string) => EditorSelection.single(0, doc.length);

  it("sets a heading on the cursor's line and puts the cursor after it on an empty line", () => {
    expect(run("markdown.heading1", "Title\nText", EditorSelection.single(2)).text).toBe("# Title\nText");
    expect(run("markdown.heading2", "a\n\nb", EditorSelection.single(2))).toEqual({ text: "a\n## \nb", ranges: [[5, 5]] });
  });

  it("removes the heading when every line has that level, and switches another level", () => {
    expect(run("markdown.heading2", "## A\n## B", all("## A\n## B")).text).toBe("A\nB");
    expect(run("markdown.heading1", "### A", EditorSelection.single(5)).text).toBe("# A");
    expect(run("markdown.heading3", "# A\n### B", all("# A\n### B")).text).toBe("### A\n### B");
  });

  it("sets the format on mixed lines and leaves the lines that have it", () => {
    const doc = "- a\nb\n- c";
    expect(run("markdown.list", doc, all(doc)).text).toBe("- a\n- b\n- c");
  });

  it("leaves blank lines alone while the selection has text, and takes no line it ends at the start of", () => {
    const doc = "a\n\nb\nc";
    expect(run("markdown.quote", doc, EditorSelection.single(0, doc.indexOf("c"))).text).toBe("> a\n\n> b\nc");
  });

  it("keeps the indentation and the bullet, and turns a list and a task into each other", () => {
    expect(run("markdown.task", "  * a", EditorSelection.single(4)).text).toBe("  * [ ] a");
    expect(run("markdown.list", "- [x] a", EditorSelection.single(0)).text).toBe("- a");
    expect(run("markdown.task", "- [ ] a\n- [x] b", all("- [ ] a\n- [x] b")).text).toBe("a\nb");
    expect(run("markdown.list", "1. a", EditorSelection.single(0)).text).toBe("- a");
  });

  it("replaces one block mark with another: a line is a heading, an item or a quote", () => {
    expect(run("markdown.quote", "# A\n- b", all("# A\n- b")).text).toBe("> A\n> b");
    expect(run("markdown.heading1", "> a", EditorSelection.single(0)).text).toBe("# a");
    // A tag at the line's start is no heading.
    expect(run("markdown.heading1", "#tag", EditorSelection.single(0)).text).toBe("# #tag");
  });

  it("acts on the lines of every cursor", () => {
    const doc = "a\nb\nc";
    const both = EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(4)]);
    expect(run("markdown.list", doc, both).text).toBe("- a\nb\n- c");
  });

  it("is one undo step", async () => {
    const { history, undo } = await import("@codemirror/commands");
    const doc = "a\nb";
    const v = new EditorView({
      state: EditorState.create({ doc, selection: all(doc), extensions: [history()] }),
    });
    setActiveView(v);
    runEditorCommand("markdown.list");
    runEditorCommand("markdown.heading1");
    expect(v.state.doc.toString()).toBe("# a\n# b");
    undo(v);
    expect(v.state.doc.toString()).toBe("- a\n- b");
    undo(v);
    expect(v.state.doc.toString()).toBe(doc);
    v.destroy();
  });
});

// ADR-0051 #77: backticks round a selection, a fenced block round lines.
describe("markdown.code", () => {
  const run = (doc: string, selection: EditorSelection) => {
    const v = view(doc, selection);
    expect(runEditorCommand("markdown.code")).toBe(true);
    const text = v.state.doc.toString();
    const main = v.state.selection.main;
    v.destroy();
    return { text, main: [main.from, main.to] };
  };

  it("puts backticks round a selection on one line, or takes them off", () => {
    expect(run("a code b", EditorSelection.single(2, 6))).toEqual({ text: "a `code` b", main: [3, 7] });
    expect(run("a `code` b", EditorSelection.single(3, 7))).toEqual({ text: "a code b", main: [2, 6] });
  });

  it("gives a cursor a pair to type into", () => {
    expect(run("ab", EditorSelection.single(1))).toEqual({ text: "a``b", main: [2, 2] });
  });

  it("fences the whole lines of a selection over several lines, and keeps them selected", () => {
    const doc = "x\nlet a;\nlet b;\ny";
    const { text, main } = run(doc, EditorSelection.single(doc.indexOf("a;"), doc.indexOf("b;")));
    expect(text).toBe("x\n```\nlet a;\nlet b;\n```\ny");
    expect(text.slice(main[0], main[1])).toBe("a;\nlet ");
  });

  it("takes the fences off round the selected lines, or when they are its first and last line", () => {
    const doc = "```js\nlet a;\nlet b;\n```";
    const inner = EditorSelection.single(doc.indexOf("let a"), doc.indexOf("b;") + 2);
    expect(run(doc, inner).text).toBe("let a;\nlet b;");
    expect(run(doc, EditorSelection.single(0, doc.length)).text).toBe("let a;\nlet b;");
  });
});

describe("editor.joinLines", () => {
  it("joins a cursor's line with the next, dropping its indentation", () => {
    const v = view("- item\n    continued\nnext", EditorSelection.single(1));
    runEditorCommand("editor.joinLines");
    expect(v.state.doc.toString()).toBe("- item continued\nnext");
    v.destroy();
  });

  it("joins every line of a selection, one space between, none for an empty line", () => {
    const doc = "a\n\n b  \nc\nd";
    const v = view(doc, EditorSelection.single(0, doc.indexOf("c") + 1));
    runEditorCommand("editor.joinLines");
    expect(v.state.doc.toString()).toBe("a b c\nd");
    v.destroy();
  });

  it("does nothing on the last line", () => {
    const v = view("a\nb", EditorSelection.single(3));
    expect(runEditorCommand("editor.joinLines")).toBe(false);
    v.destroy();
  });
});
