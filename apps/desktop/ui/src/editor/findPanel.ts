import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import {
  EditorSelection,
  type EditorState,
  type Extension,
  type SelectionRange,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import {
  type Command,
  EditorView,
  getPanel,
  type Panel,
  runScopeHandlers,
  showPanel,
  type ViewUpdate,
} from "@codemirror/view";

import { iconNode, type IconName } from "../components/Icon";
import { spoken } from "../components/Keys";
import i18next from "../i18n";
import { ariaKeyshortcutsOf, bindingFor, glyphsOf, isOwnChord } from "../lib/keymap";

/**
 * The find bar and Go to Line in sebaro's parts (ADR-0051 #27.19): CodeMirror's
 * own panels drew its grey buttons and checkboxes. The functions are
 * CodeMirror's, unchanged — find, next, previous, select all, match case,
 * regexp, by word, replace, replace all, close; Go to Line takes the same
 * `line`, `+n` / `-n`, `n%` and `:column` — and so are the keys: Enter is the
 * next match (Shift+Enter the previous), Enter in the replace field replaces
 * one, and the search keymap's scoped keys (Escape closes, ⌘G, ⇧⌘G) work
 * inside the bar. The words are CodeMirror's phrases (./phrases).
 *
 * sebaro's parts: the bar is sebaro's find bar over the text, under the
 * tabs (`.sb-find-bar[role=search]`, spec/02 §4.25.2, D104 (3)), its rows
 * `.sb-doc-bar` (`data-sb-find-row` „find“, „replace“, „line“) that wrap at
 * large text; the fields are the compact window field `sb-field--compact`
 * (32 px, F14a) with a label only screen readers hear, the find field
 * `sb-search` (spec/02 §2.2), the three options `sb-chip[aria-pressed]`
 * (§2.9, 32 px in the window's density, D104 (2)), next / previous / close
 * the 32 px tools `sb-icon-button--compact` with sebaro's tooltip (§4.18),
 * previous and next in one `sb-doc-bar__group`, so they wrap together,
 * the word actions `sb-secondary-action--compact`, Go to Line's field
 * `sb-field--number` with „von n“ as its suffix, which follows the
 * document's line count in `data-sb-lines` on the bar, and sebaro's field
 * error under it for a line it cannot go to (ADR-0051 #54). The bar has no „Suche
 * leeren“: Escape closes it, as before. CodeMirror draws its own hits
 * (D102 (30)); the bar counts them in sebaro's `__count` as the preview's
 * does (ADR-0051 #83): „Treffer n von m“ while the selection is one of them,
 * „m Treffer“ while it is none, „Kein Treffer“, and nothing while the field
 * is empty. CodeMirror's own „Aktueller Treffer. … in Zeile n.“ stays.
 */

let serial = 0;

type Attrs = Record<string, string>;

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

/** A chord as sebaro's `sb-keys`, as components/Keys.tsx renders it. */
function keysNode(doc: Document, chord: string): HTMLElement {
  const parts = chord.split("+");
  return el(
    doc,
    "span",
    {
      class: "sb-keys",
      "data-sb-keys": parts.map((p) => (p === "Cmd" ? "Mod" : p)).join("+"),
    },
    [
      el(doc, "span", { "aria-hidden": "true" }, [glyphsOf(chord)]),
      el(doc, "span", { class: "sb-visually-hidden" }, [parts.map((p) => spoken(p, i18next.t)).join(" ")]),
    ],
  );
}

/**
 * A tool as components/Tool.tsx renders it: named by `aria-label`, its chord
 * from the keymap in `aria-keyshortcuts`, sebaro's tooltip „Name Kürzel“
 * beside it (sb-tooltip.js finds it by `aria-describedby`).
 */
function tool(doc: Document, name: string, icon: IconName, run: () => void, command?: string): Node[] {
  const tip = `nv-find-tip-${(serial += 1)}`;
  const chord = command ? bindingFor(command)?.chord : undefined;
  const button = el(doc, "button", {
    class: "sb-icon-button sb-icon-button--compact",
    type: "button",
    "aria-label": name,
    "aria-describedby": tip,
  });
  if (chord) button.setAttribute("aria-keyshortcuts", ariaKeyshortcutsOf(chord));
  if (chord && isOwnChord(chord)) button.setAttribute("data-sb-own-shortcut", "");
  button.append(iconNode(doc, icon, 20));
  button.addEventListener("click", run);
  const tooltip = el(doc, "span", { class: "sb-tooltip", role: "tooltip", id: tip, popover: "manual" }, [
    el(doc, "span", { "aria-hidden": "true" }, [name]),
  ]);
  if (chord) tooltip.append(keysNode(doc, chord));
  return [button, tooltip];
}

function action(doc: Document, name: string, run: () => void): HTMLButtonElement {
  const button = el(
    doc,
    "button",
    {
      class: "sb-secondary-action sb-secondary-action--compact",
      type: "button",
    },
    [name],
  );
  button.addEventListener("click", run);
  return button;
}

/**
 * A compact `sb-field` with its label for screen readers only: the
 * placeholder names the task, and sebaro.css gives the field the label's
 * column too (spec/02 §4.25.2).
 */
function field(doc: Document, label: string, input: HTMLInputElement, search: boolean): HTMLElement {
  input.id = `nv-find-field-${(serial += 1)}`;
  const control = el(doc, "div", {
    class: search ? "sb-field__control sb-search" : "sb-field__control",
  });
  if (search) control.append(iconNode(doc, "search", 20));
  control.append(input);
  return el(doc, "div", { class: "sb-field sb-field--compact" }, [
    el(doc, "label", { class: "sb-field__label sb-visually-hidden", for: input.id }, [label]),
    control,
  ]);
}

function chip(
  doc: Document,
  label: string,
  name: string,
  pressed: boolean,
  onToggle: () => void,
): HTMLButtonElement {
  const button = el(
    doc,
    "button",
    { class: "sb-chip", type: "button", name, "aria-pressed": String(pressed) },
    [iconNode(doc, "check", 16), label],
  );
  button.addEventListener("click", () => {
    button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true"));
    onToggle();
  });
  return button;
}

const isPressed = (button: HTMLElement) => button.getAttribute("aria-pressed") === "true";

/**
 * The count keeps typing inside PLAN.md §11.3: it reads a stretch of the
 * text at a time and gives the window back after a few milliseconds, and
 * after an edit it waits for a pause before it counts again. CodeMirror's
 * case-insensitive cursor takes some 40–80 ms a megabyte: a 1 MB note is
 * counted within a tenth of a second, a 50 MB note in seconds in the
 * background, with no cap, as in the preview. A stretch ends at a line
 * start; a line up to LINE long is read whole, a longer one is cut inside.
 */
const SLICE_MS = 8;
const STRETCH = 16_384;
const LINE = 65_536;
const EDIT_PAUSE_MS = 150;

type Match = { from: number; to: number };

/** How far a cursor reads past where its matches may start. */
const margin = (query: SearchQuery) => 1_000 + query.search.length;

/** Where a stretch from `pos` ends: at a line start, unless a line is too long. */
function seamAfter(doc: Text, pos: number): number {
  const target = pos + STRETCH;
  if (target >= doc.length) return doc.length;
  const line = doc.lineAt(target);
  if (line.from > pos) return line.from;
  return line.to + 1 - pos <= LINE ? Math.min(doc.length, line.to + 1) : target;
}

/**
 * Where a cursor for matches from `pos` starts: at the start of the line
 * before, or of `pos`'s own line inside it. CodeMirror reads a regexp over
 * several lines (`\s`, `[^…]`) as one string from the cursor's start, where
 * `^` holds and nothing lies behind, and passes over an empty match there.
 */
function cursorStart(doc: Text, pos: number): number {
  const from = doc.lineAt(Math.max(0, pos - 1)).from;
  return pos - from <= LINE ? from : pos;
}

/**
 * Counts the matches of `query` in `state`, one after another without
 * overlap, as CodeMirror's „all“ and „replace all“ find them, and gives
 * `done` their number. With `stopAt` it stops at the first match that
 * starts there or later and gives the number before it and that match. The
 * first slice runs at once; the result is what stops the rest. A stretch's
 * cursor starts before it (`cursorStart`) and reads a margin past its end,
 * so a match across the seam is found whole and its context is the text's.
 * It can still count differently from one cursor where a match longer than
 * the margin meets a seam, and for a regexp over several lines whose match
 * ends inside the line a stretch's cursor starts from, that looks further
 * behind than the line before, or that meets a seam inside a line longer
 * than LINE. One `exec` cannot be cut into slices: a pattern that backtracks without
 * end over a long line (`(a+)+b`) holds the window as it would in „all“.
 */
function countMatches(
  state: EditorState,
  query: SearchQuery,
  done: (n: number, at: Match | null) => void,
  stopAt = Infinity,
): () => void {
  const { doc } = state;
  let n = 0;
  let last: Match | null = null;
  let pos = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slice = () => {
    const until = performance.now() + SLICE_MS;
    for (;;) {
      const seam = seamAfter(doc, pos);
      const cursor = query.getCursor(state, cursorStart(doc, pos), Math.min(doc.length, seam + margin(query)));
      for (let step = cursor.next(); !step.done; step = cursor.next()) {
        const { from, to } = step.value;
        if (from < pos) continue;
        if (from >= seam && seam < doc.length) break;
        // A running cursor skips an empty match right after the last one; a
        // new one at the seam would not.
        if (from === to && last && last.from < last.to && from === last.to) continue;
        if (from >= stopAt) {
          done(n, { from, to });
          return;
        }
        n += 1;
        last = { from, to };
      }
      if (seam >= doc.length) {
        done(n, null);
        return;
      }
      pos = Math.max(seam, last?.to ?? 0);
      if (performance.now() >= until) {
        timer = setTimeout(slice, 0);
        return;
      }
    }
  };
  slice();
  return () => clearTimeout(timer);
}

/** Whether two queries find the same; the replacement plays no part. */
const findsSame = (a: SearchQuery, b: SearchQuery) =>
  a.search === b.search &&
  a.caseSensitive === b.caseSensitive &&
  a.regexp === b.regexp &&
  a.wholeWord === b.wholeWord &&
  a.test === b.test;

/**
 * Whether `range` is a match of `query` as it stands, from end to end: a
 * cursor from its line's start, reading past its end, so that `^`, `\b`
 * and a lookahead see the text around it.
 */
function isMatch(state: EditorState, query: SearchQuery, range: SelectionRange): boolean {
  const { doc } = state;
  const cursor = query.getCursor(state, cursorStart(doc, range.from), Math.min(doc.length, range.to + margin(query)));
  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    if (step.value.from >= range.from) return step.value.from === range.from && step.value.to === range.to;
  }
  return false;
}

class FindPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = true;
  private query: SearchQuery;
  private readonly searchField: HTMLInputElement;
  private readonly replaceField: HTMLInputElement;
  private readonly caseChip: HTMLButtonElement;
  private readonly reChip: HTMLButtonElement;
  private readonly wordChip: HTMLButtonElement;
  // sebaro's count (spec/02 §4.25.2, ADR-0051 #83): a status, as in the preview.
  private readonly count: HTMLElement;
  /** The number of matches, with the text and the query it was counted in. */
  private total: { doc: Text; query: SearchQuery; n: number } | null = null;
  /** Which match the selection is, from 1; null while it is none. */
  private current: number | null = null;
  private locating = false;
  private stopTotal = () => {};
  private stopIndex = () => {};
  private pause: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly view: EditorView) {
    const doc = view.dom.ownerDocument;
    const phrase = (text: string) => view.state.phrase(text);
    const query = (this.query = getSearchQuery(view.state));
    const commit = () => this.commit();

    this.searchField = el(doc, "input", {
      type: "search",
      name: "search",
      placeholder: phrase("Find"),
      // openSearchPanel focuses and selects the field with this attribute.
      "main-field": "true",
      autocomplete: "off",
      spellcheck: "false",
      // ⌘F puts focus here and chooses the text: the field announces it (spec/02 §4.19).
      "aria-keyshortcuts": ariaKeyshortcutsOf("Cmd+F"),
    });
    this.searchField.value = query.search;
    this.replaceField = el(doc, "input", {
      type: "text",
      name: "replace",
      placeholder: phrase("Replace"),
      autocomplete: "off",
      spellcheck: "false",
    });
    this.replaceField.value = query.replace;
    for (const input of [this.searchField, this.replaceField]) {
      input.addEventListener("input", commit);
      input.addEventListener("change", commit);
    }
    this.caseChip = chip(doc, phrase("match case"), "case", query.caseSensitive, commit);
    this.reChip = chip(doc, phrase("regexp"), "re", query.regexp, commit);
    this.wordChip = chip(doc, phrase("by word"), "word", query.wholeWord, commit);
    this.count = el(doc, "span", { class: "sb-doc-bar__count", role: "status" });

    const find = el(doc, "div", { class: "sb-doc-bar", "data-sb-find-row": "find" }, [
      field(doc, phrase("Find"), this.searchField, true),
      this.count,
      el(doc, "span", { class: "sb-doc-bar__group" }, [
        ...tool(doc, phrase("previous"), "chevron-up", () => findPrevious(view), "find.previous"),
        ...tool(doc, phrase("next"), "chevron-down", () => findNext(view), "find.next"),
      ]),
      action(doc, phrase("all"), () => selectMatches(view)),
      el(
        doc,
        "div",
        {
          class: "sb-chips",
          role: "group",
          "aria-label": phrase("search options"),
        },
        [this.caseChip, this.reChip, this.wordChip],
      ),
      ...tool(doc, phrase("close"), "close", () => closeSearchPanel(view)),
    ]);
    const rows: HTMLElement[] = [find];
    if (!view.state.readOnly) {
      rows.push(
        el(doc, "div", { class: "sb-doc-bar", "data-sb-find-row": "replace" }, [
          field(doc, phrase("Replace"), this.replaceField, false),
          action(doc, phrase("replace"), () => replaceNext(view)),
          action(doc, phrase("replace all"), () => replaceAll(view)),
        ]),
      );
    }
    this.dom = el(doc, "div", { class: "sb-find-bar", role: "search", "aria-label": phrase("Find") }, rows);
    this.dom.addEventListener("keydown", (event) => this.keydown(event));
  }

  private commit(): void {
    const query = new SearchQuery({
      search: this.searchField.value,
      caseSensitive: isPressed(this.caseChip),
      regexp: isPressed(this.reChip),
      wholeWord: isPressed(this.wordChip),
      replace: this.replaceField.value,
    });
    if (query.eq(this.query)) return;
    this.query = query;
    this.view.dispatch({ effects: setSearchQuery.of(query) });
  }

  private keydown(event: KeyboardEvent): void {
    if (runScopeHandlers(this.view, event, "search-panel")) {
      event.preventDefault();
    } else if (event.isComposing) {
      return;
    } else if (event.key === "Enter" && event.target === this.searchField) {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(this.view);
    } else if (event.key === "Enter" && event.target === this.replaceField) {
      event.preventDefault();
      replaceNext(this.view);
    }
  }

  update(update: ViewUpdate): void {
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) this.setQuery(effect.value);
      }
    }
    if (!findsSame(getSearchQuery(update.state), getSearchQuery(update.startState))) this.recount(update.state, true);
    else if (update.docChanged) this.recount(update.state, false);
    else if (update.selectionSet) this.locate(update.state);
  }

  private setQuery(query: SearchQuery): void {
    this.query = query;
    this.searchField.value = query.search;
    this.replaceField.value = query.replace;
    this.caseChip.setAttribute("aria-pressed", String(query.caseSensitive));
    this.reChip.setAttribute("aria-pressed", String(query.regexp));
    this.wordChip.setAttribute("aria-pressed", String(query.wholeWord));
  }

  /**
   * Counts the matches again: at once for a new query, after a pause in the
   * typing for an edit. A new query empties the count until its total
   * stands, so the bar never says the number of another query; after an
   * edit the last count stands until the new one does.
   */
  private recount(state: EditorState, now: boolean): void {
    this.stop();
    this.total = null;
    if (!getSearchQuery(state).valid) {
      this.show(state);
      return;
    }
    const start = (from: EditorState) => {
      const query = getSearchQuery(from);
      this.stopTotal = countMatches(from, query, (n) => {
        this.total = { doc: from.doc, query, n };
        this.locate(this.view.state);
      });
    };
    if (now) {
      start(state);
      if (!this.total) this.write("");
    } else {
      this.pause = setTimeout(() => start(this.view.state), EDIT_PAUSE_MS);
    }
  }

  /**
   * Which match the selection is. Only a single selection that is exactly a
   * counted match is one: CodeMirror's next and previous select it, and so
   * does a selected word the bar opens with. The matches before it are
   * counted only once a cheap look says it is one.
   */
  private locate(state: EditorState): void {
    this.stopIndex();
    this.current = null;
    this.locating = false;
    const { total } = this;
    const query = getSearchQuery(state);
    const main = state.selection.main;
    if (
      !total ||
      total.n === 0 ||
      total.doc !== state.doc ||
      !findsSame(total.query, query) ||
      state.selection.ranges.length > 1 ||
      main.empty ||
      !isMatch(state, query, main)
    ) {
      this.show(state);
      return;
    }
    this.locating = true;
    this.stopIndex = countMatches(
      state,
      query,
      (n, at) => {
        this.locating = false;
        if (at?.from === main.from && at.to === main.to && n < total.n) this.current = n + 1;
        this.show(this.view.state);
      },
      main.from,
    );
  }

  /** The count's words; a total of another text or query is never shown. */
  private show(state: EditorState): void {
    const query = getSearchQuery(state);
    const total = this.total?.doc === state.doc && findsSame(this.total.query, query) ? this.total : null;
    if (query.search === "") {
      this.write("");
    } else if (!query.valid || total?.n === 0) {
      this.write(i18next.t("editor.find.noMatches"));
    } else if (total && !this.locating) {
      this.write(
        this.current
          ? i18next.t("editor.find.matchCount", { current: this.current, count: total.n })
          : i18next.t("editor.find.matchTotal", { count: total.n }),
      );
    }
  }

  // Only a change is written: a status region says every write.
  private write(text: string): void {
    if (this.count.textContent !== text) this.count.textContent = text;
  }

  private stop(): void {
    clearTimeout(this.pause);
    this.stopTotal();
    this.stopIndex();
    this.locating = false;
  }

  mount(): void {
    this.searchField.select();
    this.recount(this.view.state, true);
  }

  destroy(): void {
    this.stop();
  }
}

/** The panel `search({ createPanel })` builds. */
export function createFindPanel(view: EditorView): Panel {
  return new FindPanel(view);
}

/* ----------------------------------------------------------- Go to Line */

const setGoto = StateEffect.define<boolean>();

function gotoPanel(view: EditorView): Panel {
  const doc = view.dom.ownerDocument;
  const phrase = (text: string) => view.state.phrase(text);
  const input = el(doc, "input", {
    type: "text",
    name: "line",
    autocomplete: "off",
    spellcheck: "false",
  });
  input.id = `nv-goto-field-${(serial += 1)}`;
  input.value = String(view.state.doc.lineAt(view.state.selection.main.head).number);
  // Focus goes back to the editor before the panel goes, as CodeMirror's
  // closeSearchPanel does: a focused element taken out of the page gets no
  // focusout in WebKit, and sb-tooltip.js would keep the close tool's
  // tooltip as shown and take the next Escape anywhere.
  const close = () => {
    view.focus();
    view.dispatch({ effects: setGoto.of(false) });
  };
  const lines = el(doc, "span", { class: "sb-field__suffix" });
  // A line it cannot go to: sebaro's field error under the field, „Gib eine
  // Zeile von 1 bis n ein.“, the bar staying open (spec/02 §4.25.2, ADR-0051
  // #54); hidden until then, `aria-describedby` while it shows.
  const errorWords = el(doc, "span");
  const error = el(doc, "p", { class: "sb-field__error", id: `${input.id}-error` }, [
    iconNode(doc, "error", 16),
    errorWords,
  ]);
  error.hidden = true;
  // sebaro's line row of the find bar (spec/02 §4.25.2, D104 (3)): the
  // number field with its label and „von n“, under the tabs as the find row.
  const form = el(doc, "form", { class: "sb-find-bar" }, [
    el(doc, "div", { class: "sb-doc-bar", "data-sb-find-row": "line" }, [
      el(doc, "div", { class: "sb-field sb-field--compact sb-field--number" }, [
        el(doc, "label", { class: "sb-field__label", for: input.id }, [phrase("Go to line")]),
        el(doc, "div", { class: "sb-field__control" }, [
          input,
          lines,
        ]),
        error,
      ]),
      el(
        doc,
        "button",
        {
          class: "sb-secondary-action sb-secondary-action--compact",
          type: "submit",
        },
        [phrase("go")],
      ),
      ...tool(doc, phrase("close"), "close", close),
    ]),
  ]);
  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
  // „von n“ and a shown error follow the document while the panel stays
  // open: the line count stands in `data-sb-lines` on the bar, as sebaro's
  // contract has it (spec/02 §4.25.2, D108 NV-Y4); the number goes in as
  // text, without a thousands separator (D105 (45)).
  const count = (state: EditorState) => {
    const total = String(state.doc.lines);
    form.setAttribute("data-sb-lines", total);
    lines.textContent = state.phrase("of $", total);
    if (!error.hidden) errorWords.textContent = state.phrase("Enter a line from 1 to $.", total);
  };
  count(view.state);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const selection = lineTarget(view, input.value);
    if (!selection) {
      error.hidden = false;
      count(view.state);
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", error.id);
      input.focus();
      input.select();
      return;
    }
    view.focus();
    view.dispatch({
      effects: [setGoto.of(false), EditorView.scrollIntoView(selection.main.from, { y: "center" })],
      selection,
    });
  });
  return {
    dom: form,
    top: true,
    mount: () => input.select(),
    update: (update: ViewUpdate) => {
      if (update.docChanged) count(update.state);
    },
  };
}

/**
 * What Go to Line jumps to, as CodeMirror's `gotoLine` reads it: a line,
 * `+n` / `-n` from the current one, `n%` of the document, `:column` after
 * any of them. Nothing for anything else, and nothing for a line number
 * outside 1 … the last line (sebaro's range, spec/02 §4.25.2, ADR-0051
 * #54); a step or share past either end lands on it, as CodeMirror's does.
 */
export function lineTarget(view: EditorView, value: string): EditorSelection | null {
  const match = /^([+-])?(\d+)?(:\d+)?(%)?$/.exec(value.trim());
  if (!match) return null;
  const { state } = view;
  const start = state.doc.lineAt(state.selection.main.head);
  const [, sign, ln, cl, percent] = match;
  const column = cl ? Number(cl.slice(1)) : 0;
  let line = ln ? Number(ln) : start.number;
  if (ln && percent) {
    let share = line / 100;
    if (sign) share = share * (sign === "-" ? -1 : 1) + start.number / state.doc.lines;
    line = Math.round(state.doc.lines * share);
  } else if (ln && sign) {
    line = line * (sign === "-" ? -1 : 1) + start.number;
  } else if (ln && (line < 1 || line > state.doc.lines)) {
    return null;
  }
  const target = state.doc.line(Math.max(1, Math.min(state.doc.lines, line)));
  return EditorSelection.single(target.from + Math.max(0, Math.min(column, target.length)));
}

const gotoOpen = StateField.define<boolean>({
  create: () => false,
  update(open, tr) {
    for (const effect of tr.effects) if (effect.is(setGoto)) open = effect.value;
    return open;
  },
  provide: (field) => showPanel.from(field, (open) => (open ? gotoPanel : null)),
});

/** The Go to Line panel's state; every editor has it (./setup). */
export const gotoLinePanel: Extension = gotoOpen;

/** Go to Line (`Ctrl+G`, docs/KEYMAP.md): opens the panel, or selects its field again. */
export const goToLine: Command = (view) => {
  const open = view.state.field(gotoOpen, false);
  if (open === undefined) return false;
  if (open) {
    getPanel(view, gotoPanel)?.dom.querySelector("input")?.select();
    return true;
  }
  view.dispatch({ effects: setGoto.of(true) });
  return true;
};
