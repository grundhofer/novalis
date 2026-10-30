import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import type { Mermaid } from "mermaid";

import { commands, unwrap } from "../ipc/client";
import { mimeOf, viewKind } from "../lib/fileTypes";
import { resolveDestination } from "../lib/links";
import { isExternal } from "../lib/paths";
import { resolveLine, takeDeferredLine } from "../lib/editorBridge";
import { keepPosition, keptPosition } from "../lib/positions";
import { setPreviewBridge } from "../lib/previewBridge";
import { openExternal, SCHEME } from "../lib/external";
import { blockForLine, parseBlockSpan, toggleMarkInSource, toggleTaskInSource } from "../lib/previewEdit";
import { TABLE_HEADING, TABLE_NUMBER, type TableWords, tableNames } from "../lib/tableNames";
import { useEditorSave } from "../stores/editorSave";
import { report } from "../stores/ui";
import Icon, { externalLinkIcon } from "./Icon";
import Tool from "./Tool";
import "../styles/preview.css";

/**
 * The read-only preview of a note (`Cmd+E`, ADR-0020; PLAN.md §4.4).
 *
 * The fragment is the core's (`notes/render.rs`), which turns raw HTML in a
 * note into text: what lands in `innerHTML` here is only markup
 * pulldown-cmark wrote, never anything the note carried. It is rendered from
 * the buffer, not the disk, so an unsaved edit shows. Images arrive the
 * viewer's way (`read_blob`, a `blob:` URL for as long as the fragment
 * stands); a link goes through the app's `followLink` like a `Cmd`-click in
 * the editor; a ```mermaid fence becomes a diagram (owner yes 2026-09-15).
 * mermaid is its own chunk, fetched on the first diagram and never before;
 * so is the highlighter for every other fence (ADR-0022 point 8). The body
 * is sebaro's `.sb-prose` (ADR-0051; `dressFragment` and styles/preview.css).
 *
 * The editor's chords work here too (owner, 2026-09-16): `Cmd+F` opens a
 * find bar over the rendered text, `Cmd+B` and `Cmd+I` put a mark around the
 * selection into the source (`lib/previewEdit`), and the pane re-renders
 * from the buffer like after any edit. Both reach the pane through
 * `lib/previewBridge`, registered while the pane is mounted.
 */

/** A text change re-renders after this pause: a sync burst is one render. */
const RENDER_DEBOUNCE_MS = 150;
/** Keys that alone are no action: the place line of a jump stays through them. */
const LONE_KEYS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock", "Fn"]);

/** `https:`, `mailto:` and the like — the test `lib/links.ts` uses. */

/** The same lines as Viewer.tsx: base64 from `read_blob` to bytes. */
function decode(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A percent-encoded destination as written; a stray `%` is not an escape. */
function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

let mermaidModule: Promise<Mermaid> | null = null;
/** The colours mermaid was last configured with, as one string. */
let mermaidConfigured: string | null = null;
/** Diagram ids must differ within the document; one counter for the session. */
let diagramSerial = 0;
/** Footnote ids too: each fragment's notes get a prefix of their own. */
let footnoteSerial = 0;
/** Stands for the number in the footnote words until a note is numbered. */
const NUMBER = "\u0000";
/** Stands for the place of a further citation („(2)“) in the footnote words. */
const PLACE = "\u0001";

const range = (prefix: string, count: number) => Array.from({ length: count }, (_, at) => `${prefix}${at}`);

/**
 * mermaid's theme variables ← sebaro's token (without `--sb-`), the table of
 * spec/09 §17.1 (D102 (31)): no fills (boxes, groups, notes on `bg`), every
 * word in `text`, frames, edges and arrows in `border-strong`, groups, life
 * lines and grids in `border`, the author's own groups (pie slices,
 * branches) in the category tones.
 */
const MERMAID_ROLES: readonly (readonly [readonly string[], string])[] = [
  [
    [
      "background",
      "primaryColor",
      "secondaryColor",
      "tertiaryColor",
      "mainBkg",
      "clusterBkg",
      "edgeLabelBackground",
      "labelBackground",
      "actorBkg",
      "noteBkgColor",
      "labelBoxBkgColor",
      "sectionBkgColor",
      "altSectionBkgColor",
      ...range("cScale", 12),
      "pieStrokeColor",
      "pieSectionTextColor",
    ],
    "color-bg",
  ],
  [
    [
      "primaryTextColor",
      "secondaryTextColor",
      "tertiaryTextColor",
      "textColor",
      "titleColor",
      "nodeTextColor",
      "actorTextColor",
      "signalTextColor",
      "labelTextColor",
      "noteTextColor",
      "loopTextColor",
      ...range("cScaleLabel", 12),
      "pieTitleTextColor",
      "pieLegendTextColor",
      ...range("gitBranchLabel", 6),
    ],
    "color-text",
  ],
  [
    [
      "primaryBorderColor",
      "secondaryBorderColor",
      "tertiaryBorderColor",
      "nodeBorder",
      "actorBorder",
      "noteBorderColor",
      "labelBoxBorderColor",
      "lineColor",
      "signalColor",
      ...range("cScalePeer", 12),
      "pieOuterStrokeColor",
    ],
    "color-border-strong",
  ],
  [["clusterBorder", "actorLineColor", "gridColor"], "color-border"],
  [["fontFamily"], "font-family-ui"],
  ...[1, 2, 3, 4, 5, 6].map((n) => [[`pie${n}`, `git${n - 1}`], `category-${n}`] as const),
];

/**
 * mermaid's `base` theme in sebaro's colours, as `sebaroMermaidConfig()` of
 * spec/09 §17.1 reads them (ADR-0051 #27.6, D102 (31)): off the root when a
 * diagram is drawn, so the appearance and the tone in use are the ones
 * drawn; chart words in the caption size, slices at full opacity, and a
 * branch name in `text` on `bg` in a box framed in its tone (`themeCSS`). A
 * token the root does not carry (no stylesheet, as in the tests) is left to
 * mermaid.
 */
function mermaidLook(): { themeVariables: Record<string, string | boolean>; themeCSS?: string } {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const token = (name: string) => style.getPropertyValue(`--sb-${name}`).trim();
  const chosen = root.dataset.theme;
  const dark =
    chosen === "dark" ||
    (chosen !== "light" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const themeVariables: Record<string, string | boolean> = { darkMode: dark, pieOpacity: "1" };
  for (const [names, name] of MERMAID_ROLES) {
    const value = token(name);
    if (value) for (const variable of names) themeVariables[variable] = value;
  }
  const rootSize = parseFloat(style.fontSize);
  if (rootSize > 0) themeVariables.fontSize = `${rootSize * 0.875}px`;
  const bg = token("color-bg");
  const tones = [1, 2, 3, 4, 5, 6].map((n) => token(`category-${n}`));
  if (!bg || tones.some((tone) => !tone)) return { themeVariables };
  return {
    themeVariables,
    themeCSS:
      `.branchLabelBkg { fill: ${bg}; stroke-width: 2px; } ` +
      tones.map((tone, at) => `.branchLabelBkg.label${at} { stroke: ${tone}; }`).join(" "),
  };
}

/**
 * mermaid, loaded once and configured with the current colours. `strict`
 * has it sanitise its own SVG through DOMPurify and drop click bindings.
 * `initialize` replaces the whole configuration, so it runs again only when
 * the colours changed under a note that is open.
 */
async function mermaidFor(): Promise<Mermaid> {
  mermaidModule ??= import("mermaid").then((m) => m.default);
  const mermaid = await mermaidModule;
  const theme = mermaidLook();
  const look = JSON.stringify(theme);
  if (mermaidConfigured !== look) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", ...theme });
    mermaidConfigured = look;
  }
  return mermaid;
}

/**
 * The fragment with its fences highlighted (ADR-0022 point 8): every
 * `<pre><code class="language-…">` that names a grammar gets the editor's
 * code rules as classes (`editor/fences`, styles/preview.css); a fence that
 * names none, and a ```mermaid fence (a diagram, below), stay as the core
 * wrote them. Done before the fragment is shown, so the code never flashes
 * plain and the find marks see the final text. The module comes with
 * `await import()`: this chunk keeps no CodeMirror import, and a fragment
 * without a fence never loads it. The `<template>` is inert — nothing in
 * it loads or runs — and what leaves it is the core's markup plus spans.
 */
async function highlightFences(html: string): Promise<string> {
  if (!html.includes('<code class="language-')) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  const fences = template.content.querySelectorAll('pre > code[class^="language-"]:not(.language-mermaid)');
  if (fences.length === 0) return html;
  let highlightFence: typeof import("../editor/fences").highlightFence;
  try {
    ({ highlightFence } = await import("../editor/fences"));
  } catch (error) {
    // The fragment is worth more than its colours: shown plain, and said.
    report(error);
    return html;
  }
  for (const code of fences) {
    try {
      const runs = await highlightFence(code.textContent ?? "", code.className.slice("language-".length));
      if (!runs) continue;
      const fragment = code.ownerDocument.createDocumentFragment();
      for (const { text, classes } of runs) {
        if (!classes) {
          fragment.append(text);
          continue;
        }
        const span = code.ownerDocument.createElement("span");
        span.className = classes;
        span.textContent = text;
        fragment.append(span);
      }
      code.replaceChildren(fragment);
    } catch (error) {
      // A grammar that will not load leaves its fence plain, and says so.
      report(error);
    }
  }
  return template.innerHTML;
}

type Rendered = { path: string; html: string };

/**
 * The core's fragment in sebaro's parts, where its markup alone does not
 * reach them (ADR-0051 #27.5, DAT-05, EIN-03); the rest — headings, links,
 * quotes, rules, images, inline code — `.sb-prose` and sebaro's element
 * rules give it as written.
 *
 * - A code block is the bare `pre.sb-code` (spec/02 §3.10), focusable so a
 *   wide one scrolls by keyboard (TXT-08), and without a copy button.
 * - A table is `table.sb-table` in `div.sb-table-wrap[role=region]
 *   [tabindex=0]`, so a wide one scrolls in its own frame and by keyboard
 *   (spec/02 §3.9). Markdown has no caption, so the region is named after
 *   the heading before it (`lib/tableNames.ts`, ADR-0051 #52), and a column of
 *   numbers is `.sb-num` (`numberColumns`, #53).
 * - A list item's task box is enabled — the one thing here that writes
 *   (ADR-0039); the renderer draws it disabled, which would also keep it
 *   from receiving the click `onClick` turns into the source edit — and
 *   stands in `span.sb-checkbox` for sebaro's box (2 px `border-strong`,
 *   the check in `accent`, no fill). Not a `label` around the item's words
 *   as in spec/02 §2.4: a click on the words would flip the task, and the
 *   words are text to select (`Cmd+B`).
 * - Footnotes become sebaro's (`dressFootnotes`).
 */
function dressFragment(host: HTMLElement, tableWords: TableWords, footnoteWords: FootnoteWords): void {
  for (const pre of host.querySelectorAll("pre")) {
    pre.classList.add("sb-code");
    pre.tabIndex = 0;
  }
  const names = tableNames(host, tableWords);
  for (const table of host.querySelectorAll("table")) {
    const wrap = document.createElement("div");
    wrap.className = "sb-table-wrap";
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", names.get(table) ?? "");
    wrap.tabIndex = 0;
    table.classList.add("sb-table");
    numberColumns(table);
    table.replaceWith(wrap);
    wrap.append(table);
  }
  for (const box of host.querySelectorAll<HTMLInputElement>('li[data-pos] > input[type="checkbox"]')) {
    box.disabled = false;
    const frame = document.createElement("span");
    frame.className = "sb-checkbox";
    box.replaceWith(frame);
    frame.append(box);
  }
  dressFootnotes(host, footnoteWords);
}

/** A cell that says a number: a sign, digits in groups, a decimal part, a percent. */
const NUMBER_CELL = /^[+\-\u2212]?\d{1,3}(?:[\u00a0\u202f ,.']?\d{3})*(?:[.,]\d+)?\s?[%\u2030]?$/u;
/**
 * What a cell may say instead of a number (spec/02 §3.9, spec/07 §3.1):
 * nothing, „keine Angabe“, or its English „not given“ (ADR-0051 #64).
 */
const NO_VALUE = /^(?:keine Angabe|not given)?$/iu;

/**
 * Number columns (spec/02 §3.9, ADR-0051 #53): a column whose body cells
 * are all numbers, empty ones aside, gets `.sb-num` on its cells and its
 * head, which sebaro.css sets end-aligned with tabular figures. An
 * alignment the Markdown writes for the column (`style="text-align: …"`
 * from the renderer) wins: such a column stays as it is.
 */
function numberColumns(table: HTMLTableElement): void {
  const rows = [...table.rows];
  const body = [...table.tBodies].flatMap((section) => [...section.rows]);
  const width = Math.max(0, ...rows.map((row) => row.cells.length));
  for (let column = 0; column < width; column += 1) {
    const cells = rows.map((row) => row.cells[column]).filter((cell) => cell !== undefined);
    if (cells.some((cell) => cell.style.textAlign !== "" || cell.hasAttribute("align"))) continue;
    const values = body.map((row) => row.cells[column]?.textContent?.trim() ?? "");
    const said = values.filter((value) => !NO_VALUE.test(value));
    if (said.length === 0 || !said.every((value) => NUMBER_CELL.test(value))) continue;
    for (const cell of cells) cell.classList.add("sb-num");
  }
}

/**
 * The footnotes' words; `NUMBER` in `ref`, `back` and `backMore` stands for
 * the number, `PLACE` in `backMore` for the citation's place („2“).
 */
interface FootnoteWords {
  title: string;
  ref: string;
  back: string;
  backMore: string;
}

/**
 * Markdown footnotes as sebaro's (spec/03 §5.2, §5.3, spec/02 §5 and §6;
 * D102 (32), ADR-0051 #40), made here from the core's markup, which stays
 * as it is for the CLI: pulldown-cmark writes a reference as
 * `sup.footnote-reference > a[href="#<label>"]` and a definition, where the
 * note's text has it, as `div.footnote-definition#<label>` led by its
 * number, with no way back.
 *
 * - A reference becomes the digit `a.sb-note-ref[role=doc-noteref]`, named
 *   „Fußnote n“, without the `sup`; digits side by side stand in
 *   `span.sb-note-refs`, which puts a comma between them.
 * - The definitions leave their places for the list at the end of the
 *   text, `section.sb-notes[role=doc-endnotes]` titled „Fußnoten“, one
 *   `li.sb-note` each in the order of their numbers (the renderer's, in
 *   order of first appearance), the text in `.sb-note__body`, led by
 *   `a.sb-note__back[role=doc-backlink]` „Zurück zur Stelle n“ to its
 *   reference. A note cited more than once has a back link per citation,
 *   one under the other in `span.sb-note__backs`: „n“, then „nb“, „nc“,
 *   named „Zurück zur Stelle n (2)“, „(3)“ (spec/03 §5.3, sebaro D108
 *   NV-X3). A note no reference points at keeps its number as plain text,
 *   `span.sb-note__back` without `href` (NV-X5).
 *
 * Ids are the fragment's own (`novalis-fn-<serial>-…`), never the note's
 * labels, so they are unique in the document. The title is no heading of
 * the note's contents: those come from the source (`lib/headings`). No
 * popover under 1024 px: sebaro's `sb-notes.js` is optional and not loaded.
 */
function dressFootnotes(host: HTMLElement, words: FootnoteWords): void {
  const definitions = [...host.querySelectorAll<HTMLElement>("div.footnote-definition")];
  if (definitions.length === 0) return;
  footnoteSerial += 1;
  const base = `novalis-fn-${footnoteSerial}`;
  const say = (template: string, number: string, place = "") =>
    template.split(NUMBER).join(number).split(PLACE).join(place);
  type Note = { item: HTMLLIElement; number: string; refs: HTMLAnchorElement[] };
  const notes: Note[] = [];
  /**
   * The first definition of a label is the one its references point at;
   * labels match regardless of case, as the parser matches them, though
   * its `href` keeps the reference's spelling.
   */
  const byLabel = new Map<string, Note>();
  for (const [index, definition] of definitions.entries()) {
    const label = definition.querySelector(":scope > sup.footnote-definition-label");
    const number = label?.textContent ?? "";
    label?.remove();
    const item = document.createElement("li");
    item.className = "sb-note";
    item.id = `${base}-note-${index + 1}`;
    const body = document.createElement("div");
    body.className = "sb-note__body";
    body.append(...definition.childNodes);
    item.append(body);
    const note: Note = { item, number, refs: [] };
    notes.push(note);
    const key = definition.id.toLowerCase();
    if (!byLabel.has(key)) byLabel.set(key, note);
    definition.remove();
  }

  for (const sup of host.querySelectorAll("sup.footnote-reference")) {
    const link = sup.querySelector("a[href^='#']");
    const note = byLabel.get(link?.getAttribute("href")?.slice(1).toLowerCase() ?? "");
    if (!note) continue;
    const ref = document.createElement("a");
    ref.className = "sb-note-ref";
    ref.setAttribute("role", "doc-noteref");
    ref.setAttribute("href", `#${note.item.id}`);
    ref.id = `${note.item.id.replace("-note-", "-ref-")}-${note.refs.length + 1}`;
    ref.setAttribute("aria-label", say(words.ref, note.number));
    ref.textContent = note.number;
    sup.replaceWith(ref);
    note.refs.push(ref);
    const before = ref.previousSibling;
    if (before instanceof HTMLElement && before.matches("a.sb-note-ref, span.sb-note-refs")) {
      let group = before;
      if (before.matches("a.sb-note-ref")) {
        group = document.createElement("span");
        group.className = "sb-note-refs";
        before.replaceWith(group);
        group.append(before);
      }
      group.append(ref);
    }
  }

  const section = document.createElement("section");
  section.className = "sb-notes";
  section.setAttribute("role", "doc-endnotes");
  section.setAttribute("aria-labelledby", `${base}-title`);
  const title = document.createElement("h2");
  title.className = "sb-notes__title";
  title.id = `${base}-title`;
  title.textContent = words.title;
  const list = document.createElement("ol");
  list.className = "sb-notes__list";
  /** The back link to one citation: „1“, then „1b“, „1c“ … (spec/03 §5.3). */
  const backTo = (note: Note, ref: HTMLAnchorElement, index: number) => {
    const back = document.createElement("a");
    back.className = "sb-note__back";
    back.setAttribute("role", "doc-backlink");
    back.setAttribute("href", `#${ref.id}`);
    const place = String(index + 1);
    back.setAttribute("aria-label", index === 0 ? say(words.back, note.number) : say(words.backMore, note.number, place));
    back.textContent = index === 0 ? note.number : `${note.number}${index < 26 ? String.fromCharCode(97 + index) : place}`;
    return back;
  };
  for (const note of notes.sort((a, b) => Number(a.number) - Number(b.number))) {
    let back: HTMLElement;
    if (note.refs.length > 1) {
      back = document.createElement("span");
      back.className = "sb-note__backs";
      back.append(...note.refs.map((ref, index) => backTo(note, ref, index)));
    } else if (note.refs[0]) {
      back = backTo(note, note.refs[0], 0);
    } else {
      back = document.createElement("span");
      back.className = "sb-note__back";
      back.textContent = note.number;
    }
    note.item.prepend(back);
    list.append(note.item);
  }
  section.append(title, list);
  host.append(section);
}

// ---- find -------------------------------------------------------------------
// The hits are DOM, not state: they are `<mark>`s inside the fragment the
// layout effect owns, and they have to be made again every time that
// fragment is written. So the count is written the same way — read off the
// marks after each pass, into a span React leaves alone — rather than through
// state an effect would have to set.

/** The marks in the fragment and which of them is current. */
interface Hits {
  marks: HTMLElement[];
  current: number;
  /** The query the marks were made for. */
  query: string;
}

/** What the count needs of `t`; the rest of `useTranslation` stays out. */
type Translate = (key: string, values?: Record<string, unknown>) => string;

/**
 * Every occurrence of `query` in the fragment's text wrapped in sebaro's
 * `mark.sb-mark` (FAR-12: the fill with its 2 px edge at the foot).
 */
function markHits(host: HTMLElement, query: string): HTMLElement[] {
  if (!query) return [];
  // A substring, not a pattern: the editor's find is one too until the user
  // asks for regex, and the preview has no such switch.
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  // Collected first: splitting a node while walking would visit its
  // remainder again.
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // A `<mark>` is HTML; inside a diagram's SVG it would show nothing.
    if (!node.parentElement?.closest(".preview-diagram")) nodes.push(node as Text);
  }
  const marks: HTMLElement[] = [];
  for (const node of nodes) {
    let rest = node;
    for (let match = pattern.exec(rest.data); match; match = pattern.exec(rest.data)) {
      const hit = rest.splitText(match.index);
      rest = hit.splitText(match[0].length);
      const mark = document.createElement("mark");
      mark.className = "sb-mark";
      hit.replaceWith(mark);
      mark.append(hit);
      marks.push(mark);
    }
  }
  return marks;
}

/** The fragment as it was before `markHits`, its text nodes rejoined. */
function unwrapHits(host: HTMLElement): void {
  for (const mark of host.querySelectorAll("mark.sb-mark")) mark.replaceWith(...mark.childNodes);
  // Rejoined, so the next pass sees "Welt" and not "We" beside "lt".
  host.normalize();
}

/**
 * Make hit `index` the current one — clamped, scrolled to — and say where we
 * are: the current hit is `aria-current="true"` (its 3 px `text` edge), the
 * count „Treffer 1 von 2“ in words (FAR-12).
 */
function showHit(hits: Hits, index: number, count: HTMLElement | null, t: Translate): void {
  const n = hits.marks.length;
  hits.marks[hits.current]?.removeAttribute("aria-current");
  hits.current = n === 0 ? 0 : Math.max(0, Math.min(index, n - 1));
  const mark = hits.marks[hits.current];
  if (mark) {
    mark.setAttribute("aria-current", "true");
    // jsdom has no layout, and no `scrollIntoView` (ADR-0011).
    if (typeof mark.scrollIntoView === "function") mark.scrollIntoView({ block: "center" });
  }
  if (!count) return;
  count.textContent =
    n > 0
      ? t("editor.find.matchCount", { current: hits.current + 1, count: n })
      : hits.query
        ? t("editor.find.noMatches")
        : "";
}

/**
 * Scroll the block a source line starts in to the middle of the pane — the
 * preview's answer to the editor's `goToLine`, block-exact rather than
 * line-exact, since a rendered block has no lines. Nothing to do when the
 * line is past the text or the fragment has no tagged block.
 */
function showLine(host: HTMLElement, text: string, line: number, lit = true): void {
  const blocks = [...host.querySelectorAll<HTMLElement>("[data-pos]")];
  const spans = blocks.map((block) => parseBlockSpan(block.getAttribute("data-pos")) ?? { start: 0, end: 0 });
  const index = blockForLine(spans, text, line);
  const block = index === null ? undefined : blocks[index];
  if (!block) return;
  // jsdom has no layout, and no `scrollIntoView` (ADR-0011).
  if (typeof block.scrollIntoView === "function") block.scrollIntoView({ block: "center" });
  if (!lit) return;
  // The preview has no cursor to show where the jump landed, so the block
  // carries the place line until the next action (`light`).
  light(host, block, "preview-target");
}

/**
 * `element` wears `mark` until the next action, a key (not a lone modifier)
 * or a press (spec/02 §5, D102 (32)): the place line of a jump, or a
 * footnote's edge (`is-active`); a jump while one is lit moves it.
 */
function light(host: HTMLElement, element: Element, mark: string): void {
  for (const lit of host.querySelectorAll(`.${mark}`)) lit.classList.remove(mark);
  element.classList.add(mark);
  const past = (event: Event) => {
    if (event instanceof KeyboardEvent && LONE_KEYS.has(event.key)) return;
    element.classList.remove(mark);
    window.removeEventListener("keydown", past, true);
    window.removeEventListener("pointerdown", past, true);
  };
  window.addEventListener("keydown", past, true);
  window.addEventListener("pointerdown", past, true);
}

/**
 * Follow a link inside the fragment to `target`. A footnote's digit lands
 * on its note — the note's edge lit, focus on the note (`tabindex=-1`, no
 * ring while the edge stands, sebaro.css) so a screen reader reads it and
 * Tab goes on to its back links; a back link lands on its own digit — its
 * block lit with the place line, focus on it (spec/03 §5.3, sebaro D108
 * NV-X4, as `sb-notes.js` does). Anything else is only scrolled to, as
 * before.
 */
function jump(host: HTMLElement, target: HTMLElement): void {
  // jsdom has no layout, and no `scrollIntoView` (ADR-0011).
  if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "center" });
  if (target.matches("li.sb-note")) {
    light(host, target, "is-active");
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  } else if (target.matches("a.sb-note-ref")) {
    const block = target.closest("[data-pos]");
    if (block) light(host, block, "preview-target");
    target.focus({ preventScroll: true });
  }
}

/** The block a selection end lies in: the innermost element with a source span. */
function blockOf(node: Node | null): Element | null {
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest("[data-pos]") ?? null;
}

export default function Preview({
  path,
  onFollowLink,
}: {
  path: string;
  onFollowLink: (target: string) => void;
}) {
  const { t } = useTranslation();
  const text = useEditorSave((s) => s.docs[path]?.text);
  // Keyed by path like the viewer: switching tabs shows an empty pane, never
  // the previous note's fragment under the new tab's name.
  const [rendered, setRendered] = useState<Rendered | null>(null);
  /** Which note has a fragment on screen — the first one renders at once. */
  const shown = useRef<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  /** The note whose first fragment has been placed (`lib/positions.ts`). */
  const positioned = useRef<string | null>(null);

  const [findOpen, setFindOpen] = useState(false);
  /** The pane takes focus when the bar closes (`closeFind`). */
  const pane = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  const hits = useRef<Hits>({ marks: [], current: 0, query: "" });
  /** The bridge is registered once; it reads the note it acts on from here. */
  const pathRef = useRef(path);
  /** A string, not `t`: the fragment is written anew only when the words change. */
  const tableUnder = t("preview.tableUnder", { heading: TABLE_HEADING });
  const tableUnderNumbered = t("preview.tableUnderNumbered", { n: TABLE_NUMBER, heading: TABLE_HEADING });
  const tableNumbered = t("preview.tableNumbered", { n: TABLE_NUMBER });
  const notesTitle = t("preview.footnotes");
  const noteRef = t("preview.footnoteRef", { n: NUMBER });
  const noteBack = t("preview.footnoteBack", { n: NUMBER });
  const noteBackMore = t("preview.footnoteBackMore", { n: NUMBER, place: PLACE });

  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  // ---- the fragment --------------------------------------------------------
  useEffect(() => {
    if (text === undefined) return undefined;
    let cancelled = false;
    const run = () => {
      unwrap(commands.renderMarkdown(text))
        .then(highlightFences)
        .then((html) => {
          if (cancelled) return;
          shown.current = path;
          // The same fragment again (an edit outside the body, say) is not
          // a reason to fetch the images anew.
          setRendered((prev) => (prev?.path === path && prev.html === html ? prev : { path, html }));
        })
        .catch(report);
    };
    if (shown.current !== path) {
      run();
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(run, RENDER_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [path, text]);

  // ---- what the fragment still needs: image bytes, diagrams ----------------
  // A layout effect, so the fragment is in the DOM before the frame that
  // shows the pane: with `useEffect` the first frame would be an empty body.
  useLayoutEffect(() => {
    const host = body.current;
    if (!host || !rendered) return undefined;
    let cancelled = false;
    const urls: string[] = [];
    // The effect owns this subtree: React never renders children into it, so
    // every run starts from the fragment as the core wrote it.
    host.innerHTML = rendered.html;
    dressFragment(
      host,
      { under: tableUnder, underNumbered: tableUnderNumbered, numbered: tableNumbered },
      { title: notesTitle, ref: noteRef, back: noteBack, backMore: noteBackMore },
    );
    // A line parked for this note (a backlink's, say) is shown now that
    // there is a fragment to scroll; the editor would have taken it instead.
    const target = takeDeferredLine();
    if (target) {
      const source = useEditorSave.getState().docs[rendered.path]?.text ?? "";
      showLine(host, source, resolveLine(source, target));
    } else if (positioned.current !== rendered.path) {
      // The first fragment of this note: where the reader was (`lib/
      // positions.ts`) — the preview's own place if it was the last pane
      // read, else the editor's cursor line, shown without the light.
      const position = keptPosition(rendered.path);
      const scroller = host.parentElement;
      if (position?.last === "preview" && position.previewScroll !== undefined && scroller) {
        scroller.scrollTop = position.previewScroll;
      } else if (position?.line !== undefined) {
        showLine(host, useEditorSave.getState().docs[rendered.path]?.text ?? "", position.line, false);
      }
    }
    positioned.current = rendered.path;

    // A link that leaves the app — the web, a mail, a call — ends in the
    // external-link icon (sebaro D56); a link into the vault does not.
    for (const anchor of host.querySelectorAll("a[href]")) {
      if (SCHEME.test(anchor.getAttribute("href") ?? "")) anchor.append(externalLinkIcon(document));
    }

    // A relative `src` is a vault path the webview cannot reach; the bytes
    // come through `read_blob` like the viewer's. Until they arrive the alt
    // text shows, not a broken image for a URL nothing could serve.
    for (const img of host.querySelectorAll("img")) {
      const source = img.getAttribute("src") ?? "";
      const target = resolveDestination(rendered.path, source);
      if (!target) continue;
      img.removeAttribute("src");
      // Beside a file from outside the vault nothing was granted but the
      // file itself (ADR-0047), and a `..` past the disk's root must not
      // land in the vault: the alt text stays.
      if (isExternal(rendered.path)) continue;
      // A click opens it in the viewer (ADR-0025) — an image the viewer
      // shows, that is: an SVG would open as its XML.
      if (viewKind(target) === "image") img.dataset.open = source;
      unwrap(commands.readBlob(target))
        .then((blob) => {
          if (cancelled) return;
          const url = URL.createObjectURL(new Blob([decode(blob.base64)], { type: mimeOf(target) }));
          urls.push(url);
          img.src = url;
        })
        .catch(report);
    }

    // Each diagram keeps its source, so a change of mode or tone draws it
    // again in the new colours (spec/09 §17.1, D102 (31)); a fence mermaid
    // could not read stays a code block and is not tried again.
    const diagrams = [...host.querySelectorAll("pre > code.language-mermaid")].flatMap((code) =>
      code.parentElement ? [{ node: code.parentElement, source: code.textContent ?? "", failed: false }] : [],
    );
    let drawing = Promise.resolve();
    const draw = () => {
      drawing = drawing
        .then(async () => {
          const mermaid = await mermaidFor();
          for (const diagram of diagrams) {
            if (cancelled) return;
            if (diagram.failed) continue;
            try {
              diagramSerial += 1;
              const { svg } = await mermaid.render(`novalis-mermaid-${diagramSerial}`, diagram.source);
              if (cancelled) return;
              const drawn = document.createElement("div");
              drawn.className = "preview-diagram";
              drawn.innerHTML = svg;
              diagram.node.replaceWith(drawn);
              diagram.node = drawn;
            } catch (error) {
              // A fence mermaid cannot read stays a code block, and says why.
              diagram.failed = true;
              report(error);
            }
          }
        })
        .catch(report);
    };
    let themes: MutationObserver | null = null;
    if (diagrams.length > 0) {
      draw();
      // `data-theme` carries the resolved mode, `system` included
      // (stores/ui.ts), so a change of the system's scheme lands here too.
      themes = new MutationObserver(() => {
        if (JSON.stringify(mermaidLook()) !== mermaidConfigured) draw();
      });
      themes.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-sb-tone"] });
    }

    return () => {
      cancelled = true;
      themes?.disconnect();
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [rendered, tableUnder, tableUnderNumbered, tableNumbered, notesTitle, noteRef, noteBack, noteBackMore]);

  // ---- the hits ------------------------------------------------------------
  // After the fragment effect, so the marks go into the fragment just
  // written; the cleanup takes them out again before the next one lands and
  // when the bar closes.
  useLayoutEffect(() => {
    const host = body.current;
    if (!findOpen || !host || !rendered) return undefined;
    const state = hits.current;
    // A new query starts at its first hit; the same query over a re-rendered
    // fragment (a live edit) keeps its place.
    const current = state.query === query ? state.current : 0;
    state.marks = markHits(host, query);
    state.query = query;
    showHit(state, current, count.current, t);
    return () => {
      unwrapHits(host);
      state.marks = [];
    };
  }, [findOpen, query, rendered, t]);

  // The bar takes the chord: its text selected, so typing replaces the last
  // query, as in the editor's panel.
  useLayoutEffect(() => {
    if (!findOpen) return;
    input.current?.focus();
    input.current?.select();
  }, [findOpen]);

  const step = useCallback(
    (delta: number) => {
      // `Cmd+G` with the bar closed opens it, as in the editor.
      if (!input.current) {
        setFindOpen(true);
        return;
      }
      const state = hits.current;
      const n = state.marks.length;
      if (n > 0) showHit(state, (state.current + delta + n) % n, count.current, t);
    },
    [t],
  );

  // Focus goes to the pane before the bar goes, as the editor's panel does
  // (editor/findPanel): a focused element taken out of the page gets no
  // focusout in WebKit, and sb-tooltip.js would keep the close tool's
  // tooltip as shown and take the next Escape anywhere.
  const closeFind = () => {
    pane.current?.focus({ preventScroll: true });
    setFindOpen(false);
  };

  const onFindKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeFind();
    }
  };

  // ---- the chords (lib/previewBridge) -------------------------------------
  // Registered once per `step`; everything else the handlers need is read
  // through refs at the keystroke, never from the render that registered them.
  useEffect(() => {
    setPreviewBridge({
      find: () => {
        if (input.current) {
          input.current.focus();
          input.current.select();
        } else {
          setFindOpen(true);
        }
      },
      findNext: () => step(1),
      findPrevious: () => step(-1),
      mark: (kind) => {
        // One block, both ends in it, something between them — or the editor
        // is the honest answer (`lib/previewEdit`).
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return false;
        const block = blockOf(selection.anchorNode);
        if (!block || block !== blockOf(selection.focusNode) || !body.current?.contains(block)) return false;
        const span = parseBlockSpan(block.getAttribute("data-pos"));
        if (!span) return false;
        const notePath = pathRef.current;
        const source = useEditorSave.getState().docs[notePath]?.text;
        if (source === undefined) return false;
        const next = toggleMarkInSource(source, span, selection.toString(), kind === "bold" ? "**" : "_");
        if (next === null) return false;
        useEditorSave.getState().setText(notePath, next);
        // The fragment is about to be written anew; a selection into the old
        // one would only look like it survived.
        selection.removeAllRanges();
        return true;
      },
      goToLine: (line) => {
        const host = body.current;
        const source = useEditorSave.getState().docs[pathRef.current]?.text;
        if (host && source !== undefined) showLine(host, source, line);
      },
    });
    return () => setPreviewBridge(null);
  }, [step]);

  // ---- links ---------------------------------------------------------------
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    // A task box flips its `[ ]` in the source (ADR-0039); the pane renders
    // the new text, so the box's own toggle is not kept.
    const box = (event.target as Element | null)?.closest<HTMLInputElement>('input[type="checkbox"]');
    if (box) {
      event.preventDefault();
      const span = parseBlockSpan(box.closest("li[data-pos]")?.getAttribute("data-pos"));
      const notePath = pathRef.current;
      const doc = useEditorSave.getState().docs[notePath];
      if (!span || !doc || doc.readOnly) return;
      const next = toggleTaskInSource(doc.text, span);
      if (next !== null) useEditorSave.getState().setText(notePath, next);
      return;
    }
    const anchor = (event.target as Element | null)?.closest("a[href]");
    // An image inside a link is the link's.
    const image = (event.target as Element | null)?.closest<HTMLElement>("img[data-open]");
    if (!anchor && image?.dataset.open) {
      onFollowLink(image.dataset.open);
      return;
    }
    if (!anchor) return;
    // Nothing navigates the webview: a link is the app's business or nobody's.
    event.preventDefault();
    const href = anchor.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      // A footnote's digit, or the way back from its note.
      const host = body.current;
      const id = decodeHref(href.slice(1));
      const target = [...(host?.querySelectorAll<HTMLElement>("[id]") ?? [])].find((el) => el.id === id);
      if (host && target) jump(host, target);
      return;
    }
    if (SCHEME.test(href)) {
      // A web or mail link opens in the browser or mail app (ADR-0044).
      openExternal(href);
      return;
    }
    onFollowLink(decodeHref(href));
  };

  // Rendering is local work, the buffer is in memory: an empty pane until
  // the fragment stands, no „Wird geladen …“ (STA-06, ADR-0051 #27.8).
  if (rendered?.path !== path) return <section className="preview" aria-busy="true" />;
  return (
    <>
      {findOpen && (
        // sebaro's find bar over the text (spec/02 §4.25.2, D104 (3)), the
        // editor's (editor/findPanel) without what the rendered text has no
        // use for: its find row with the compact field and `sb-search`, the
        // count in words (`__count`, FAR-12), the 32 px tools with their
        // tooltips.
        <div className="sb-find-bar" role="search" aria-label={t("editor.find.find")}>
          <div className="sb-doc-bar" data-sb-find-row="find">
            <div className="sb-field sb-field--compact">
              <label className="sb-field__label sb-visually-hidden" htmlFor="preview-find-field">
                {t("editor.find.find")}
              </label>
              <div className="sb-field__control sb-search">
                <Icon name="search" size={20} />
                <input
                  id="preview-find-field"
                  type="search"
                  aria-keyshortcuts="Meta+F"
                  ref={input}
                  value={query}
                  placeholder={t("editor.find.placeholder")}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onFindKey}
                />
              </div>
            </div>
            <span className="sb-doc-bar__count" role="status" ref={count} />
            <Tool
              id="preview-find-previous"
              icon="chevron-up"
              label={t("editor.find.previous")}
              command="find.previous"
              onClick={() => step(-1)}
            />
            <Tool
              id="preview-find-next"
              icon="chevron-down"
              label={t("editor.find.next")}
              command="find.next"
              onClick={() => step(1)}
            />
            <Tool id="preview-find-close" icon="close" label={t("editor.find.close")} onClick={closeFind} />
          </div>
        </div>
      )}
      <section
        className="preview"
        ref={pane}
        tabIndex={-1}
        onScroll={(event) =>
          keepPosition(path, { previewScroll: event.currentTarget.scrollTop, last: "preview" })
        }
      >
        <div className="preview-body sb-prose" ref={body} onClick={onClick} />
      </section>
    </>
  );
}
