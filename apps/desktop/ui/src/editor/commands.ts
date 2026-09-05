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
import { EditorSelection, type StateCommand } from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";

import { setEditorBridge, type EditorHeading } from "../lib/editorBridge";
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
};

/** Every `#`-heading in the open document, for the palette's heading jump. */
function headings(): EditorHeading[] {
  if (!active) return [];
  const out: EditorHeading[] = [];
  for (let line = 1; line <= active.state.doc.lines; line += 1) {
    const text = active.state.doc.line(line).text;
    const match = /^(#{1,6})\s+(.*\S)/.exec(text);
    if (match) out.push({ line, text: `${match[1]} ${match[2]}` });
  }
  return out;
}

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
  headings,
  goToLine: (line) => {
    if (!active || line < 1 || line > active.state.doc.lines) return;
    const target = active.state.doc.line(line);
    active.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
    active.focus();
  },
});
