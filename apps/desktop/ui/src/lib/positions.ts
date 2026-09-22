/**
 * Where each open file was left, for the session (docs/research/2026-09-20-
 * feature-gaps.md A4): the editor's selection and scroll, the line its cursor
 * was on, and the preview's scroll. A tab switch, `Cmd+E` and a reload after
 * a change on disk all rebuild the pane; without this each of them sent the
 * reader back to the top.
 *
 * Plain data and no CodeMirror, so the preview can read what the editor
 * left without loading the editor's chunk. Not saved anywhere: a new launch
 * starts at the top, as before (no state.json field).
 */

export interface KeptSelection {
  ranges: { anchor: number; head: number }[];
  main: number;
}

export interface KeptPosition {
  selection?: KeptSelection;
  /** The document position of the first line the editor showed. */
  editorTop?: number;
  /** 1-based line of the editor's main cursor, for the preview to show. */
  line?: number;
  previewScroll?: number;
  /** Which pane the reader was in last, so the preview knows whose place to take. */
  last?: "editor" | "preview";
}

const kept = new Map<string, KeptPosition>();

export function keptPosition(path: string): KeptPosition | undefined {
  return kept.get(path);
}

export function keepPosition(path: string, patch: KeptPosition): void {
  kept.set(path, { ...kept.get(path), ...patch });
}

/** Test seam: forget every place. */
export function forgetPositions(): void {
  kept.clear();
}
