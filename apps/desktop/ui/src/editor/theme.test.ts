import { autocompletion } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, syntaxHighlighting, type TagStyle } from "@codemirror/language";
import { highlightSelectionMatches, search } from "@codemirror/search";
import { EditorState, type Extension, Prec } from "@codemirror/state";
import { drawSelection, EditorView } from "@codemirror/view";
import { type Tag, tags as t } from "@lezer/highlight";
import { afterEach, describe, expect, it } from "vitest";

import {
  sebaroCodeFileTheme,
  sebaroHighlight,
  sebaroMarkdownHeadingWeights,
  sebaroMarkdownHighlight,
  sebaroMarkdownMarkers,
  sebaroSelectionMark,
} from "../sebaro/editor/sebaro-codemirror";
import exportedEditor from "../sebaro/editor/sebaro-codemirror.ts?raw";
import { codeTag, noteTag, WikiLink } from "./markdownExt";
import {
  CODE_RULES,
  codeHighlight,
  EDITOR_LOOKS,
  editorTheme,
  markdownHighlight,
  SHARED_MARKDOWN_RULES,
} from "./theme";

const style = (tag: Parameters<typeof markdownHighlight.style>[0][number]) =>
  markdownHighlight.style([tag]);

const rules = () => markdownHighlight.module?.getRules() ?? "";

describe("markdownHighlight", () => {
  it("draws the note's own tag in the link style and leaves every grammar's label alone", () => {
    expect(style(noteTag)).not.toBeNull();
    expect(rules()).toContain(
      `.${style(noteTag)} {text-decoration: underline var(--sb-color-link) var(--sb-x-sebaro-link-underline-width); text-underline-offset: 0.2em;}`,
    );
    // A CSS `#id`, a YAML anchor, a Rust loop label, a fence's info string.
    expect(style(t.labelName)).toBeNull();
  });

  // sebaro's five looks (spec/01 §1.8, spec/09 §17 `sebaroHighlight`):
  // three tones, comments grey, the rest plain; no weight in code.
  it("gives code sebaro's looks and nothing else", () => {
    const look = (tag: Parameters<typeof style>[0]) => {
      const name = style(tag);
      return name ? new RegExp(`\\.${name} \\{([^}]*)\\}`).exec(rules())?.[1] : null;
    };
    for (const tag of [t.keyword, t.controlKeyword, t.modifier, t.self, t.meta, t.annotation, t.macroName, t.tagName]) {
      expect(look(tag), tag.toString()).toBe("color: var(--sb-syntax-keyword);");
    }
    for (const tag of [t.string, t.regexp, t.character, t.attributeValue, t.docString]) {
      expect(look(tag), tag.toString()).toBe("color: var(--sb-syntax-string);");
    }
    for (const tag of [t.number, t.integer, t.bool, t.null, t.atom, t.escape, t.constant(t.variableName)]) {
      expect(look(tag), tag.toString()).toBe("color: var(--sb-syntax-constant);");
    }
    for (const tag of [t.comment, t.lineComment, t.blockComment, t.docComment]) {
      expect(look(tag), tag.toString()).toBe("color: var(--sb-color-text-muted);");
    }
    expect(look(t.invalid)).toBe("text-decoration: underline wavy var(--sb-color-danger) 2px;");
    // Plain: functions, types, properties, operators, punctuation, diffs.
    for (const tag of [
      t.function(t.variableName),
      t.typeName,
      t.className,
      t.propertyName,
      t.operator,
      t.punctuation,
      t.namespace,
      t.inserted,
      t.deleted,
      t.changed,
      t.variableName,
    ]) {
      expect(style(tag), tag.toString()).toBeNull();
    }
    expect(rules()).not.toContain("font-weight: var(--sb-type-body-strong-weight); color");
    expect(rules()).not.toContain("--sb-color-info");
  });

  it("puts a code block's text plain on its own tag, and inline code in Mono on surface-sunken", () => {
    expect(style(codeTag)).not.toBeNull();
    expect(rules()).toContain(`.${style(codeTag)} {color: var(--sb-color-text);}`);
    // spec/09 §17 (NV-I14): the class only; its look is sebaro's theme's, so
    // a selection can take its ground.
    expect(style(t.monospace)).toBe("sb-cm-code");
    const view = new EditorView({ state: EditorState.create({ extensions: [editorTheme] }), parent: document.body });
    const code = document.createElement("span");
    code.className = "sb-cm-code";
    view.dom.append(code);
    expect(getComputedStyle(code).fontFamily).toBe("var(--sb-font-family-mono)");
    expect(getComputedStyle(code).backgroundColor).toBe("var(--sb-color-surface-sunken)");
    view.destroy();
  });

  // ADR-0051 #59: the code looks are the export's `sebaroHighlight`, read
  // from its specs, not a copy: a code file takes it as it is, a note the
  // same rules after the Markdown source's.
  it("takes the code looks from the export's sebaroHighlight", () => {
    expect(codeHighlight).toBe(sebaroHighlight);
    expect(CODE_RULES.map(({ tag }) => tag)).toEqual(sebaroHighlight.specs.map(({ tag }) => tag));
    expect(markdownHighlight.specs.slice(-sebaroHighlight.specs.length)).toEqual([...sebaroHighlight.specs]);
  });

  // ADR-0051 #63: what novalis shares with the export's
  // `sebaroMarkdownHighlight` is its rules, not a copy; its heading rules
  // stay out, since the heading's size is the line's (#27.4).
  it("takes the shared Markdown rules from sebaroMarkdownHighlight and its headings not at all", () => {
    const headings = [t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6];
    const tagsOf = (spec: TagStyle) => (Array.isArray(spec.tag) ? [...spec.tag] : [spec.tag]) as Tag[];
    const shared = sebaroMarkdownHighlight.specs.filter((spec) => !tagsOf(spec).some((tag) => headings.includes(tag)));
    expect(sebaroMarkdownHighlight.specs.length - shared.length).toBeGreaterThan(0);
    expect(SHARED_MARKDOWN_RULES).toEqual(shared);
    // Each shared rule is the export's own object, used once.
    for (const spec of shared) {
      expect(markdownHighlight.specs.filter((own) => own === spec), tagsOf(spec).join(" ")).toHaveLength(1);
    }
    // No tag has two rules, so nothing is set twice; no rule sizes text,
    // and only sebaro's heading rules space letters.
    const counts = new Map<Tag, number>();
    for (const spec of markdownHighlight.specs) {
      for (const tag of tagsOf(spec)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    for (const [tag, count] of counts) expect(count, tag.toString()).toBe(1);
    const headingRules: readonly TagStyle[] = sebaroMarkdownHeadingWeights;
    for (const spec of markdownHighlight.specs) {
      expect(Object.keys(spec), tagsOf(spec).join(" ")).not.toContain("fontSize");
      if (!headingRules.includes(spec)) {
        expect(Object.keys(spec), tagsOf(spec).join(" ")).not.toContain("letterSpacing");
      }
    }
    expect(rules()).not.toContain("font-size");
    expect(rules()).not.toContain("1.75em");
  });

  // ADR-0051 #63, sebaro-luecken Z5: the headings' weight and tracking are
  // the export's `sebaroMarkdownHeadingWeights` themselves; the size stays
  // at the line (#27.4), and so does the colour, which sebaro's rules leave
  // to the text.
  it("takes the headings' weight and tracking from sebaroMarkdownHeadingWeights, the size from the line", () => {
    const headings = [t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6];
    const tagsOf = (spec: TagStyle) => (Array.isArray(spec.tag) ? [...spec.tag] : [spec.tag]) as Tag[];
    expect(sebaroMarkdownHeadingWeights.flatMap((spec) => tagsOf(spec))).toEqual(headings);
    for (const spec of sebaroMarkdownHeadingWeights) {
      expect(markdownHighlight.specs.filter((own) => own === spec), tagsOf(spec).join(" ")).toHaveLength(1);
      expect(Object.keys(spec)).not.toContain("fontSize");
    }
    // A heading tag has sebaro's rule and no other.
    const own = markdownHighlight.specs.filter(
      (spec) => !(sebaroMarkdownHeadingWeights as readonly TagStyle[]).includes(spec),
    );
    for (const spec of own) {
      for (const tag of tagsOf(spec)) expect(headings, tag.toString()).not.toContain(tag);
    }
    for (const [tag, looks] of [
      [t.heading1, "font-weight: var(--sb-type-headline-weight); letter-spacing: var(--sb-type-headline-tracking);"],
      [t.heading2, "font-weight: var(--sb-type-title-weight); letter-spacing: var(--sb-type-title-tracking);"],
      [t.heading3, "font-weight: var(--sb-type-body-strong-weight); letter-spacing: var(--sb-type-body-strong-tracking);"],
    ] as const) {
      expect(rules()).toContain(`.${style(tag)} {${looks}}`);
    }
    expect(style(t.heading6)).toBe(style(t.heading3));
    // The line sizes and colours the heading; weight and tracking are not its.
    for (const level of [1, 2, 3]) {
      const line = EDITOR_LOOKS[`.cm-line.nv-heading-${level}`]!;
      expect(line.color, String(level)).toBe("var(--sb-color-text)");
      expect(Object.keys(line), String(level)).not.toContain("letterSpacing");
      expect(Object.keys(line), String(level)).not.toContain("fontWeight");
    }
    expect(EDITOR_LOOKS[".cm-line.nv-heading-1"]!.fontSize).toBe("1.75em");
    expect(EDITOR_LOOKS[".cm-line.nv-heading-2"]!.fontSize).toBe("1.25em");
    expect(EDITOR_LOOKS[".cm-line.nv-heading-3"]!.fontSize).toBeUndefined();
  });

  it("dims markers after the rules whose marks carry them, so `#`, `[` and `-` stay grey", () => {
    const css = rules();
    const marker = style(t.processingInstruction)!;
    // `processingInstruction` is a `meta`; the marker rule still wins.
    expect(marker).not.toBe(style(t.meta));
    for (const tag of [t.heading1, t.heading2, t.link, t.list]) {
      expect(css.indexOf(`.${marker} `), tag.toString()).toBeGreaterThan(css.indexOf(`.${style(tag)} `));
    }
    expect(css).toContain(`.${marker} {color: var(--sb-color-text-muted); text-decoration: none;}`);
  });

  // LNK-01: the word is underlined, not its markup.
  it("underlines a link's label and URL but not its brackets", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "[a](b) [[c]]",
        extensions: [editorTheme, markdown({ extensions: [WikiLink] }), syntaxHighlighting(markdownHighlight)],
      }),
      parent: document.body,
    });
    const line = view.contentDOM.querySelector(".cm-line")!;
    const decorationOf = (text: string) =>
      [...line.querySelectorAll("span")]
        .filter((node) => node.textContent === text)
        .map((node) => getComputedStyle(node).textDecoration);
    for (const mark of ["[", "]", "(", ")", "[[", "]]"]) {
      expect(decorationOf(mark), mark).not.toEqual([]);
      for (const decoration of decorationOf(mark)) expect(decoration, mark).toBe("none");
    }
    for (const word of ["a", "b", "c"]) {
      expect(decorationOf(word), word).toEqual([
        "underline var(--sb-color-link) var(--sb-x-sebaro-link-underline-width)",
      ]);
    }
    view.destroy();
  });
});

// spec/01 §1.8.1, spec/09 §17 `sebaroMarkdownMarkers` (NV-I4): escapes,
// entities and link titles are markup, grey like the other markers.
describe("sebaroMarkdownMarkers", () => {
  it("dims an escape, an entity and a link title, not a constant's or a string's look", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: '\\* &amp; [a](b "Titel")',
        extensions: [markdown({ extensions: [WikiLink, sebaroMarkdownMarkers] }), syntaxHighlighting(markdownHighlight)],
      }),
      parent: document.body,
    });
    const marker = style(t.processingInstruction)!;
    const classOf = (text: string) =>
      [...view.contentDOM.querySelectorAll(".cm-line span")].find((node) => node.textContent === text)?.className;
    for (const text of ["\\*", "&amp;", '"Titel"']) {
      const classes = classOf(text)?.split(" ") ?? [];
      expect(classes, text).toContain(marker);
      expect(classes, text).not.toContain(style(t.string));
      expect(classes, text).not.toContain(style(t.escape));
    }
    view.destroy();
  });
});

// DSK-03, FAR-02: around the text only the selection and the current line
// have a ground; search matches, the bracket pair and invisibles do not.
// Those looks are sebaro's theme's (ADR-0051 #59); what novalis adds is
// `EDITOR_LOOKS`.
describe("EDITOR_LOOKS", () => {
  // The selectors of the export's `sebaroEditorTheme`, read from its text.
  const block = exportedEditor.slice(
    exportedEditor.indexOf("export const sebaroEditorTheme"),
    exportedEditor.indexOf("export const sebaroCodeFileTheme"),
  );
  /** Each selector of sebaro's theme with the properties its rule sets. */
  const sebaroRules = [...block.matchAll(/"([^"]+)":\s*\{([^}]*)\}/g)].flatMap(([, selector, body]) =>
    (selector ?? "").split(/,\s*/).map((part) => ({
      part,
      properties: [...(body ?? "").matchAll(/(\w+):/g)].map(([, property]) => property),
    })),
  );

  // ADR-0051 #59: a property novalis set again on one of sebaro's
  // selectors would be a copy of sebaro's look, or a quiet change of it.
  it("sets none of the properties sebaro's theme sets", () => {
    expect(sebaroRules.length).toBeGreaterThan(30);
    for (const [selector, looks] of Object.entries(EDITOR_LOOKS)) {
      for (const part of selector.split(/,\s*/)) {
        const theirs = sebaroRules.filter((rule) => rule.part === part).flatMap((rule) => rule.properties);
        for (const property of Object.keys(looks)) expect(theirs, `${part} ${property}`).not.toContain(property);
      }
    }
  });

  // ZUG-09 at a 200 % root font: line numbers grow with the editor's text,
  // not the root; the find fields grow with sebaro's compact input itself
  // (`max(31px, 1lh)`, NV-D1), so the theme sets no height of its own.
  it("sizes the gutter by the editor and lets the find fields grow", () => {
    expect(EDITOR_LOOKS[".cm-lineNumbers .cm-gutterElement"]).toEqual({ padding: "0 0.75em 0 0.5em" });
    // The find bar is sebaro's (spec/02 §4.25.2): no layout of its own here.
    expect(Object.keys(EDITOR_LOOKS).filter((selector) => /nv-find|nv-goto/.test(selector))).toEqual([]);
  });

  it("puts no colour behind text anywhere else, and no role it fixed later", () => {
    for (const [selector, looks] of Object.entries(EDITOR_LOOKS)) {
      for (const value of Object.values(looks)) {
        expect(value, selector).not.toMatch(/(success|warning|danger|info|accent)-subtle|text-on-|--nv-color-/);
      }
    }
    expect(EDITOR_LOOKS[".nv-link-unresolved, .nv-link-unresolved span"]).toEqual({
      color: "var(--sb-color-text-muted)",
      textDecoration: "none",
    });
  });
});

// CodeMirror's base themes fill search matches yellow, selection matches
// green and the bracket pair teal or red, and their focused selection rule
// outranks a plain `.cm-selectionBackground`: none of that may show through.
describe("editorTheme against CodeMirror's base themes", () => {
  let view: EditorView | null = null;
  afterEach(() => {
    view?.destroy();
    view = null;
  });

  it("leaves matches and brackets without a fill and puts the selection on sebaro's role", () => {
    view = new EditorView({
      state: EditorState.create({
        doc: "(a) a",
        extensions: [
          editorTheme,
          drawSelection(),
          search(),
          highlightSelectionMatches(),
          bracketMatching(),
          autocompletion(),
        ],
      }),
      parent: document.body,
    });
    view.dom.classList.add("cm-focused");
    const span = (cls: string, parent: Element = view!.contentDOM) => {
      const node = document.createElement("span");
      node.className = cls;
      parent.append(node);
      return node;
    };
    const layer = document.createElement("div");
    layer.className = "cm-selectionLayer";
    view.scrollDOM.append(layer);
    const fill = (node: Element) => getComputedStyle(node).backgroundColor;
    for (const cls of [
      "cm-searchMatch",
      "cm-searchMatch cm-searchMatch-selected",
      "cm-selectionMatch",
      "cm-matchingBracket",
      "cm-nonmatchingBracket",
    ]) {
      expect(fill(span(cls)), cls).toBe("rgba(0, 0, 0, 0)");
    }
    // sebaro writes the selection's three selectors as one list with
    // `::selection`, which jsdom cannot match; the rule is in the sheet.
    const sheet = [...document.querySelectorAll("style")].map((element) => element.textContent ?? "").join("\n");
    expect(sheet).toMatch(
      /\.cm-focused > \.cm-scroller > \.cm-selectionLayer \.cm-selectionBackground, [^{]*\.cm-selectionBackground, [^{]*\.cm-content ::selection \{background-color: var\(--sb-color-selection\);\}/,
    );
    expect(getComputedStyle(span("cm-completionMatchedText")).textDecoration).toBe("none");
  });

  // spec/09 §17 (NV-I14): drawSelection's layer stays under the text; while a
  // selection is not empty the current line and inline code drop their
  // grounds, so neither covers it.
  it("takes the current line's and inline code's grounds away while text is selected", () => {
    view = new EditorView({
      state: EditorState.create({ doc: "a `b`", extensions: [editorTheme, drawSelection(), sebaroSelectionMark] }),
      parent: document.body,
    });
    // Outside the content, which CodeMirror redraws on a change.
    const host = document.createElement("div");
    view.dom.append(host);
    const line = document.createElement("div");
    line.className = "cm-activeLine";
    const code = document.createElement("span");
    code.className = "sb-cm-code";
    host.append(line, code);
    const fill = (node: Element) => getComputedStyle(node).backgroundColor;

    expect(view.dom.hasAttribute("data-sb-selection")).toBe(false);
    expect(fill(line)).toBe("var(--sb-color-hover-fill)");
    expect(fill(code)).toBe("var(--sb-color-surface-sunken)");
    const drawn = view.scrollDOM.querySelector<HTMLElement>(".cm-layer.cm-selectionLayer")!;
    expect(getComputedStyle(drawn).zIndex).toMatch(/^-\d+$/);

    view.dispatch({ selection: { anchor: 0, head: 3 } });
    expect(view.dom.hasAttribute("data-sb-selection")).toBe(true);
    expect(fill(line)).toBe("rgba(0, 0, 0, 0)");
    expect(fill(code)).toBe("rgba(0, 0, 0, 0)");

    view.dispatch({ selection: { anchor: 2 } });
    expect(view.dom.hasAttribute("data-sb-selection")).toBe(false);
    expect(fill(line)).toBe("var(--sb-color-hover-fill)");
  });

  // spec/01 §1.8.2: a code file takes sebaro's code-file theme, Mono with
  // its tracking, over the writing area's face; a note keeps the UI face.
  it("sets a code file in Mono and a note in the UI face", () => {
    const scrollerFont = (extensions: Extension) => {
      const mounted = new EditorView({ state: EditorState.create({ extensions }), parent: document.body });
      const font = getComputedStyle(mounted.scrollDOM).fontFamily;
      mounted.destroy();
      return font;
    };
    expect(scrollerFont([editorTheme])).toBe("var(--sb-font-family-ui)");
    // As setup.ts adds it: high, after the editor's theme.
    expect(scrollerFont([editorTheme, Prec.high(sebaroCodeFileTheme)])).toBe("var(--sb-font-family-mono)");
  });

  it("greys a done task's text, whose spans the list rule would put in `text`", () => {
    view = new EditorView({
      state: EditorState.create({ doc: "- [x] done", extensions: [editorTheme, syntaxHighlighting(markdownHighlight)] }),
      parent: document.body,
    });
    const line = document.createElement("div");
    line.className = "cm-line nv-task-done";
    const text = document.createElement("span");
    text.className = style(t.list)!;
    line.append(text);
    view.contentDOM.append(line);
    expect(getComputedStyle(text).color).toBe("var(--sb-color-text-muted)");
  });
});
