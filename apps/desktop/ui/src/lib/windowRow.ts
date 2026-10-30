/**
 * The height of a one-line window row (sebaro's `sb-row`, RAU-06, spec/02
 * §4.13) at the root font in use, for a list that must know its row height
 * before it draws (the virtualised tree). sebaro's row is
 * `min-block-size: var(--sb-size-control-sm)` with the `label` line inside
 * and no block padding: 32 px, or the label's line once large text makes
 * it taller (ZUG-09, ADR-0051 #24: the row stays one line, its height grows
 * with the root font). Read from the export's tokens, so no value of
 * sebaro's is copied here; without the stylesheet (tests) it is RAU-06's
 * 32 px.
 */
export function windowRowHeight(root: Element = document.documentElement): number {
  const { style, length } = tokensOf(root);
  const control = length("--sb-size-control-sm");
  const labelSize = length("--sb-type-label-size");
  const labelLine = parseFloat(style.getPropertyValue("--sb-type-label-line-height"));
  if (!Number.isFinite(control) || !Number.isFinite(labelSize) || !Number.isFinite(labelLine)) {
    return FALLBACK;
  }
  // Whole pixels: 1.4286 is 20 / 14 rounded, so the label's line is 20 px
  // at a 16 px root and 40 px at 32 px, not a hair more.
  return Math.max(control, Math.round(labelSize * labelLine));
}

/** RAU-06's one-line row, where the tokens cannot be read. */
const FALLBACK = 32;

/** The root's computed style and a reader for its length tokens in px. */
function tokensOf(root: Element): { style: CSSStyleDeclaration; length: (name: string) => number } {
  const style = getComputedStyle(root);
  const rootPx = parseFloat(style.fontSize) || 16;
  /** A token's length in px: rem against the root font, px as it is. */
  const length = (name: string): number => {
    const value = style.getPropertyValue(name).trim();
    const number = parseFloat(value);
    if (!Number.isFinite(number)) return NaN;
    return value.endsWith("rem") ? number * rootPx : number;
  };
  return { style, length };
}

/**
 * The height of one row of the CSV / TSV table (TablePreview, ADR-0051 #24,
 * R2) at the root font in use: sebaro's table cell (`sb-table`, spec/02
 * §3.9) holds one `body` line over its hairline; in the window its block
 * padding is `space-1` instead of the page's 12 px (docs/sebaro-luecken.md
 * K). 33 px at a 16 px root, 65 px at 32 px. Without the stylesheet (tests)
 * the same 33 px.
 */
export function tableRowHeight(root: Element = document.documentElement): number {
  const { style, length } = tokensOf(root);
  const bodySize = length("--sb-type-body-size");
  const bodyLine = parseFloat(style.getPropertyValue("--sb-type-body-line-height"));
  const padding = length("--sb-space-1");
  const hairline = length("--sb-border-width-hairline");
  if (![bodySize, bodyLine, padding, hairline].every(Number.isFinite)) return TABLE_FALLBACK;
  return Math.round(bodySize * bodyLine) + 2 * padding + hairline;
}

/** One body line (24), 4 px above and below, the hairline. */
const TABLE_FALLBACK = 33;
