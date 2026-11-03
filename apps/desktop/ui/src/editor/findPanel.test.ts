import {
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  search,
  searchKeymap,
  searchPanelOpen,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import en from "../../../../../i18n/en.json";
import i18next from "../i18n";
import { createFindPanel, goToLine, gotoLinePanel, lineTarget } from "./findPanel";

// ADR-0051 #27.19: CodeMirror's find bar and Go to Line in sebaro's parts,
// every function and key kept. No phrases are loaded, so the words are
// CodeMirror's own English ones; the count's come from the catalog.

let view: EditorView | null = null;

beforeAll(async () => {
  await i18next.init({
    lng: "en",
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

function editor(doc: string, readOnly = false): EditorView {
  view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        search({ top: true, createPanel: createFindPanel }),
        gotoLinePanel,
        keymap.of(searchKeymap),
        EditorState.allowMultipleSelections.of(true),
        EditorState.readOnly.of(readOnly),
      ],
    }),
    parent: document.body,
  });
  return view;
}

afterEach(() => {
  view?.destroy();
  view = null;
  vi.useRealTimers();
});

const bar = (v: EditorView) => v.dom.querySelector<HTMLElement>(".sb-find-bar[role=search]")!;
const field = (v: EditorView, name: string) => v.dom.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
const chip = (v: EditorView, name: string) => v.dom.querySelector<HTMLButtonElement>(`.sb-chip[name="${name}"]`)!;
const named = (v: EditorView, label: string) => v.dom.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const worded = (v: EditorView, word: string) =>
  [...v.dom.querySelectorAll<HTMLButtonElement>(".sb-secondary-action")].find((b) => b.textContent === word)!;

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function key(target: HTMLElement, init: KeyboardEventInit): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

describe("the find bar", () => {
  it("is sebaro's search field, option chips, compact tools and secondary actions", () => {
    const v = editor("a b a\n");
    openSearchPanel(v);

    expect(bar(v).getAttribute("role")).toBe("search");
    const input = field(v, "search");
    expect(input.type).toBe("search");
    expect(input.hasAttribute("main-field")).toBe(true);
    expect(input.closest(".sb-field__control")?.classList.contains("sb-search")).toBe(true);
    expect(input.closest(".sb-field")?.className).toBe("sb-field sb-field--compact");
    expect(field(v, "replace").closest(".sb-field")?.className).toBe("sb-field sb-field--compact");
    // spec/02 §4.25.2 (D104 (3)): the find and replace rows of sebaro's find bar.
    expect(input.closest(".sb-doc-bar")?.getAttribute("data-sb-find-row")).toBe("find");
    expect(field(v, "replace").closest(".sb-doc-bar")?.getAttribute("data-sb-find-row")).toBe("replace");
    expect(input.parentElement?.querySelector("use")?.getAttribute("href")).toBe("#search");
    const label = v.dom.querySelector(`label[for="${input.id}"]`)!;
    expect(label.className).toBe("sb-field__label sb-visually-hidden");
    expect(label.textContent).toBe("Find");

    const group = v.dom.querySelector(".sb-chips")!;
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-label")).toBe("search options");
    expect([...group.querySelectorAll(".sb-chip")].map((c) => [c.textContent, c.getAttribute("aria-pressed")])).toEqual([
      ["match case", "false"],
      ["regexp", "false"],
      ["by word", "false"],
    ]);
    expect(group.querySelector(".sb-chip use")?.getAttribute("href")).toBe("#check--16");

    const tools = [...v.dom.querySelectorAll(".sb-icon-button.sb-icon-button--compact")];
    expect(tools.map((b) => b.getAttribute("aria-label"))).toEqual(["previous", "next", "close"]);
    expect(tools.map((b) => b.querySelector("use")?.getAttribute("href"))).toEqual([
      "#chevron-up",
      "#chevron-down",
      "#close",
    ]);
    expect(named(v, "next").getAttribute("aria-keyshortcuts")).toBe("Meta+G");
    expect(named(v, "previous").getAttribute("aria-keyshortcuts")).toBe("Shift+Meta+G");
    // ⌘G is novalis' own chord; ⌘F, which puts focus into the field, is sebaro's.
    expect(named(v, "next").hasAttribute("data-sb-own-shortcut")).toBe(true);
    expect(v.dom.querySelector("input[type=search]")?.getAttribute("aria-keyshortcuts")).toBe("Meta+F");
    const tip = document.getElementById(named(v, "next").getAttribute("aria-describedby")!)!;
    expect(tip.className).toBe("sb-tooltip");
    expect(tip.getAttribute("popover")).toBe("manual");
    expect(tip.querySelector(".sb-keys")?.getAttribute("data-sb-keys")).toBe("Mod+G");

    expect(
      [...v.dom.querySelectorAll(".sb-secondary-action.sb-secondary-action--compact")].map((b) => b.textContent),
    ).toEqual(["all", "replace", "replace all"]);
    // Nothing of CodeMirror's own controls is left.
    expect(v.dom.querySelector(".cm-button, .cm-textfield, input[type=checkbox]")).toBeNull();
  });

  it("searches as it is typed, Enter going to the next match and Shift+Enter to the one before", () => {
    const v = editor("one two one two one\n");
    openSearchPanel(v);
    const input = field(v, "search");
    type(input, "two");
    expect(getSearchQuery(v.state).search).toBe("two");

    key(input, { key: "Enter" });
    expect([v.state.selection.main.from, v.state.selection.main.to]).toEqual([4, 7]);
    key(input, { key: "Enter" });
    expect(v.state.selection.main.from).toBe(12);
    key(input, { key: "Enter", shiftKey: true });
    expect(v.state.selection.main.from).toBe(4);

    named(v, "next").click();
    expect(v.state.selection.main.from).toBe(12);
    named(v, "previous").click();
    expect(v.state.selection.main.from).toBe(4);
  });

  it("toggles match case, regexp and by word as pressed chips", () => {
    const v = editor("Aa aa\n");
    openSearchPanel(v);
    for (const [name, option] of [
      ["case", "caseSensitive"],
      ["re", "regexp"],
      ["word", "wholeWord"],
    ] as const) {
      chip(v, name).click();
      expect(chip(v, name).getAttribute("aria-pressed")).toBe("true");
      expect(getSearchQuery(v.state)[option]).toBe(true);
      chip(v, name).click();
      expect(chip(v, name).getAttribute("aria-pressed")).toBe("false");
      expect(getSearchQuery(v.state)[option]).toBe(false);
    }
  });

  it("replaces one with Enter in its field, all with its action, and selects every match", () => {
    const v = editor("a a a\n");
    openSearchPanel(v);
    type(field(v, "search"), "a");
    worded(v, "all").click();
    expect(v.state.selection.ranges).toHaveLength(3);

    type(field(v, "replace"), "b");
    key(field(v, "replace"), { key: "Enter" });
    expect(v.state.doc.toString()).toBe("b a a\n");
    worded(v, "replace all").click();
    expect(v.state.doc.toString()).toBe("b b b\n");
  });

  it("follows a query set from outside, and closes with Escape", () => {
    const v = editor("x\n");
    openSearchPanel(v);
    v.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: "y", replace: "z", regexp: true, wholeWord: true })),
    });
    expect(field(v, "search").value).toBe("y");
    expect(field(v, "replace").value).toBe("z");
    expect(chip(v, "case").getAttribute("aria-pressed")).toBe("false");
    expect(chip(v, "re").getAttribute("aria-pressed")).toBe("true");
    expect(chip(v, "word").getAttribute("aria-pressed")).toBe("true");

    key(field(v, "search"), { key: "Escape" });
    expect(searchPanelOpen(v.state)).toBe(false);
    expect(v.dom.querySelector(".sb-find-bar")).toBeNull();
  });

  it("has no replace row in a read-only document", () => {
    const v = editor("x\n", true);
    openSearchPanel(v);
    expect(field(v, "search")).not.toBeNull();
    expect(field(v, "replace")).toBeNull();
    expect(worded(v, "replace all")).toBeUndefined();
  });
});

describe("the count", () => {
  const count = (v: EditorView) => v.dom.querySelector<HTMLElement>(".sb-doc-bar__count")!.textContent;
  const select = (v: EditorView, anchor: number, head = anchor) => v.dispatch({ selection: { anchor, head } });
  const mac = /Mac/.test(navigator.platform);
  // Every stretch of the count uses up its slice: a long text takes several.
  const slowClock = () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 10));
  };

  // spec/02 §4.25.2: the field, the count, then the tools; empty while the
  // field is.
  it("is sebaro's status between the field and Previous, empty while the field is", () => {
    const v = editor("a b a\n");
    openSearchPanel(v);
    const span = v.dom.querySelector<HTMLElement>("[data-sb-find-row=find] .sb-doc-bar__count")!;
    expect(span.tagName).toBe("SPAN");
    expect(span.getAttribute("role")).toBe("status");
    expect(span.previousElementSibling?.className).toBe("sb-field sb-field--compact");
    expect(span.nextElementSibling).toBe(named(v, "previous").parentElement);
    expect(span.textContent).toBe("");
  });

  // spec/02 §4.25.2 (sebaro f36b8f0): previous and next sit in one group, so
  // they wrap together.
  it("keeps Previous and Next together in one group, in that order", () => {
    const v = editor("a b a\n");
    openSearchPanel(v);
    const group = v.dom.querySelector<HTMLElement>("[data-sb-find-row=find] > .sb-doc-bar__group")!;
    expect(group.tagName).toBe("SPAN");
    expect(v.dom.querySelectorAll(".sb-doc-bar__group")).toHaveLength(1);
    expect([...group.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "previous",
      "next",
    ]);
  });

  // ADR-0051 #83: „m Treffer“ while no match is selected, „Treffer n von m“
  // once one is; typing selects none, as before.
  it("says the total while no match is selected and „Match n of m“ once one is", () => {
    const v = editor("one two one two one\n");
    openSearchPanel(v);
    const input = field(v, "search");
    type(input, "two");
    expect(count(v)).toBe("2\u00a0matches");
    expect(v.state.selection.main.empty).toBe(true);

    key(input, { key: "Enter" });
    expect(count(v)).toBe("Match 1 of 2");
    key(input, { key: "Enter" });
    expect(count(v)).toBe("Match 2 of 2");
    key(input, { key: "Enter", shiftKey: true });
    expect(count(v)).toBe("Match 1 of 2");
    named(v, "next").click();
    expect(count(v)).toBe("Match 2 of 2");
    named(v, "previous").click();
    expect(count(v)).toBe("Match 1 of 2");
    key(input, { key: "g", code: "KeyG", keyCode: 71, metaKey: mac, ctrlKey: !mac });
    expect(count(v)).toBe("Match 2 of 2");

    type(input, "one");
    expect(count(v)).toBe("3\u00a0matches");
    type(input, "one two one");
    expect(count(v)).toBe("1\u00a0match");
  });

  // CodeMirror's own announcement of the current match stays (ADR-0051 #83).
  it("leaves CodeMirror's announcement of the current match as it was", () => {
    const v = editor("one two\n");
    openSearchPanel(v);
    type(field(v, "search"), "two");
    key(field(v, "search"), { key: "Enter" });
    expect(v.dom.querySelector(".cm-announced")?.textContent).toBe("current match. one two on line 1.");
    expect(count(v)).toBe("Match 1 of 1");
  });

  it("says „No match“ for nothing found and for an invalid regexp, and nothing for an empty field", () => {
    const v = editor("a b\n");
    openSearchPanel(v);
    const input = field(v, "search");
    type(input, "xyz");
    expect(count(v)).toBe("No match");
    chip(v, "re").click();
    type(input, "(");
    expect(getSearchQuery(v.state).valid).toBe(false);
    expect(count(v)).toBe("No match");
    type(input, "");
    expect(count(v)).toBe("");
    chip(v, "re").click();
    // A space is a search like any other: only an empty field says nothing.
    type(input, " ");
    expect(count(v)).toBe("1\u00a0match");
  });

  it("counts as the options say, as CodeMirror marks", () => {
    const v = editor("Aa aa a\n");
    openSearchPanel(v);
    type(field(v, "search"), "a");
    expect(count(v)).toBe("5\u00a0matches");
    chip(v, "case").click();
    type(field(v, "search"), "A");
    expect(count(v)).toBe("1\u00a0match");
    chip(v, "case").click();
    type(field(v, "search"), "a");
    chip(v, "word").click();
    expect(count(v)).toBe("1\u00a0match");
    chip(v, "word").click();
    chip(v, "re").click();
    type(field(v, "search"), "a+");
    expect(count(v)).toBe("3\u00a0matches");
  });

  it("follows the selection: a selected word, a cursor, a range that is no match, „all“", () => {
    const v = editor("one two one\n");
    select(v, 8, 11);
    openSearchPanel(v);
    // The bar opens with the selected word as its query.
    expect(field(v, "search").value).toBe("one");
    expect(count(v)).toBe("Match 2 of 2");
    select(v, 5);
    expect(count(v)).toBe("2\u00a0matches");
    select(v, 0, 3);
    expect(count(v)).toBe("Match 1 of 2");
    select(v, 1, 4);
    expect(count(v)).toBe("2\u00a0matches");
    worded(v, "all").click();
    expect(v.state.selection.ranges).toHaveLength(2);
    expect(count(v)).toBe("2\u00a0matches");
  });

  // Counted without overlap, as „all“ selects: a match inside a run is none.
  it("counts without overlap and takes no overlapping match as the current one", () => {
    const v = editor("aaaa\n");
    openSearchPanel(v);
    type(field(v, "search"), "aa");
    expect(count(v)).toBe("2\u00a0matches");
    select(v, 2, 4);
    expect(count(v)).toBe("Match 2 of 2");
    select(v, 1, 3);
    expect(count(v)).toBe("2\u00a0matches");
  });

  // A regexp that looks past its match (`\b`, a lookahead) sees the text
  // after the selection: CodeMirror's previous match ends its look there
  // and can select \u201efoo\u201c in \u201efoobar\u201c, which the total does not count.
  it("takes no selection for a match that is one only where the text is cut", () => {
    const v = editor("foo x foobar y\n");
    openSearchPanel(v);
    chip(v, "re").click();
    for (const search of ["foo\\b", "foo(?!bar)"]) {
      type(field(v, "search"), search);
      expect(count(v)).toBe("1\u00a0match");
      select(v, 9);
      findPrevious(v);
      expect(v.state.selection.main).toMatchObject({ from: 6, to: 9 });
      expect(count(v)).toBe("1\u00a0match");
      select(v, 0, 3);
      expect(count(v)).toBe("Match 1 of 1");
      select(v, 6, 9);
      expect(count(v)).toBe("1\u00a0match");
    }
  });

  it("follows a query set from outside at once", () => {
    const v = editor("one two two\n");
    openSearchPanel(v);
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "two" })) });
    expect(count(v)).toBe("2\u00a0matches");
  });

  // An edit is counted after a pause in the typing; until then the last
  // count stands, and no „Match n of m“ is made of the old text's total.
  it("counts an edit after a pause, the last count standing until then", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const v = editor("a a a\n");
    openSearchPanel(v);
    type(field(v, "search"), "a");
    expect(count(v)).toBe("3\u00a0matches");

    v.dispatch({ changes: { from: 0, insert: "a " } });
    select(v, 0, 1);
    expect(count(v)).toBe("3\u00a0matches");
    vi.advanceTimersByTime(150);
    expect(count(v)).toBe("Match 1 of 4");

    type(field(v, "replace"), "b");
    key(field(v, "replace"), { key: "Enter" });
    expect(v.state.doc.toString()).toBe("b a a a\n");
    vi.advanceTimersByTime(150);
    expect(count(v)).toBe("Match 1 of 3");
  });

  it("writes only what changed, so the status says nothing twice", () => {
    const v = editor("one two one\n");
    openSearchPanel(v);
    type(field(v, "search"), "one");
    const span = v.dom.querySelector<HTMLElement>(".sb-doc-bar__count")!;
    const observer = new MutationObserver(() => {});
    observer.observe(span, { childList: true, characterData: true, subtree: true });
    select(v, 4);
    select(v, 5);
    v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "one", replace: "x" })) });
    expect(observer.takeRecords()).toHaveLength(0);
    expect(span.textContent).toBe("2\u00a0matches");
    observer.disconnect();
  });

  it("counts a long text in slices and never shows the total of another query", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const text = `${"ab\n".repeat(12_000)}c\n`;
    const v = editor(text);
    openSearchPanel(v);
    type(field(v, "search"), "a");
    vi.runAllTimers();
    expect(count(v)).toBe("12000\u00a0matches");

    slowClock();
    type(field(v, "search"), "c");
    expect(count(v)).toBe("");
    vi.runAllTimers();
    expect(count(v)).toBe("1\u00a0match");

    // Which match the selection is waits for the matches before it.
    type(field(v, "search"), "b");
    vi.runAllTimers();
    expect(count(v)).toBe("12000\u00a0matches");
    select(v, text.length - 4, text.length - 3);
    expect(count(v)).toBe("12000\u00a0matches");
    vi.runAllTimers();
    expect(count(v)).toBe("Match 12000 of 12000");

    // The replacement finds nothing else: the count stays as it is.
    type(field(v, "replace"), "x");
    expect(vi.getTimerCount()).toBe(0);
    expect(count(v)).toBe("Match 12000 of 12000");
  });

  // A stretch at a time, a match across a seam counted once, as one cursor
  // over the whole text counts; the first line is longer than a stretch
  // reads whole, so it is cut inside.
  it("counts across the stretches as one cursor over the whole text", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const text = `${"ab aab ".repeat(20_000)}\n${"a".repeat(40_001)}\n`;
    const v = editor(text);
    openSearchPanel(v);
    for (const [search, regexp] of [
      ["ab a", false],
      ["aa", false],
      ["b a+", true],
      ["x*", true],
      // An empty match right after one across a seam (at 32 768).
      ["(ab)?", true],
      ["a{3}|b", true],
    ] as const) {
      const query = new SearchQuery({ search, regexp });
      let n = 0;
      for (const cursor = query.getCursor(v.state); !cursor.next().done; ) n += 1;
      v.dispatch({ effects: setSearchQuery.of(query) });
      vi.runAllTimers();
      expect([search, count(v)]).toEqual([search, `${n}\u00a0matches`]);
    }
  });

  // A regexp over several lines (`\s`, `[^…]`) is one string to CodeMirror
  // from where its cursor starts: a stretch starts at a line start, so `^`,
  // `\b` and a look behind see the text as one cursor over all of it does,
  // and so does the count of the matches before the selection.
  it("counts a regexp over several lines across the stretches as one cursor", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const words = Array.from({ length: 9_000 }, (_, i) => (i % 3 ? "foo" : "barfoo")).join(" ");
    const sections = Array.from(
      { length: 800 },
      (_, i) => `## Section ${i}\n\nSome text\n- item ${i}\n- the other item\n`,
    ).join("");
    const v = editor(`${sections}${words}\n${words}\n${"a".repeat(40_001)}\n${sections}`);
    openSearchPanel(v);
    for (const search of ["^\\w+\\s", "\\bfoo\\s", "(?<!bar)foo\\s", "^[^\\n]", "^\\s*$", "\\d\\s+-"]) {
      select(v, 0);
      const query = new SearchQuery({ search, regexp: true });
      const cursor = query.getCursor(v.state);
      let n = 0;
      let last = { from: 0, to: 0 };
      for (let step = cursor.next(); !step.done; step = cursor.next(), n += 1) last = step.value;
      v.dispatch({ effects: setSearchQuery.of(query) });
      vi.runAllTimers();
      expect([search, count(v)]).toEqual([search, `${n}\u00a0matches`]);
      if (last.from === last.to) continue;
      select(v, last.from, last.to);
      vi.runAllTimers();
      expect([search, count(v)]).toEqual([search, `Match ${n} of ${n}`]);
    }
  });

  it("stops counting when the bar closes", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const v = editor("ab\n".repeat(12_000));
    openSearchPanel(v);
    const span = v.dom.querySelector<HTMLElement>(".sb-doc-bar__count")!;
    slowClock();
    type(field(v, "search"), "a");
    expect(span.textContent).toBe("");
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    key(field(v, "search"), { key: "Escape" });
    expect(searchPanelOpen(v.state)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(span.textContent).toBe("");
  });

  it("counts the same in a read-only document", () => {
    const v = editor("x y x\n", true);
    select(v, 4, 5);
    openSearchPanel(v);
    expect(count(v)).toBe("Match 2 of 2");
    select(v, 0);
    expect(count(v)).toBe("2\u00a0matches");
  });
});

describe("Go to Line", () => {
  it("is a labelled field with the current line, a secondary Go and a close tool", () => {
    const v = editor("1\n2\n3\n4\n");
    v.dispatch({ selection: { anchor: 2 } });
    expect(goToLine(v)).toBe(true);

    const form = v.dom.querySelector<HTMLFormElement>("form.sb-find-bar")!;
    const input = form.querySelector<HTMLInputElement>("input[name=line]")!;
    expect(input.value).toBe("2");
    expect(input.parentElement?.className).toBe("sb-field__control");
    // spec/02 §4.25.2: the line row's number field, „von n“ as its suffix.
    expect(input.parentElement?.parentElement?.className).toBe("sb-field sb-field--compact sb-field--number");
    expect(input.nextElementSibling?.className).toBe("sb-field__suffix");
    expect(input.nextElementSibling?.textContent).toBe("of 5");
    expect(form.firstElementChild?.getAttribute("data-sb-find-row")).toBe("line");
    expect(input.parentElement?.parentElement?.firstElementChild?.className).toBe("sb-field__label");
    expect(form.querySelector(`label[for="${input.id}"]`)?.textContent).toBe("Go to line");
    const go = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    expect(go.className).toBe("sb-secondary-action sb-secondary-action--compact");
    expect(go.textContent).toBe("go");
    expect(form.querySelector(".sb-icon-button--compact")?.getAttribute("aria-label")).toBe("close");

    // A second Ctrl+G selects the field again; there is one panel.
    expect(goToLine(v)).toBe(true);
    expect(v.dom.querySelectorAll("form.sb-find-bar")).toHaveLength(1);

    input.value = "4";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(v.state.selection.main.head).toBe(6);
    expect(v.dom.querySelector("form.sb-find-bar")).toBeNull();
  });

  it("keeps „von n“ with the document while it stays open", () => {
    const v = editor("1\n2\n");
    goToLine(v);
    const suffix = () => v.dom.querySelector("form.sb-find-bar .sb-field__suffix")?.textContent;
    // The count stands on the bar as sebaro's `data-sb-lines` (D108 NV-Y4).
    const lines = () => v.dom.querySelector("form.sb-find-bar")?.getAttribute("data-sb-lines");
    expect(suffix()).toBe("of 3");
    expect(lines()).toBe("3");
    v.dispatch({ changes: { from: v.state.doc.length, insert: "3\n4\n" } });
    expect(suffix()).toBe("of 5");
    expect(lines()).toBe("5");
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "" } });
    expect(suffix()).toBe("of 1");
    expect(lines()).toBe("1");
  });

  // ADR-0051 #54, spec/02 §4.25.2: a line it cannot go to answers with
  // sebaro's field error under the field; the bar stays open, the number
  // chosen for another try, and the sentence follows the document.
  it("says a line it cannot go to under the field and stays open", () => {
    const v = editor("1\n2\n");
    goToLine(v);
    const form = v.dom.querySelector<HTMLFormElement>("form.sb-find-bar")!;
    const input = form.querySelector<HTMLInputElement>("input[name=line]")!;
    const error = form.querySelector<HTMLElement>(".sb-field__error")!;
    expect(error.hidden).toBe(true);
    expect(error.parentElement?.matches(".sb-field--number")).toBe(true);
    expect(error.querySelector("svg use")?.getAttribute("href")).toBe("#error--16");
    expect(input.hasAttribute("aria-invalid")).toBe(false);

    for (const wrong of ["9", "0", "two"]) {
      input.value = wrong;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      expect(v.dom.querySelector("form.sb-find-bar")).toBe(form);
      expect(error.hidden).toBe(false);
      expect(error.textContent).toBe("Enter a line from 1 to 3.");
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.getAttribute("aria-describedby")).toBe(error.id);
      expect(document.activeElement).toBe(input);
      expect(v.state.selection.main.head).toBe(0);
    }
    v.dispatch({ changes: { from: v.state.doc.length, insert: "3\n" } });
    expect(error.textContent).toBe("Enter a line from 1 to 4.");

    input.value = "2";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(v.dom.querySelector("form.sb-find-bar")).toBeNull();
    expect(v.state.doc.lineAt(v.state.selection.main.head).number).toBe(2);
  });

  it("closes with Escape and with its tool", () => {
    const v = editor("1\n2\n");
    goToLine(v);
    key(v.dom.querySelector<HTMLInputElement>("form.sb-find-bar input")!, { key: "Escape" });
    expect(v.dom.querySelector("form.sb-find-bar")).toBeNull();

    goToLine(v);
    v.dom.querySelector<HTMLButtonElement>("form.sb-find-bar .sb-icon-button")!.click();
    expect(v.dom.querySelector("form.sb-find-bar")).toBeNull();
  });

  // The close tool's tooltip (sb-tooltip.js) hides on focusout, which a
  // focused element taken out of the page never gets in WebKit.
  it("moves focus to the editor before the panel goes", () => {
    const v = editor("1\n2\n");
    goToLine(v);
    const tool = v.dom.querySelector<HTMLButtonElement>("form.sb-find-bar .sb-icon-button")!;
    tool.focus();
    let leftInPage: boolean | null = null;
    tool.addEventListener("focusout", () => {
      leftInPage = tool.isConnected;
    });
    tool.click();
    expect(leftInPage).toBe(true);
    expect(v.dom.querySelector("form.sb-find-bar")).toBeNull();
  });

  it("reads a line, an offset, a share and a column as CodeMirror's Go to Line does", () => {
    const v = editor(Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n"));
    v.dispatch({ selection: { anchor: v.state.doc.line(5).from } });
    const lineOf = (value: string) => {
      const target = lineTarget(v, value);
      return target ? v.state.doc.lineAt(target.main.head).number : null;
    };
    expect(lineOf("3")).toBe(3);
    expect(lineOf("+2")).toBe(7);
    expect(lineOf("-2")).toBe(3);
    expect(lineOf("50%")).toBe(5);
    // A step past the end lands on it; a line number past it is no line
    // (ADR-0051 #54).
    expect(lineOf("+99")).toBe(10);
    expect(lineOf("99")).toBeNull();
    expect(lineOf("0")).toBeNull();
    expect(lineOf("x")).toBeNull();
    expect(lineTarget(v, "2:3")?.main.head).toBe(v.state.doc.line(2).from + 3);
  });
});
