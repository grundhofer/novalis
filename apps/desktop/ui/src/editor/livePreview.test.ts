import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { startI18n } from "../i18n";
import { unwrap } from "../ipc/client";
import { liveTargetAt, livePreview } from "./livePreview";
import { buildExtensions, type EditorHooks } from "./setup";

vi.mock("../ipc/client", () => ({
  commands: { renderMarkdown: vi.fn(), readBlob: vi.fn() },
  unwrap: vi.fn(),
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));

// jsdom's `Range` has no layout (ADR-0011); a real view measures.
beforeAll(() => {
  startI18n();
  const empty = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getClientRects ??= empty;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  vi.mocked(unwrap).mockReset();
});

/** A note's editor with the live preview, the cursor at `cursor` (the end by default). */
async function live(text: string, cursor = text.length, onFollowLink = vi.fn()) {
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
    spellcheck: false,
    invisibles: false,
  };
  const state = EditorState.create({
    doc: text,
    selection: { anchor: cursor },
    extensions: [...(await buildExtensions("n.md", hooks)), livePreview("n.md", onFollowLink)],
  });
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({ state, parent });
  views.push(view);
  // The tree a state shows is what its first 20 ms of parsing reached; on a
  // slow runner that is only the first lines (CI, 2026-11-18).
  // `ensureSyntaxTree` parses the rest, and a transaction hands it over.
  ensureSyntaxTree(view.state, view.state.doc.length, 5000);
  view.dispatch({});
  return view;
}

/** What each line shows, widgets as their text. */
const lines = (view: EditorView) => [...view.contentDOM.querySelectorAll(".cm-line")].map((line) => line.textContent);

describe("livePreview", () => {
  it("hides the markers of every element the cursor is not on", async () => {
    const text = "# Title\n\nSome **bold**, _it_, `code` and ~~gone~~.\n\n[words](https://example.org) and [[Plan|the plan]] and [[Atlas]]\n\n> quoted\n\n- item\n- [ ] task\n\n---\n\nend";
    const view = await live(text);
    expect(lines(view)).toEqual([
      "Title",
      "",
      "Some bold, it, code and gone.",
      "",
      "words and the plan and Atlas",
      "",
      "quoted",
      "",
      "• item",
      // The box (a widget, no text) and the space after it.
      " task",
      "",
      "",
      "",
      "end",
    ]);
    expect(view.contentDOM.querySelector(".nv-live-rule")).not.toBeNull();
    expect(view.contentDOM.querySelectorAll(".nv-checkbox")).toHaveLength(1);
    // The text is the source, byte for byte: only its looks changed.
    expect(view.state.doc.toString()).toBe(text);
  });

  it("brings the source back where the cursor is", async () => {
    const text = "# Title\n\nSome **bold** and _it_\n\n- item";
    const inBold = text.indexOf("bold") + 1;
    const view = await live(text, inBold);
    // The bold shows its marks, its neighbour on the line keeps them hidden;
    // the heading and the list are on other lines.
    expect(lines(view)).toEqual(["Title", "", "Some **bold** and it", "", "• item"]);
    view.dispatch({ selection: { anchor: 2 } });
    expect(lines(view)[0]).toBe("# Title");
    view.dispatch({ selection: { anchor: text.length } });
    expect(lines(view)).toEqual(["Title", "", "Some bold and it", "", "- item"]);
  });

  it("draws a table through the renderer and names it after the heading before it", async () => {
    vi.mocked(unwrap).mockResolvedValue("<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>12</td></tr></tbody></table>" as never);
    const text = "## Numbers\n\n| a |\n|---|\n| 12 |\n\nafter";
    const view = await live(text);
    await vi.waitFor(() => expect(view.contentDOM.querySelector(".nv-live-table table.sb-table")).not.toBeNull());
    const region = view.contentDOM.querySelector(".nv-live-table .sb-table-wrap");
    expect(region?.getAttribute("role")).toBe("region");
    expect(region?.getAttribute("aria-label")).toBe("Table under “Numbers”");
    expect(view.contentDOM.querySelector("td")?.classList.contains("sb-num")).toBe(true);
    // The renderer sees the table's source alone.
    expect(view.contentDOM.textContent).not.toContain("|---|");

    // A cursor in it shows the source again.
    view.dispatch({ selection: { anchor: text.indexOf("| 12") + 2 } });
    expect(view.contentDOM.querySelector(".nv-live-table")).toBeNull();
    expect(lines(view)).toContain("| 12 |");
  });

  it("puts the cursor into a drawn block that is pressed", async () => {
    vi.mocked(unwrap).mockResolvedValue("<table><tr><td>x</td></tr></table>" as never);
    const text = "| a |\n|---|\n| x |\n\nafter";
    const view = await live(text);
    const block = view.contentDOM.querySelector<HTMLElement>(".nv-live-table");
    expect(block).not.toBeNull();
    block?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    expect(view.state.selection.main.head).toBe(0);
    expect(view.contentDOM.querySelector(".nv-live-table")).toBeNull();
  });

  it("leaves an image from the web unfetched, its alt text in its place", async () => {
    const view = await live("![a cat](https://example.org/cat.png)\n\nend");
    const img = view.contentDOM.querySelector<HTMLImageElement>("img.nv-live-image");
    expect(img?.alt).toBe("a cat");
    expect(img?.getAttribute("src")).toBeNull();
    expect(unwrap).not.toHaveBeenCalled();
  });
});

describe("liveTargetAt", () => {
  const state = (text: string, cursor: number) => {
    const s = EditorState.create({ doc: text, selection: { anchor: cursor }, extensions: livePreviewLanguage });
    // As in `live`: the whole tree, handed over by a transaction.
    ensureSyntaxTree(s, s.doc.length, 5000);
    return s.update({}).state;
  };
  let livePreviewLanguage: Awaited<ReturnType<typeof buildExtensions>>;
  beforeAll(async () => {
    livePreviewLanguage = await buildExtensions("n.md", {
      onChange: () => undefined,
      onFollowLink: () => undefined,
      onFollowTag: () => undefined,
      onSave: () => undefined,
      notePaths: () => [],
      noteText: async () => null,
      text: "",
      readOnly: false,
      plainMode: false,
      spellcheck: false,
      invisibles: false,
    });
  });

  it("follows a link that shows only its words, and not one being edited", () => {
    const text = "see [words](notes/a.md) and [[Plan|the plan]]\n\nend";
    const words = text.indexOf("words") + 2;
    const plan = text.indexOf("the plan") + 2;
    expect(liveTargetAt(state(text, text.length), words, null)).toBe("notes/a.md");
    expect(liveTargetAt(state(text, text.length), plan, null)).toBe("[[Plan|the plan]]");
    expect(liveTargetAt(state(text, words), words, null)).toBeNull();
    expect(liveTargetAt(state(text, text.length), 1, null)).toBeNull();
  });
});
