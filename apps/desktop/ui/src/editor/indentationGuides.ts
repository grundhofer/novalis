import { getIndentUnit, indentUnit } from "@codemirror/language";
import { EditorState, type Extension, type Range, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/**
 * Indentation guides for the code presets (PLAN.md §4.3, ADR-0022): one
 * hairline per indent level, left of a line's first character.
 *
 * The plugin only counts. Each visible line gets `--nv-guides: n`, and the
 * line's background paints `n` hairlines out of a repeating gradient whose
 * period is the indent unit in columns — measured in CSS, as a glyph plus the
 * tracking `--ds-letter-spacing-mono` adds, so the guides sit on the columns
 * at every font size without a pixel being read. A tab is `tab-size` columns
 * wide for the browser and for `getIndentUnit`, so a Makefile lines up too.
 */

/** Leading whitespace in columns, a tab to the next stop; -1 for a blank line. */
function indentOf(line: string, tabSize: number): number {
  let column = 0;
  for (let i = 0; i < line.length; i += 1) {
    const code = line.charCodeAt(i);
    if (code === 32) column += 1;
    else if (code === 9) column += tabSize - (column % tabSize);
    else return column;
  }
  return -1;
}

/** How far a blank run looks for the content line that decides its guides. */
const LOOKAROUND = 200;

/**
 * Guides for lines `first…last` of `doc`. A content line gets one per started
 * indent unit. A blank run belongs to the block around it: judged by the
 * nearest content lines above and below (the rule VS Code uses), so a gap
 * inside a block keeps the block's guides and a gap between two top-level
 * items has none.
 */
export function indentLevels(doc: Text, first: number, last: number, unit: number, tabSize: number): number[] {
  const columns = (n: number): number => indentOf(doc.line(n).text, tabSize);
  let above = -1;
  for (let n = first - 1; n >= Math.max(1, first - LOOKAROUND); n -= 1) {
    above = columns(n);
    if (above >= 0) break;
  }
  const levels: number[] = [];
  let n = first;
  while (n <= last) {
    const own = columns(n);
    if (own >= 0) {
      levels.push(Math.ceil(own / unit));
      above = own;
      n += 1;
      continue;
    }
    // A blank run: `end` is the content line that closes it, or one past the
    // lookaround when none does.
    const bound = Math.min(doc.lines, n + LOOKAROUND);
    let end = n + 1;
    let below = -1;
    for (; end <= bound; end += 1) {
      below = columns(end);
      if (below >= 0) break;
    }
    const level =
      above < 0 || below < 0
        ? 0
        : above < below
          ? Math.floor(above / unit) + 1
          : above === below
            ? Math.ceil(above / unit)
            : Math.floor(below / unit) + 1;
    for (const stop = Math.min(end - 1, last); n <= stop; n += 1) levels.push(level);
  }
  return levels;
}

const guideLines = new Map<number, Decoration>();

function guideLine(level: number): Decoration {
  let deco = guideLines.get(level);
  if (!deco) {
    deco = Decoration.line({ attributes: { style: `--nv-guides:${level}` } });
    guideLines.set(level, deco);
  }
  return deco;
}

function build(view: EditorView): DecorationSet {
  const { doc, tabSize } = view.state;
  const unit = getIndentUnit(view.state);
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    const first = doc.lineAt(from).number;
    indentLevels(doc, first, doc.lineAt(to).number, unit, tabSize).forEach((level, i) => {
      if (level > 0) ranges.push(guideLine(level).range(doc.line(first + i).from));
    });
  }
  return Decoration.set(ranges, true);
}

export const indentationGuides: Extension = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = build(view);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
  EditorView.editorAttributes.compute([indentUnit, EditorState.tabSize], (state) => ({
    style: `--nv-indent: calc(${getIndentUnit(state)} * (1ch + var(--ds-letter-spacing-mono)))`,
  })),
  EditorView.baseTheme({
    ".cm-line": {
      backgroundImage:
        "repeating-linear-gradient(to right, var(--ds-color-border-default) 0, var(--ds-color-border-default) 1px, transparent 1px, transparent var(--nv-indent))",
      backgroundSize: "calc(var(--nv-guides, 0) * var(--nv-indent)) 100%",
      backgroundRepeat: "no-repeat",
      backgroundOrigin: "content-box",
    },
  }),
];
