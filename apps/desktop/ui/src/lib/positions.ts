/**
 * Where each open file was left, for the session (docs/research/2026-09-20-
 * feature-gaps.md A4): the editor's selection and scroll. A tab switch and
 * a reload after a change on disk rebuild the pane; without this each of
 * them sent the reader back to the top.
 *
 * Plain data and no CodeMirror. Not saved anywhere: a new launch
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
