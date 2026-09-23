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
  gotoLine,
  openSearchPanel,
  selectNextOccurrence,
  selectSelectionMatches,
} from "@codemirror/search";
import { EditorSelection, type EditorState, type StateCommand } from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";

import { setEditorBridge } from "../lib/editorBridge";
import { localIsoMinute } from "../lib/localTime";
import { toggleCheckbox, wrapSelection } from "./decorations";

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

/** `Cmd+K`: wrap the selection in a Markdown link and land in the target. */
const insertLink: StateCommand = ({ state, dispatch }) => {
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
  "editor.gotoLine": gotoLine,
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
  selectionOrLine: () => {
    if (!active) return null;
    const { state } = active;
    const main = state.selection.main;
    return main.empty ? state.doc.lineAt(main.head).text : state.sliceDoc(main.from, main.to);
  },
});
