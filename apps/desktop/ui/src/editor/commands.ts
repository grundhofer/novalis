import {
  cursorLineDown,
  cursorLineUp,
  moveLineDown,
  moveLineUp,
  redo,
  toggleComment,
  undo,
} from "@codemirror/commands";
import {
  findNext,
  findPrevious,
  openSearchPanel,
  selectNextOccurrence,
  selectSelectionMatches,
} from "@codemirror/search";
import { EditorSelection, type EditorState, type StateCommand, type Text } from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";

import { setEditorBridge } from "../lib/editorBridge";
import { localIsoMinute } from "../lib/localTime";
import { toggleCheckbox, wrapSelection } from "./decorations";
import { goToLine } from "./findPanel";

/**
 * The editor half of the command registry.
 *
 * Both entry points land here: a chord the webview sees, and a native menu
 * item, which on macOS swallows the chord and arrives as a `menu-action`
 * event. Same id, same function (docs/KEYMAP.md).
 */

let active: EditorView | null = null;

export function setActiveView(view: EditorView | null): void {
  active = view;
}

/** Add a cursor one line above or below every existing cursor (Sublime). */
function addCursorVertically(direction: -1 | 1): Command {
  return (view) => {
    const { state } = view;
    const ranges = [...state.selection.ranges];
    for (const range of state.selection.ranges) {
      const line = state.doc.lineAt(range.head);
      const targetNumber = line.number + direction;
      if (targetNumber < 1 || targetNumber > state.doc.lines) continue;
      const target = state.doc.line(targetNumber);
      const column = range.head - line.from;
      ranges.push(EditorSelection.cursor(Math.min(target.from + column, target.to)));
    }
    if (ranges.length === state.selection.ranges.length) return false;
    view.dispatch({ selection: EditorSelection.create(ranges, ranges.length - 1) });
    return true;
  };
}

/** `Shift+Cmd+D`: copy every selected line below itself. */
const duplicateLine: Command = (view) => {
  const { state } = view;
  const seen = new Set<number>();
  const changes = [];
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.head);
    if (seen.has(line.number)) continue;
    seen.add(line.number);
    changes.push({ from: line.to, insert: `\n${line.text}` });
  }
  if (changes.length === 0) return false;
  view.dispatch(state.update({ changes, userEvent: "input.duplicateLine" }));
  return true;
};

/** `Ctrl+Shift+K`: delete every line a cursor is on. */
const deleteLines: Command = (view) => {
  const { state } = view;
  const seen = new Set<number>();
  const changes = [];
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.head);
    if (seen.has(line.number)) continue;
    seen.add(line.number);
    changes.push({ from: line.from, to: Math.min(line.to + 1, state.doc.length) });
  }
  if (changes.length === 0) return false;
  view.dispatch(state.update({ changes, userEvent: "delete.line" }));
  return true;
};

/** `Shift+Cmd+K`: wrap the selection in a Markdown link and land in the target. */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  const spec = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const insert = `[${text}]()`;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length - 1),
    };
  });
  dispatch(state.update(spec, { scrollIntoView: true, userEvent: "input.link" }));
  return true;
};

/**
 * Insert date and time (ADR-0026): local `YYYY-MM-DD HH:MM` at every cursor,
 * replacing a selection, the way typing it would.
 */
const insertDateTime: StateCommand = ({ state, dispatch }) => {
  dispatch(
    state.update(state.replaceSelection(localIsoMinute()), {
      scrollIntoView: true,
      userEvent: "input.dateTime",
    }),
  );
  return true;
};

/**
 * The line spans the selection covers, one per range, merged where they
 * share a line: `[first line number, last line number]`, in document order.
 */
function lineSpans(state: EditorState): [number, number][] {
  const spans: [number, number][] = [];
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    // A selection that ends at a line's start does not take that line.
    const end = state.doc.lineAt(range.to);
    const last = range.to > range.from && end.from === range.to ? end.number - 1 : end.number;
    spans.push([first, Math.max(first, last)]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    if (previous && span[0] <= previous[1]) previous[1] = Math.max(previous[1], span[1]);
    else merged.push([...span]);
  }
  return merged;
}

/**
 * The block mark a line's text starts with after its indentation and its
 * quote marks: a task (a list item with a box, bullet or number), a bullet
 * item, a numbered item or a heading; or, for Quote, the quote mark itself.
 * `length` is the mark with the blanks after it.
 */
interface LineMark {
  kind: "task" | "list" | "ordered" | "heading" | "quote";
  length: number;
  /** A heading's level. */
  level?: number;
  /** A bullet item's or task's `-`, `*` or `+`. */
  bullet?: string;
}

function lineMarkOf(body: string): LineMark | null {
  let match = /^([-*+]|\d+[.)])[ \t]+\[[ xX]\](?:[ \t]+|$)/.exec(body);
  if (match) return { kind: "task", length: match[0].length, bullet: match[1] };
  match = /^([-*+])[ \t]+/.exec(body);
  if (match) return { kind: "list", length: match[0].length, bullet: match[1] };
  match = /^\d+[.)][ \t]+/.exec(body);
  if (match) return { kind: "ordered", length: match[0].length };
  match = /^(#{1,6})(?:[ \t]+|$)/.exec(body);
  if (match) return { kind: "heading", length: match[0].length, level: (match[1] as string).length };
  return null;
}

/** One quote mark; and all of a line's quote marks with the blanks after them. */
const QUOTE = /^>[ \t]?/;
const QUOTES = /^(?:>[ \t]?)*[ \t]*/;

/** A line format of the tool row (ADR-0051 #72, #77). */
export type LineFormat = { kind: "heading"; level: 1 | 2 | 3 } | { kind: "list" } | { kind: "task" } | { kind: "quote" };

function hasFormat(mark: LineMark | null, format: LineFormat): boolean {
  if (!mark || mark.kind !== format.kind) return false;
  return format.kind !== "heading" || mark.level === format.level;
}

/** The prefix `format` writes; a bullet item and a task keep each other's `-`, `*` or `+`. */
function prefixOf(format: LineFormat, mark: LineMark | null): string {
  const bullet = mark?.bullet && /^[-*+]$/.test(mark.bullet) ? mark.bullet : "-";
  switch (format.kind) {
    case "heading":
      return `${"#".repeat(format.level)} `;
    case "list":
      return `${bullet} `;
    case "task":
      return `${bullet} [ ] `;
    case "quote":
      return "> ";
  }
}

/**
 * Heading 1–3, List, Task and Quote (ADR-0051 #72, #77): they toggle per
 * line, over every line the selection touches (the lines `lineSpans`
 * counts). When every such line has the format, it is removed from each;
 * otherwise each line without it gets it. A quote holds the line's other
 * marks, as Markdown reads `> - a`: Quote adds or removes one quote mark
 * before them, and the other formats act behind the quote marks. Inside
 * them a line holds one mark: the format replaces the heading, bullet,
 * number or task box the line has, so a heading replaces another level,
 * List turns a task back into a bullet item (keeping its `-`, `*` or `+`)
 * and Task gives a bullet item its box. Blank lines are left alone while
 * the selection has text, so a list of paragraphs does not gain empty
 * items; a cursor on a blank line starts the format there. The indentation stays. One transaction, so one
 * undo step; a cursor at a new prefix lands after it.
 */
export function toggleLineFormat(format: LineFormat): StateCommand {
  return ({ state, dispatch }) => {
    const lines = lineSpans(state).flatMap(([first, last]) =>
      Array.from({ length: last - first + 1 }, (_, i) => state.doc.line(first + i)),
    );
    const filled = lines.filter((line) => line.text.trim() !== "");
    const marked = (filled.length > 0 ? filled : lines).map((line) => {
      const indent = /^[ \t]*/.exec(line.text)?.[0].length ?? 0;
      const body = line.text.slice(indent);
      if (format.kind === "quote") {
        const length = QUOTE.exec(body)?.[0].length ?? 0;
        return { at: line.from + indent, mark: length > 0 ? ({ kind: "quote", length } as const) : null };
      }
      const inner = indent + (QUOTES.exec(body)?.[0].length ?? 0);
      return { at: line.from + inner, mark: lineMarkOf(line.text.slice(inner)) };
    });
    const remove = marked.every(({ mark }) => hasFormat(mark, format));
    const changes = [];
    for (const { at, mark } of marked) {
      if (remove) changes.push({ from: at, to: at + (mark?.length ?? 0) });
      else if (!hasFormat(mark, format)) changes.push({ from: at, to: at + (mark?.length ?? 0), insert: prefixOf(format, mark) });
    }
    if (changes.length === 0) return false;
    const changeSet = state.changes(changes);
    dispatch(
      state.update({
        changes: changeSet,
        selection: state.selection.map(changeSet, 1),
        scrollIntoView: true,
        userEvent: "input.format",
      }),
    );
    return true;
  };
}

/**
 * The fenced code blocks of `doc` by line number: the opening fence, the
 * closing one (null when the block runs to the end) and the fence's own
 * backticks or tildes, so a fence put inside a block closes it.
 */
function fencedBlocks(doc: Text): { open: number; close: number | null; fence: string }[] {
  const blocks: { open: number; close: number | null; fence: string }[] = [];
  let open: { line: number; fence: string } | null = null;
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (!open) {
      const match = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(text);
      // A backtick fence's language holds no backtick (CommonMark).
      if (match && !((match[1] as string)[0] === "`" && (match[2] as string).includes("`")))
        open = { line: n, fence: match[1] as string };
    } else {
      const match = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(text);
      const fence = match?.[1];
      if (fence && fence[0] === open.fence[0] && fence.length >= open.fence.length) {
        blocks.push({ open: open.line, close: n, fence: open.fence });
        open = null;
      }
    }
  }
  if (open) blocks.push({ open: open.line, close: null, fence: open.fence });
  return blocks;
}

/**
 * Code (ADR-0051 #72, #77): backticks round the selection, or off when they
 * are round it already, as Bold does with `**`; a cursor gets a pair to
 * type into. When a selection covers several lines, it works on whole
 * lines and on the document's fenced blocks: lines outside every block are
 * fenced; lines inside a block leave it, its fence goes where they start
 * and end (or the block's own fence goes, when they are its first or last
 * lines). A selection that reaches past the block it touches is left as it
 * is. One transaction, so one undo step.
 */
export const toggleCode: StateCommand = (target) => {
  const { state, dispatch } = target;
  const spans = lineSpans(state);
  if (spans.every(([first, last]) => first === last)) return wrapSelection("`")(target);
  const { doc, lineBreak: lb } = state;
  const blocks = fencedBlocks(doc);
  // Line `n` with its line break.
  const drop = (n: number) =>
    n < doc.lines ? { from: doc.line(n).from, to: doc.line(n + 1).from } : { from: doc.line(n - 1).to, to: doc.line(n).to };
  const changes = [];
  for (const [first, last] of spans) {
    const block = blocks.find((b) => first <= (b.close ?? doc.lines) && last >= b.open);
    if (!block) {
      changes.push({ from: doc.line(first).from, insert: `\`\`\`${lb}` });
      changes.push({ from: doc.line(last).to, insert: `${lb}\`\`\`` });
      continue;
    }
    const end = block.close ?? doc.lines + 1;
    if (first < block.open || last > end) continue;
    // The block's lines in the selection; none when it holds only fences.
    const from = Math.max(first, block.open + 1);
    const to = Math.min(last, end - 1);
    if (from > to) continue;
    if (from === block.open + 1) changes.push(drop(block.open));
    else changes.push({ from: doc.line(from).from, insert: `${block.fence}${lb}` });
    if (to < end - 1) changes.push({ from: doc.line(to).to, insert: `${lb}${block.fence}` });
    else if (block.close !== null) changes.push(drop(block.close));
  }
  if (changes.length === 0) return false;
  dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input.format" }));
  return true;
};

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/**
 * Sort Lines (ADR-0029): the lines a selection covers, ignoring case and
 * accents, numbers by value — the whole document when nothing is selected.
 * Stable, so equal lines keep their order.
 */
const sortLines: StateCommand = ({ state, dispatch }) => {
  const spans = state.selection.ranges.every((r) => r.empty)
    ? [[1, state.doc.lines] as [number, number]]
    : lineSpans(state);
  const changes = [];
  for (const [first, last] of spans) {
    if (first === last) continue;
    const from = state.doc.line(first).from;
    const to = state.doc.line(last).to;
    const lines: string[] = [];
    for (let n = first; n <= last; n += 1) lines.push(state.doc.line(n).text);
    const sorted = [...lines].sort(collator.compare);
    if (sorted.every((line, i) => line === lines[i])) continue;
    changes.push({ from, to, insert: sorted.join(state.lineBreak) });
  }
  if (changes.length === 0) return false;
  dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input.sort" }));
  return true;
};

/**
 * Join Lines (ADR-0029): the lines a selection covers become one, or a
 * cursor's line takes the next one. The first line keeps its indentation,
 * the last its trailing whitespace (a Markdown line break); in between,
 * each part is trimmed, empty ones go, and one space separates the rest.
 */
const joinLines: StateCommand = ({ state, dispatch }) => {
  const changes = [];
  for (const [first, span] of lineSpans(state)) {
    const last = span === first ? first + 1 : span;
    if (last > state.doc.lines) continue;
    const texts: string[] = [];
    for (let n = first; n <= last; n += 1) texts.push(state.doc.line(n).text);
    const indent = /^\s*/.exec(texts[0] ?? "")?.[0] ?? "";
    const trailing = /\S(\s*)$/.exec(texts[texts.length - 1] ?? "")?.[1] ?? "";
    const parts = texts.map((text) => text.trim()).filter((text) => text !== "");
    changes.push({
      from: state.doc.line(first).from,
      to: state.doc.line(last).to,
      insert: indent + parts.join(" ") + (parts.length > 0 ? trailing : ""),
    });
  }
  if (changes.length === 0) return false;
  dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input.join" }));
  return true;
};

const REGISTRY: Record<string, Command> = {
  "edit.undo": undo,
  "edit.redo": redo,
  "find.open": openSearchPanel,
  "find.next": findNext,
  "find.previous": findPrevious,
  "find.replace": openSearchPanel,
  "editor.gotoLine": goToLine,
  "editor.selectNextOccurrence": selectNextOccurrence,
  "editor.selectAllOccurrences": selectSelectionMatches,
  "editor.addCursorAbove": addCursorVertically(-1),
  "editor.addCursorBelow": addCursorVertically(1),
  "editor.moveLineUp": moveLineUp,
  "editor.moveLineDown": moveLineDown,
  "editor.duplicateLine": duplicateLine,
  "editor.deleteLine": deleteLines,
  "editor.toggleComment": toggleComment,
  "editor.lineUp": cursorLineUp,
  "editor.lineDown": cursorLineDown,
  "markdown.bold": wrapSelection("**"),
  "markdown.italic": wrapSelection("_"),
  "markdown.link": insertLink,
  "markdown.toggleCheckbox": toggleCheckbox,
  // The tool row's formats (ADR-0051 #72, #76, #77).
  "markdown.heading1": toggleLineFormat({ kind: "heading", level: 1 }),
  "markdown.heading2": toggleLineFormat({ kind: "heading", level: 2 }),
  "markdown.heading3": toggleLineFormat({ kind: "heading", level: 3 }),
  "markdown.list": toggleLineFormat({ kind: "list" }),
  "markdown.task": toggleLineFormat({ kind: "task" }),
  "markdown.code": toggleCode,
  "markdown.quote": toggleLineFormat({ kind: "quote" }),
  "editor.insertDateTime": insertDateTime,
  "editor.sortLines": sortLines,
  "editor.joinLines": joinLines,
};

// Registering here rather than exporting is what keeps CodeMirror out of the
// eager bundle: nothing in the shell imports this file (see lib/editorBridge).
setEditorBridge({
  run: (id) => {
    const view = active;
    const command = REGISTRY[id];
    if (!view || !command) return false;
    view.focus();
    return command(view);
  },
  has: (id) => id in REGISTRY,
  goToLine: (line) => {
    if (!active || line < 1 || line > active.state.doc.lines) return;
    const target = active.state.doc.line(line);
    active.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
    active.focus();
  },
  selection: () => {
    if (!active) return "";
    const main = active.state.selection.main;
    return active.state.sliceDoc(main.from, main.to);
  },
  selectionOrLine: () => {
    if (!active) return null;
    const { state } = active;
    const main = state.selection.main;
    return main.empty ? state.doc.lineAt(main.head).text : state.sliceDoc(main.from, main.to);
  },
});
