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

import { headingLine } from "./headings";

export interface EditorBridge {
  run: (id: string) => boolean;
  has: (id: string) => boolean;
  goToLine: (line: number) => void;
  /** The main selection's text, or the cursor's line when nothing is selected. */
  selectionOrLine: () => string | null;
  /** The main selection's text; empty when nothing is selected. */
  selection: () => string;
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

export function goToEditorLine(line: number): void {
  bridge?.goToLine(line);
}

export function editorSelectionOrLine(): string | null {
  return bridge?.selectionOrLine() ?? null;
}

export function editorSelection(): string {
  return bridge?.selection() ?? "";
}

/**
 * Where a jump into a note should land: the line the cache knew, and the
 * text of that line as the cache saw it. The cache follows the file, the
 * file follows the buffer after the autosave pause, so by the time of a
 * click the link may sit on another line; the pane that shows the note
 * settles the line against its own text with `resolveLine`.
 */
export interface LineTarget {
  /** 1-based, as indexed. */
  line: number;
  /** The indexed line, trimmed, possibly cut to a window around the link. */
  snippet: string;
  /**
   * A heading to land on instead (`[[note#heading]]`, §7.2): its line in the
   * text the pane shows wins; without it, `line` and `snippet` decide.
   */
  heading?: string;
}

/**
 * The line in `text` that `target` means now: the indexed line when its
 * text still matches, else the matching line nearest to it, else the indexed
 * line as it was. A snippet the search cut down starts with `…`; the rest
 * of it is still a substring of the line it came from.
 */
export function resolveLine(text: string, target: LineTarget): number {
  if (target.heading !== undefined) {
    const found = headingLine(text, target.heading);
    if (found !== null) return found;
  }
  const want = target.snippet.replace(/^…/, "");
  if (!want) return target.line;
  const lines = text.split("\n");
  const matches = (n: number) => (lines[n - 1] ?? "").includes(want);
  if (matches(target.line)) return target.line;
  let best = target.line;
  let distance = Infinity;
  for (let n = 1; n <= lines.length; n += 1) {
    const d = Math.abs(n - target.line);
    if (d < distance && matches(n)) {
      best = n;
      distance = d;
    }
  }
  return best;
}

/**
 * A target parked for the note's pane. After a tab switch the editor builds
 * its view, and the preview fetches its fragment, asynchronously; a caller
 * that opens a note and wants a line in it parks the target here, and
 * whichever of the two shows the note takes it right after it has something
 * to scroll. One slot, last writer wins.
 */
let deferred: LineTarget | null = null;

export function deferLine(target: LineTarget | null): void {
  deferred = target;
}

export function takeDeferredLine(): LineTarget | null {
  const target = deferred;
  deferred = null;
  return target;
}
