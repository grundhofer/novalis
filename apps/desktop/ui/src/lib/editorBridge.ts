/**
 * The seam between the always-loaded shell and the lazily-loaded editor.
 *
 * The command registry, the palette and the menu all need to drive the editor,
 * but importing `editor/commands` from any of them would drag CodeMirror into
 * the eager bundle — 84 KB gzip that the budget gate counts and that a user who
 * never opens a note never needs (PLAN.md §11.3).
 *
 * So this module holds no CodeMirror import at all. `editor/commands.ts`
 * registers itself here when the editor chunk loads; until then every call is
 * a no-op, which is exactly right: with no editor there is nothing to run.
 */

export interface EditorHeading {
  line: number;
  text: string;
}

export interface EditorBridge {
  run: (id: string) => boolean;
  has: (id: string) => boolean;
  headings: () => EditorHeading[];
  goToLine: (line: number) => void;
}

let bridge: EditorBridge | null = null;

export function setEditorBridge(next: EditorBridge | null): void {
  bridge = next;
}

export function runEditorCommand(id: string): boolean {
  return bridge?.run(id) ?? false;
}

export function isEditorCommand(id: string): boolean {
  return bridge?.has(id) ?? false;
}

export function editorHeadings(): EditorHeading[] {
  return bridge?.headings() ?? [];
}

export function goToEditorLine(line: number): void {
  bridge?.goToLine(line);
}

/**
 * A line to show once the note's pane exists. After a tab switch the editor
 * builds its view, and the preview fetches its fragment, asynchronously; a
 * caller that opens a note and wants a line in it parks the line here, and
 * whichever of the two shows the note takes it right after it has something
 * to scroll. One slot, last writer wins.
 */
let deferredLine: number | null = null;

export function deferLine(line: number | null): void {
  deferredLine = line;
}

export function takeDeferredLine(): number | null {
  const line = deferredLine;
  deferredLine = null;
  return line;
}
