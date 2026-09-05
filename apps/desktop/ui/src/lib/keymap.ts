/**
 * The v1 keymap (docs/KEYMAP.md, ADR-0008). Hard-coded, no rebinding UI.
 *
 * The table below is the same set of chords and command ids as the table in
 * `docs/KEYMAP.md`, in the same canonical notation: modifiers in the order
 * `Ctrl`, `Alt`, `Shift`, `Cmd`, joined by `+`, then the key — letters
 * upper-case, digits, punctuation literal, named keys `Up Down Left Right
 * Enter Delete Escape`.
 *
 * Chords whose scope is `editor*` are also bound inside CodeMirror; they are
 * listed here because the native menu owns the same chords on macOS and
 * dispatches them by command id, and because the command palette shows them.
 */

export type Scope = "global" | "editor" | "editor:markdown" | "editor:code" | "tree" | "board";

export interface Binding {
  readonly chord: string;
  readonly command: string;
  readonly scope: Scope;
}

export const KEYMAP: readonly Binding[] = [
  // Apple standard — handled by CodeMirror and the system, listed for the menu.
  { chord: "Cmd+Z", command: "edit.undo", scope: "editor" },
  { chord: "Shift+Cmd+Z", command: "edit.redo", scope: "editor" },
  { chord: "Cmd+F", command: "find.open", scope: "editor" },
  { chord: "Cmd+G", command: "find.next", scope: "editor" },
  { chord: "Shift+Cmd+G", command: "find.previous", scope: "editor" },
  { chord: "Cmd+S", command: "file.save", scope: "global" },
  { chord: "Cmd+N", command: "file.newNote", scope: "global" },
  { chord: "Cmd+O", command: "vault.open", scope: "global" },
  { chord: "Cmd+W", command: "tab.close", scope: "global" },
  { chord: "Cmd+B", command: "markdown.bold", scope: "editor:markdown" },
  { chord: "Cmd+I", command: "markdown.italic", scope: "editor:markdown" },
  // Sublime.
  { chord: "Cmd+P", command: "quickOpen.open", scope: "global" },
  { chord: "Shift+Cmd+P", command: "palette.open", scope: "global" },
  { chord: "Ctrl+G", command: "editor.gotoLine", scope: "editor" },
  { chord: "Cmd+D", command: "editor.selectNextOccurrence", scope: "editor" },
  { chord: "Shift+Cmd+L", command: "editor.selectAllOccurrences", scope: "editor" },
  { chord: "Alt+Cmd+F", command: "find.replace", scope: "editor" },
  { chord: "Shift+Cmd+F", command: "search.vault", scope: "global" },
  { chord: "Cmd+/", command: "editor.toggleComment", scope: "editor:code" },
  { chord: "Ctrl+Shift+Up", command: "editor.addCursorAbove", scope: "editor" },
  { chord: "Ctrl+Shift+Down", command: "editor.addCursorBelow", scope: "editor" },
  { chord: "Ctrl+Cmd+Up", command: "editor.moveLineUp", scope: "editor" },
  { chord: "Ctrl+Cmd+Down", command: "editor.moveLineDown", scope: "editor" },
  { chord: "Shift+Cmd+D", command: "editor.duplicateLine", scope: "editor" },
  { chord: "Ctrl+Shift+K", command: "editor.deleteLine", scope: "editor" },
  // Tabs and navigation.
  { chord: "Shift+Cmd+[", command: "tab.previous", scope: "global" },
  { chord: "Shift+Cmd+]", command: "tab.next", scope: "global" },
  { chord: "Cmd+1", command: "tab.goto.1", scope: "global" },
  { chord: "Cmd+2", command: "tab.goto.2", scope: "global" },
  { chord: "Cmd+3", command: "tab.goto.3", scope: "global" },
  { chord: "Cmd+4", command: "tab.goto.4", scope: "global" },
  { chord: "Cmd+5", command: "tab.goto.5", scope: "global" },
  { chord: "Cmd+6", command: "tab.goto.6", scope: "global" },
  { chord: "Cmd+7", command: "tab.goto.7", scope: "global" },
  { chord: "Cmd+8", command: "tab.goto.8", scope: "global" },
  { chord: "Cmd+9", command: "tab.goto.9", scope: "global" },
  { chord: "Shift+Cmd+T", command: "tab.reopenClosed", scope: "global" },
  { chord: "Cmd+[", command: "nav.back", scope: "global" },
  { chord: "Cmd+]", command: "nav.forward", scope: "global" },
  // Markdown and view.
  { chord: "Cmd+K", command: "markdown.link", scope: "editor:markdown" },
  { chord: "Cmd+Enter", command: "markdown.toggleCheckbox", scope: "editor:markdown" },
  { chord: "Cmd+\\", command: "sidebar.toggle", scope: "global" },
  { chord: "Shift+Cmd+B", command: "board.toggle", scope: "global" },
  { chord: "Cmd+=", command: "view.fontLarger", scope: "global" },
  { chord: "Cmd+-", command: "view.fontSmaller", scope: "global" },
  { chord: "Cmd+0", command: "view.fontReset", scope: "global" },
  // Tree.
  { chord: "Enter", command: "tree.rename", scope: "tree" },
  { chord: "Cmd+Delete", command: "tree.trash", scope: "tree" },
  { chord: "Shift+Cmd+N", command: "tree.newFolder", scope: "global" },
];

/** `KeyboardEvent.code` → the key half of a chord. */
const KEY_BY_CODE: Record<string, string> = {
  Equal: "=",
  Minus: "-",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Slash: "/",
  Comma: ",",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Enter: "Enter",
  NumpadEnter: "Enter",
  Backspace: "Delete",
  Delete: "Delete",
  Escape: "Escape",
};

/**
 * The chord a key event represents, in `docs/KEYMAP.md` notation, or `null`
 * for a key that cannot be part of one.
 *
 * `event.code` is the physical key, so a German layout produces the same chord
 * as a US one — which is the point of a hard-coded keymap on a bilingual app.
 */
export function chordOf(event: KeyboardEvent): string | null {
  let key: string | undefined = KEY_BY_CODE[event.code];
  if (!key) {
    if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
    else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
    else return null;
  }
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Cmd");
  if (parts.length === 0 && key.length === 1) return null;
  parts.push(key);
  return parts.join("+");
}

const GLYPHS: Record<string, string> = {
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  Cmd: "⌘",
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
  Enter: "↩",
  Delete: "⌫",
  Escape: "⎋",
};

/** The macOS display form of a chord (`⇧⌘P`), for menus and the palette. */
export function glyphsOf(chord: string): string {
  return chord
    .split("+")
    .map((part) => GLYPHS[part] ?? part)
    .join("");
}

const BY_COMMAND = new Map(KEYMAP.map((b) => [b.command, b] as const));
const BY_CHORD = new Map(KEYMAP.map((b) => [b.chord, b] as const));

export function bindingFor(command: string): Binding | undefined {
  return BY_COMMAND.get(command);
}

export function commandForChord(chord: string): Binding | undefined {
  return BY_CHORD.get(chord);
}
