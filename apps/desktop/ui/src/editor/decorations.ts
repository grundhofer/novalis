import { syntaxTree } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import type { EditorState, Extension, Range, StateCommand } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

/**
 * The line-level half of decorated source mode: heading sizes, quote and
 * frontmatter lines, and the one click in the app that writes into a note —
 * the task checkbox (PLAN.md §4.3, docs/KEYMAP.md "Mouse gestures").
 *
 * The inline half (emphasis, links, tags, markers) is a `HighlightStyle` in
 * `theme.ts`, read straight off the parse tree.
 */

const headingLine = [1, 2, 3, 4, 5, 6].map((level) =>
  Decoration.line({ class: `nv-heading-${Math.min(level, 3)}` }),
);
const quoteLine = Decoration.line({ class: "nv-quote" });
const frontmatterLine = Decoration.line({ class: "nv-frontmatter" });
const taskDoneLine = Decoration.line({ class: "nv-task-done" });

class CheckboxWidget extends WidgetType {
  constructor(private readonly checked: boolean) {
    super();
  }

  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  override toDOM(): HTMLElement {
    const box = document.createElement("span");
    box.className = this.checked ? "nv-checkbox nv-checked" : "nv-checkbox";
    box.dataset.checkbox = this.checked ? "1" : "0";
    return box;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

function build(view: EditorView): DecorationSet {
  const marks: Range<Decoration>[] = [];
  const lines: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        if (/^ATXHeading[1-6]$/.test(name)) {
          const level = Number(name.slice(-1));
          const deco = headingLine[level - 1];
          if (deco) lines.push(deco.range(view.state.doc.lineAt(node.from).from));
        } else if (name === "Blockquote") {
          const first = view.state.doc.lineAt(node.from).number;
          const last = view.state.doc.lineAt(node.to).number;
          for (let n = first; n <= last; n += 1) {
            lines.push(quoteLine.range(view.state.doc.line(n).from));
          }
        } else if (name === "FrontmatterMark" || name === "Frontmatter") {
          const first = view.state.doc.lineAt(node.from).number;
          const last = view.state.doc.lineAt(Math.min(node.to, view.state.doc.length)).number;
          for (let n = first; n <= last; n += 1) {
            lines.push(frontmatterLine.range(view.state.doc.line(n).from));
          }
        } else if (name === "TaskMarker") {
          const text = view.state.doc.sliceString(node.from, node.to);
          const checked = /\[[xX]\]/.test(text);
          marks.push(
            Decoration.replace({ widget: new CheckboxWidget(checked) }).range(node.from, node.to),
          );
          if (checked) lines.push(taskDoneLine.range(view.state.doc.lineAt(node.from).from));
        }
      },
    });
  }

  // Line decorations must be sorted with the marks in one set; building them
  // separately and concatenating keeps the `iterate` order irrelevant.
  return Decoration.set([...lines, ...marks], true);
}

export const decorations: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = build(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = build(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    eventHandlers: {
      mousedown(event, view) {
        const target = event.target as HTMLElement | null;
        if (!target?.classList.contains("nv-checkbox")) return false;
        const pos = view.posAtDOM(target);
        toggleTaskAt(view, pos);
        event.preventDefault();
        return true;
      },
    },
  },
);

/** Flip `[ ]` ⇄ `[x]` on the line containing `pos`. */
function toggleTaskAt(view: EditorView, pos: number): boolean {
  const line = view.state.doc.lineAt(pos);
  const match = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/.exec(line.text);
  if (!match) return false;
  const at = line.from + (match[1] as string).length;
  view.dispatch({
    changes: { from: at, to: at + 1, insert: match[2] === " " ? "x" : " " },
  });
  return true;
}

/** `Cmd+Enter`: toggle the checkbox on every line a cursor is on. */
export const toggleCheckbox: StateCommand = ({ state, dispatch }) => {
  const changes = [];
  const seen = new Set<number>();
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.head);
    if (seen.has(line.number)) continue;
    seen.add(line.number);
    const match = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/.exec(line.text);
    if (!match) continue;
    const at = line.from + (match[1] as string).length;
    changes.push({ from: at, to: at + 1, insert: match[2] === " " ? "x" : " " });
  }
  if (changes.length === 0) return false;
  dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input.toggleCheckbox" }));
  return true;
};

/**
 * `Cmd+B` / `Cmd+I`: wrap every selection in `marker`, or unwrap it when the
 * marker is already there. The only two formatting commands in v1 (§4.3).
 */
export function wrapSelection(marker: string): StateCommand {
  const width = marker.length;
  return ({ state, dispatch }) => {
    const spec = state.changeByRange((range) => {
      const before = state.sliceDoc(Math.max(0, range.from - width), range.from);
      const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + width));
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: range.from - width, to: range.from },
            { from: range.to, to: range.to + width },
          ],
          range: EditorSelection.range(range.from - width, range.to - width),
        };
      }
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + width, range.to + width),
      };
    });
    dispatch(state.update(spec, { scrollIntoView: true, userEvent: "input.wrap" }));
    return true;
  };
}

/** The node at `pos` that is a link, if any, and its raw text. */
export function linkAt(state: EditorState, pos: number): string | null {
  let found: string | null = null;
  syntaxTree(state).iterate({
    from: pos,
    to: pos,
    enter: (node) => {
      if (node.name === "WikiLink") {
        found = state.sliceDoc(node.from, node.to);
      } else if (node.name === "URL") {
        found = state.sliceDoc(node.from, node.to);
      }
    },
  });
  return found;
}
