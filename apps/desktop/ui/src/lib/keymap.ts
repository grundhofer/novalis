/**
 * The v1 keymap (docs/KEYMAP.md, ADR-0008). Hard-coded, no rebinding UI.
 *
 * The table below is the same set of chords and command ids as the table in
 * `docs/KEYMAP.md`, in the same canonical notation: modifiers in the order
 * `Ctrl`, `Alt`, `Shift`, `Cmd`, joined by `+`, then the key — letters
 * upper-case, digits, punctuation literal, named keys `Up Down Left Right
 * Enter Backspace Escape Home End PageUp PageDown Tab Plus Minus F6`.
 *
 * Chords whose scope is `editor*` are also bound inside CodeMirror; they are
 * listed here because the native menu owns the same chords on macOS and
 * dispatches them by command id, and because the command palette shows them.
 * Chords whose scope is `viewer` are the PDF pane's own (ADR-0025): it reads
 * them from this table while it has focus, and nothing else takes them — an
 * arrow key anywhere else is still the tree's, the input's or the system's.
 */

export type Scope =
  | "global"
  | "editor"
  | "editor:markdown"
  | "editor:code"
  | "tree"
  | "board"
  | "viewer";

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
  { chord: "Cmd+J", command: "file.todayNote", scope: "global" },
  { chord: "Cmd+Q", command: "app.quit", scope: "global" },
  { chord: "Cmd+W", command: "tab.close", scope: "global" },
  { chord: "Cmd+B", command: "markdown.bold", scope: "editor:markdown" },
  { chord: "Cmd+I", command: "markdown.italic", scope: "editor:markdown" },
  // sebaro's settings chord (DSK-09, DSK-02, ADR-0051 #1): the settings view.
  { chord: "Cmd+,", command: "settings.open", scope: "global" },
  // sebaro's palette chord (D84, ADR-0051) comes before the older second one,
  // so `bindingFor` shows `⌘K`.
  { chord: "Cmd+K", command: "palette.open", scope: "global" },
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
  { chord: "Ctrl+Shift+Tab", command: "tab.previous", scope: "global" },
  { chord: "Ctrl+Tab", command: "tab.next", scope: "global" },
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
  // sebaro's Zurück / Vor (D102 (14), ADR-0051 #36): ⌘← / ⌘→ first, so
  // `bindingFor` gives them; a text field keeps those two ([`fieldKeeps`]), and
  // there ⌃⌘← / ⌃⌘→ go back and forward, as they do everywhere.
  { chord: "Cmd+Left", command: "nav.back", scope: "global" },
  { chord: "Cmd+Right", command: "nav.forward", scope: "global" },
  { chord: "Ctrl+Cmd+Left", command: "nav.back", scope: "global" },
  { chord: "Ctrl+Cmd+Right", command: "nav.forward", scope: "global" },
  // sebaro's areas (spec/02 §4.20, ADR-0051): title bar, sidebar, content,
  // action zone.
  { chord: "F6", command: "area.next", scope: "global" },
  { chord: "Shift+F6", command: "area.previous", scope: "global" },
  // Markdown and view.
  { chord: "Shift+Cmd+K", command: "markdown.link", scope: "editor:markdown" },
  { chord: "Cmd+Enter", command: "markdown.toggleCheckbox", scope: "editor:markdown" },
  { chord: "Cmd+E", command: "note.togglePreview", scope: "global" },
  { chord: "Ctrl+Cmd+S", command: "sidebar.toggle", scope: "global" },
  { chord: "Shift+Cmd+B", command: "board.toggle", scope: "global" },
  { chord: "Cmd+Plus", command: "view.fontLarger", scope: "global" },
  { chord: "Cmd+Minus", command: "view.fontSmaller", scope: "global" },
  { chord: "Cmd+0", command: "view.fontReset", scope: "global" },
  // Tree. Enter is the tree's own key now and opens the row (ADR-0051 #12).
  { chord: "Cmd+Backspace", command: "tree.trash", scope: "tree" },
  { chord: "Alt+Cmd+N", command: "tree.newFolder", scope: "global" },
  // The PDF pane (ADR-0025). `PageUp`/`PageDown` are their own ids: with one
  // page on screen they turn it like the arrows, and they are what would
  // scroll by a screen if the viewer ever scrolls continuously.
  { chord: "Left", command: "viewer.previousPage", scope: "viewer" },
  { chord: "Right", command: "viewer.nextPage", scope: "viewer" },
  { chord: "PageUp", command: "viewer.pageUp", scope: "viewer" },
  { chord: "PageDown", command: "viewer.pageDown", scope: "viewer" },
  { chord: "Home", command: "viewer.firstPage", scope: "viewer" },
  { chord: "End", command: "viewer.lastPage", scope: "viewer" },
];

/**
 * sebaro's fixed chords (spec/02 §4.19, DSK-09) in this table's notation, each
 * with the name of its fixed row: the `sebaro` column of docs/KEYMAP.md names
 * the same row for every binding of one of them (the keymap-parity test), and
 * a control announcing any other chord marks it as the app's own
 * (`data-sb-own-shortcut`, [`isOwnChord`]).
 */
export const SEBARO_FIXED: Readonly<Record<string, string>> = {
  "Cmd+K": "Befehlspalette",
  "Cmd+,": "Einstellungen",
  "Cmd+N": "Hauptaktion des Bereichs",
  "Cmd+O": "Öffnen",
  "Cmd+F": "Suchen in der Ansicht",
  "Ctrl+Cmd+S": "Seitenleiste ein und aus",
  "Alt+Cmd+I": "Inspektor ein und aus",
  F6: "Nächster / vorheriger Bereich",
  "Shift+F6": "Nächster / vorheriger Bereich",
  "Ctrl+Tab": "Nächster / vorheriger Reiter",
  "Ctrl+Shift+Tab": "Nächster / vorheriger Reiter",
  "Cmd+W": "Reiter oder Fenster schließen",
  "Shift+Cmd+N": "Neues Fenster",
  "Cmd+Z": "Widerrufen / Wiederholen",
  "Shift+Cmd+Z": "Widerrufen / Wiederholen",
  "Cmd+Backspace": "Löschen",
  "Cmd+Plus": "Schrift größer / kleiner",
  "Cmd+Minus": "Schrift größer / kleiner",
  "Cmd+Left": "Zurück / Vor",
  "Cmd+Right": "Zurück / Vor",
  "Ctrl+Cmd+Left": "Zurück / Vor",
  "Ctrl+Cmd+Right": "Zurück / Vor",
};

/**
 * The chords a text field keeps on macOS (spec/02 §4.19, D102 (14), ADR-0051
 * #36): ⌘← / ⌘→ go to the line's start and end there — in the editor too,
 * which is CodeMirror's own binding — so Back / Forward are ⌃⌘← / ⌃⌘→ in a
 * field.
 */
const FIELD_CHORDS = new Set(["Cmd+Left", "Cmd+Right"]);

/** A text field, as sebaro's window script tells one (`isTextField`, sb-window.js): an editable text, CodeMirror's included. */
const TEXT_FIELD =
  "input:not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit']):not([type='range']), textarea, select, [contenteditable]:not([contenteditable='false'])";

/** Whether `chord` is the key's own in `target`, a text field, and not the app's (⌘← / ⌘→). */
export function fieldKeeps(chord: string, target: EventTarget | null): boolean {
  return FIELD_CHORDS.has(chord) && target instanceof Element && target.closest(TEXT_FIELD) !== null;
}

/** The text field's clipboard chords: neither fixed by sebaro nor the app's own (spec/02 §4.19). */
const CLIPBOARD = new Set(["Cmd+C", "Cmd+X", "Cmd+V", "Cmd+A"]);

/**
 * Whether a control announcing `chord` marks it `data-sb-own-shortcut`: a
 * chord that is neither one of sebaro's fixed ones nor a clipboard key
 * (spec/02 §4.19, the shortcut check's S7).
 */
export function isOwnChord(chord: string): boolean {
  return !(chord in SEBARO_FIXED) && !CLIPBOARD.has(chord);
}

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
  // ⌫ only: ⌦ (fn ⌫) is no key of the keymap, so ⌘⌦ trashes nothing.
  Backspace: "Backspace",
  Escape: "Escape",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Tab: "Tab",
  F6: "F6",
};

/**
 * `KeyboardEvent.key` → `Plus` / `Minus`. The font-size chords are the one
 * place a character counts rather than a key's position (spec/09 §13.1,
 * ADR-0051): „+“ is a key of its own on the German layout, where US has
 * `]`, and `⇧=` on the US one, which also takes the unshifted `=`.
 */
const KEY_BY_CHARACTER: Record<string, string> = {
  "+": "Plus",
  "=": "Plus",
  "-": "Minus",
  "−": "Minus",
};

/**
 * The chord a key event represents, in `docs/KEYMAP.md` notation, or `null`
 * for a key that cannot be part of one.
 *
 * `event.code` is the physical key, so a German layout produces the same chord
 * as a US one — which is the point of a hard-coded keymap on a bilingual app.
 * The exception is `+` and `-` (`KEY_BY_CHARACTER`), read as characters.
 */
export function chordOf(event: KeyboardEvent): string | null {
  const character = KEY_BY_CHARACTER[event.key];
  let key: string | undefined = character ?? KEY_BY_CODE[event.code];
  if (!key) {
    if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
    else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
    else return null;
  }
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  // The Shift that makes „+“ is part of the character, not of the chord.
  if (event.shiftKey && !character) parts.push("Shift");
  if (event.metaKey) parts.push("Cmd");
  if (parts.length === 0 && (key.length === 1 || character)) return null;
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
  Backspace: "⌫",
  Escape: "⎋",
  Tab: "⇥",
  Plus: "+",
  Minus: "−",
};

/**
 * The macOS display form of a chord (`⇧⌘P`), for menus and the palette. Home,
 * End, PageUp and PageDown have no glyph in sebaro's fonts and stand as words
 * (D102 (12), spec/07 §4.8): they come back as the keymap's names here, and
 * components/Keys.tsx writes them in the page's language.
 */
export function glyphsOf(chord: string): string {
  return chord
    .split("+")
    .map((part) => GLYPHS[part] ?? part)
    .join("");
}

/** The keymap's names where `aria-keyshortcuts` takes another (the `KeyboardEvent.key` values). */
const ARIA_KEYS: Record<string, string> = {
  Ctrl: "Control",
  Alt: "Alt",
  Shift: "Shift",
  Cmd: "Meta",
  Up: "ArrowUp",
  Down: "ArrowDown",
  Left: "ArrowLeft",
  Right: "ArrowRight",
};

/**
 * A chord as `aria-keyshortcuts` writes it, in the macOS form sebaro's markup
 * carries (spec/02 §4.18): `Ctrl+Cmd+S` → `Control+Meta+S`, `Left` →
 * `ArrowLeft`.
 */
export function ariaKeyshortcutsOf(chord: string): string {
  return chord
    .split("+")
    .map((part) => ARIA_KEYS[part] ?? part)
    .join("+");
}

/**
 * Every chord of a scope, as one `aria-keyshortcuts` value: the PDF pane
 * announces the `viewer` rows of docs/KEYMAP.md it handles.
 */
export function ariaKeyshortcutsOfScope(scope: Binding["scope"]): string {
  return KEYMAP.filter((binding) => binding.scope === scope)
    .map((binding) => ariaKeyshortcutsOf(binding.chord))
    .join(" ");
}

// A command with two chords (the palette, Back, Forward; ADR-0051) shows its first one.
const BY_COMMAND = new Map<string, Binding>();
for (const binding of KEYMAP) if (!BY_COMMAND.has(binding.command)) BY_COMMAND.set(binding.command, binding);
const BY_CHORD = new Map(KEYMAP.map((b) => [b.chord, b] as const));

export function bindingFor(command: string): Binding | undefined {
  return BY_COMMAND.get(command);
}

export function commandForChord(chord: string): Binding | undefined {
  return BY_CHORD.get(chord);
}
