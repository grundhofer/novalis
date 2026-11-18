import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Range, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

import i18n from "../i18n";
import { TABLE_HEADING, TABLE_NUMBER } from "../lib/tableNames";
import { report } from "../stores/ui";
import { dressTable, drawDiagram, imageTarget, loadImage, mermaidLook, opensInViewer, renderTable } from "./liveBlocks";

/** A node of the parse tree (`@lezer/common`, which is not a dependency of its own here). */
type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

/**
 * The live preview (`Cmd+E`, ADR-0059, replacing the read-only preview of
 * ADR-0020): the note stays in the editor and stays its source — every
 * byte typed is the byte saved, nothing is re-serialized — but the markers
 * step aside. Headings lose their `#`, emphasis and code their marks, a
 * link shows its words, a `[[link]]` its name, a list its bullet, a quote
 * its line; an image, a table and a ```mermaid fence are drawn.
 *
 * Wherever a selection touches an element its source comes back, so it is
 * edited as written: inline elements (emphasis, code, links, images) when a
 * cursor is inside or beside them, line markers (`#`, `>`, `-`, a rule)
 * when a cursor is on their line, a table or a diagram when a cursor is in
 * it — a click on the drawing puts it there. A plain click on a link that
 * shows only its words follows it, as `Cmd`-click does in the source.
 *
 * Read off the parse tree like the decorated source (decorations.ts), so
 * the two can only disagree about looks, never about the text.
 */

// ---- where the source shows -------------------------------------------------

/** Whether a selection range touches `from`–`to`, its ends included. */
function touched(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/** Whether a selection range touches the line `pos` is on. */
function lineTouched(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  return touched(state, line.from, line.to);
}

const hidden = Decoration.replace({});

/** `from`–`to`, and the one space after it when there is one. */
function withSpace(state: EditorState, from: number, to: number): [number, number] {
  return state.sliceDoc(to, to + 1) === " " ? [from, to + 1] : [from, to];
}

// ---- inline widgets ---------------------------------------------------------

class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  override toDOM(): HTMLElement {
    const bullet = document.createElement("span");
    bullet.className = "nv-live-bullet";
    bullet.textContent = "•";
    return bullet;
  }
}

class RuleWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  override toDOM(): HTMLElement {
    const rule = document.createElement("span");
    rule.className = "nv-live-rule";
    return rule;
  }
}

/**
 * An image from the vault, its alt text until the bytes are there (or for
 * good, for a web address: nothing is fetched). A click opens a picture the
 * viewer shows (ADR-0025); any other click puts the cursor on its source.
 */
class ImageWidget extends WidgetType {
  private stop: (() => void) | null = null;

  constructor(
    private readonly notePath: string,
    private readonly source: string,
    private readonly alt: string,
  ) {
    super();
  }

  override eq(other: ImageWidget): boolean {
    return other.source === this.source && other.alt === this.alt && other.notePath === this.notePath;
  }

  override toDOM(view: EditorView): HTMLElement {
    const img = document.createElement("img");
    img.className = "nv-live-image";
    img.alt = this.alt;
    const target = imageTarget(this.notePath, this.source);
    if (target) {
      if (opensInViewer(target)) img.dataset.open = this.source;
      this.stop = loadImage(img, target, () => view.requestMeasure());
    }
    return img;
  }

  override destroy(): void {
    this.stop?.();
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

// ---- the inline layer -------------------------------------------------------

const EMPHASIS = new Set(["Emphasis", "StrongEmphasis", "Strikethrough", "InlineCode"]);
const MARKS = new Set(["EmphasisMark", "StrikethroughMark", "CodeMark"]);

function inline(view: EditorView, notePath: string): DecorationSet {
  const { state } = view;
  const ranges: Range<Decoration>[] = [];
  const hide = (from: number, to: number) => {
    if (to > from) ranges.push(hidden.range(from, to));
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (ref) => {
        const name = ref.name;
        const node = ref.node;
        if (name === "Table" || name === "FencedCode" || name === "FrontmatterMark" || name === "Frontmatter") {
          // A block's own layer (below), or source that keeps its marks.
          return false;
        }
        if (name === "HeaderMark") {
          // An ATX heading's `#`s, opening or closing; a Setext underline stays.
          if (!/^ATXHeading/.test(node.parent?.name ?? "") || lineTouched(state, ref.from)) return;
          // The opening marks take their space along; closing ones only themselves.
          if (ref.from === node.parent?.from) hide(...withSpace(state, ref.from, ref.to));
          else hide(ref.from, ref.to);
        } else if (name === "QuoteMark") {
          if (!lineTouched(state, ref.from)) hide(...withSpace(state, ref.from, ref.to));
        } else if (name === "ListMark") {
          if (lineTouched(state, ref.from) || node.parent?.parent?.name !== "BulletList") return;
          // A task's box stands where the bullet was.
          if (node.nextSibling?.name === "Task") hide(...withSpace(state, ref.from, ref.to));
          else ranges.push(Decoration.replace({ widget: new BulletWidget() }).range(ref.from, ref.to));
        } else if (name === "HorizontalRule") {
          if (!lineTouched(state, ref.from)) {
            ranges.push(Decoration.replace({ widget: new RuleWidget() }).range(ref.from, ref.to));
          }
        } else if (MARKS.has(name)) {
          const parent = node.parent;
          if (parent && EMPHASIS.has(parent.name) && !touched(state, parent.from, parent.to)) hide(ref.from, ref.to);
        } else if (name === "Link") {
          if (touched(state, ref.from, ref.to)) return;
          const marks = childrenNamed(node, "LinkMark");
          const [open, close] = marks;
          if (!open || !close) return;
          hide(open.from, open.to);
          // `](url "title")` or `][ref]`: everything after the words.
          hide(close.from, ref.to);
        } else if (name === "Image") {
          const source = childrenNamed(node, "URL")[0];
          const marks = childrenNamed(node, "LinkMark");
          const alt = marks[0] && marks[1] ? state.sliceDoc(marks[0].to, marks[1].from) : "";
          const widget = source ? new ImageWidget(notePath, state.sliceDoc(source.from, source.to), alt) : null;
          if (!widget) return false;
          if (touched(state, ref.from, ref.to)) {
            // Its source to edit, the picture after it, so the line keeps its height.
            ranges.push(Decoration.widget({ widget, side: 1 }).range(ref.to));
          } else {
            ranges.push(Decoration.replace({ widget }).range(ref.from, ref.to));
          }
          return false;
        } else if (name === "WikiLink") {
          if (touched(state, ref.from, ref.to)) return false;
          const text = state.sliceDoc(ref.from, ref.to);
          if (!text.startsWith("[[") || !text.endsWith("]]") || text.length < 5) return false;
          const bar = text.indexOf("|");
          // `[[target|label]]` reads as its label; `[[target]]` as its target.
          hide(ref.from, bar > 2 && bar < text.length - 3 ? ref.from + bar + 1 : ref.from + 2);
          hide(ref.to - 2, ref.to);
          return false;
        } else if (name === "Autolink") {
          if (touched(state, ref.from, ref.to)) return false;
          for (const mark of childrenNamed(node, "LinkMark")) hide(mark.from, mark.to);
          return false;
        } else if (name === "Escape") {
          if (!touched(state, ref.from, ref.to)) hide(ref.from, ref.from + 1);
        }
        return undefined;
      },
    });
  }
  return Decoration.set(ranges, true);
}

function childrenNamed(node: SyntaxNode, name: string): SyntaxNode[] {
  const found: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) if (child.name === name) found.push(child);
  return found;
}

// ---- block widgets ----------------------------------------------------------

/** Asks the block layer to draw again: the colours changed under a diagram. */
const redraw = StateEffect.define<null>();

/**
 * A drawn block. A press on it puts the cursor at its start, which brings
 * its source back; a picture in it the viewer shows still opens.
 */
abstract class BlockWidget extends WidgetType {
  protected stop: (() => void) | null = null;

  constructor(protected readonly source: string) {
    super();
  }

  protected frame(view: EditorView, className: string): HTMLElement {
    const host = document.createElement("div");
    host.className = `nv-live-block ${className}`;
    host.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      const image = (event.target as Element | null)?.closest<HTMLElement>("img[data-open]");
      if (image) return;
      event.preventDefault();
      const at = view.posAtDOM(host);
      view.dispatch({ selection: { anchor: at }, scrollIntoView: false });
      view.focus();
    });
    return host;
  }

  override destroy(): void {
    this.stop?.();
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class TableWidget extends BlockWidget {
  constructor(
    source: string,
    private readonly name: string,
    private readonly notePath: string,
  ) {
    super(source);
  }

  override eq(other: TableWidget): boolean {
    return other.source === this.source && other.name === this.name && other.notePath === this.notePath;
  }

  override toDOM(view: EditorView): HTMLElement {
    const host = this.frame(view, "nv-live-table");
    renderTable(this.source)
      .then((html) => {
        this.stop = dressTable(host, html, this.name, this.notePath, () => view.requestMeasure());
        view.requestMeasure();
      })
      .catch((error: unknown) => {
        // The source stays readable as text, and the failure is said.
        host.textContent = this.source;
        report(error);
      });
    return host;
  }
}

class DiagramWidget extends BlockWidget {
  constructor(
    source: string,
    private readonly look: number,
  ) {
    super(source);
  }

  override eq(other: DiagramWidget): boolean {
    return other.source === this.source && other.look === this.look;
  }

  override toDOM(view: EditorView): HTMLElement {
    const host = this.frame(view, "nv-live-diagram");
    drawDiagram(host, this.source, () => view.requestMeasure());
    return host;
  }
}

/** Whole lines from the line of `from` to the line of `to`, a closing newline not counted. */
function lineSpan(state: EditorState, from: number, to: number): [number, number] {
  const first = state.doc.lineAt(from);
  let last = state.doc.lineAt(to);
  if (to > from && to === last.from && last.number > first.number) last = state.doc.line(last.number - 1);
  return [first.from, last.to];
}

/** A heading's words, without its `#`s or its underline. */
function headingText(state: EditorState, node: SyntaxNode): string {
  const text = state.sliceDoc(node.from, node.to);
  if (node.name.startsWith("Setext")) return (text.split("\n")[0] ?? "").trim();
  return text.replace(/^\s*#+\s*/, "").replace(/\s+#+\s*$/, "").trim();
}

/** The words that name a table's region, as the preview named them (`lib/tableNames.ts`). */
function tableName(heading: string | null, underHeading: number, untitled: number): string {
  const say = (key: string, n: number) =>
    i18n.t(key, { n: TABLE_NUMBER, heading: TABLE_HEADING }).split(TABLE_NUMBER).join(String(n)).split(TABLE_HEADING).join(heading ?? "");
  if (heading === null) return say("preview.tableNumbered", untitled);
  return say(underHeading === 1 ? "preview.tableUnder" : "preview.tableUnderNumbered", underHeading);
}

function blocks(state: EditorState, notePath: string, look: number): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  let heading: string | null = null;
  let underHeading = 0;
  let untitled = 0;
  syntaxTree(state).iterate({
    enter: (ref) => {
      const name = ref.name;
      if (/^(ATX|Setext)Heading/.test(name)) {
        heading = headingText(state, ref.node) || null;
        underHeading = 0;
        return false;
      }
      if (name === "Table") {
        if (heading === null) untitled += 1;
        else underHeading += 1;
        const [from, to] = lineSpan(state, ref.from, ref.to);
        if (!touched(state, from, to)) {
          const widget = new TableWidget(state.sliceDoc(ref.from, ref.to), tableName(heading, underHeading, untitled), notePath);
          ranges.push(Decoration.replace({ widget, block: true }).range(from, to));
        }
        return false;
      }
      if (name === "FencedCode") {
        const info = ref.node.getChild("CodeInfo");
        const code = ref.node.getChild("CodeText");
        if (info && code && state.sliceDoc(info.from, info.to).trim().toLowerCase() === "mermaid") {
          const [from, to] = lineSpan(state, ref.from, ref.to);
          if (!touched(state, from, to)) {
            const widget = new DiagramWidget(state.sliceDoc(code.from, code.to), look);
            ranges.push(Decoration.replace({ widget, block: true }).range(from, to));
          }
        }
        return false;
      }
      // Nothing inside a paragraph is a block.
      if (name === "Paragraph" || name === "HTMLBlock" || name === "CodeBlock") return false;
      return undefined;
    },
  });
  return Decoration.set(ranges, true);
}

/**
 * The live preview for the note at `notePath`: the inline layer as a view
 * plugin over what is in view, the blocks as a field over the whole text —
 * a decoration that replaces line breaks has to come from state.
 */
export function livePreview(notePath: string, onFollowLink: (target: string) => void): Extension {
  const field = StateField.define<{ look: number; set: DecorationSet }>({
    create: (state) => ({ look: 0, set: blocks(state, notePath, 0) }),
    update(value, tr) {
      const look = tr.effects.some((effect) => effect.is(redraw)) ? value.look + 1 : value.look;
      if (look === value.look && !tr.docChanged && !tr.selection && syntaxTree(tr.state) === syntaxTree(tr.startState)) {
        return value;
      }
      return { look, set: blocks(tr.state, notePath, look) };
    },
    provide: (f) => EditorView.decorations.from(f, (value) => value.set),
  });

  const layer = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = inline(view, notePath);
      }

      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          syntaxTree(update.state) !== syntaxTree(update.startState)
        ) {
          this.decorations = inline(update.view, notePath);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );

  // A change of mode or tone draws the diagrams again in the new colours
  // (spec/09 §17.1, D102 (31)); `data-theme` carries the resolved mode,
  // `system` included (stores/ui.ts).
  const colours = ViewPlugin.fromClass(
    class {
      private readonly observer: MutationObserver;
      private look = JSON.stringify(mermaidLook());

      constructor(view: EditorView) {
        this.observer = new MutationObserver(() => {
          const look = JSON.stringify(mermaidLook());
          if (look === this.look) return;
          this.look = look;
          view.dispatch({ effects: redraw.of(null) });
        });
        this.observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-theme", "data-sb-tone"],
        });
      }

      destroy(): void {
        this.observer.disconnect();
      }
    },
  );

  const follow = EditorView.domEventHandlers({
    mousedown(event, view) {
      // `Cmd`-click is the source's gesture (setup.ts) and stays it.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      const target = liveTargetAt(view.state, pos, event.target as Element | null);
      if (!target) return false;
      event.preventDefault();
      onFollowLink(target);
      return true;
    },
  });

  return [field, layer, colours, follow, EditorView.editorAttributes.of({ class: "nv-live" })];
}

// ---- following what shows -------------------------------------------------

/**
 * What a plain press at `pos` follows in the live preview, or `null`: a
 * link that shows only its words — `[words](target)`, a `[[link]]`, an
 * `<autolink>` — or a picture the viewer opens. A link whose source shows
 * is being edited, and the press places the cursor.
 */
export function liveTargetAt(state: EditorState, pos: number, element: Element | null): string | null {
  const image = element?.closest<HTMLElement>("img[data-open]");
  if (image?.dataset.open) return image.dataset.open;
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
  for (; node; node = node.parent) {
    if (node.name === "Link" || node.name === "WikiLink" || node.name === "Autolink") break;
  }
  if (!node || touched(state, node.from, node.to)) return null;
  if (node.name === "WikiLink") return state.sliceDoc(node.from, node.to);
  const url = node.getChild("URL");
  return url ? state.sliceDoc(url.from, url.to) : null;
}
