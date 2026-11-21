// panes.ts: the width of a side pane inside its limits, as the line beside it (Divider.tsx) sets it.

export type Limits = { min: number; start: number; max: number };

/** Dragging this far under the least width closes the pane. */
export const COLLAPSE_AT = 48;

/** A width inside the limits, in whole px. */
export function clamp(width: number, { min, max }: Limits): number {
  return Math.round(Math.min(max, Math.max(min, width)));
}

/** The width a key asks for: the arrows step by 8 px (32 px with ⇧), Home and End jump to the limits. `grow` is the
 *  direction in which Arrow right widens the pane: 1 for a pane at the start, -1 for one at the end. */
export function keyWidth(key: string, shift: boolean, width: number, limits: Limits, grow: 1 | -1): number | null {
  const step = (shift ? 32 : 8) * grow;
  if (key === "ArrowRight") return clamp(width + step, limits);
  if (key === "ArrowLeft") return clamp(width - step, limits);
  if (key === "Home") return limits.min;
  if (key === "End") return limits.max;
  return null;
}
