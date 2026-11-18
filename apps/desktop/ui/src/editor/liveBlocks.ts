import type { Mermaid } from "mermaid";

import { commands, unwrap } from "../ipc/client";
import { mimeOf, viewKind } from "../lib/fileTypes";
import { resolveDestination } from "../lib/links";
import { isExternal } from "../lib/paths";
import { report } from "../stores/ui";

/**
 * What the live preview (ADR-0059) draws in place of a block's source: an
 * image from the vault, a table through the core's renderer, a ```mermaid
 * fence as its diagram. Moved here from the read-only preview it replaces
 * (ADR-0020), with the same rules: the core's fragment carries no HTML the
 * note wrote (`notes/render.rs`), an image's bytes come through `read_blob`
 * and never from the network, mermaid is its own chunk, loaded on the first
 * diagram, in sebaro's colours.
 */

/** base64 from `read_blob` to bytes, as the viewer has it. */
function decode(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---- images -----------------------------------------------------------------

/**
 * The vault file an image destination names, or `null`: a web address is
 * never fetched (the privacy rule), and beside a file from outside the vault
 * nothing was granted but the file itself (ADR-0047).
 */
export function imageTarget(notePath: string, source: string): string | null {
  if (isExternal(notePath)) return null;
  return resolveDestination(notePath, source);
}

/** Whether the viewer shows `target` as a picture (an SVG would open as XML). */
export function opensInViewer(target: string): boolean {
  return viewKind(target) === "image";
}

/**
 * Fill `img` with the bytes of `target`; the returned function lets the
 * URL go. Until the bytes arrive the alt text shows. `done` runs once the
 * picture has its size, so the editor can measure its line again.
 */
export function loadImage(img: HTMLImageElement, target: string, done: () => void): () => void {
  let url: string | null = null;
  let gone = false;
  img.addEventListener("load", done, { once: true });
  unwrap(commands.readBlob(target))
    .then((blob) => {
      if (gone) return;
      url = URL.createObjectURL(new Blob([decode(blob.base64)], { type: mimeOf(target) }));
      img.src = url;
    })
    .catch(report);
  return () => {
    gone = true;
    if (url) URL.revokeObjectURL(url);
  };
}

// ---- tables -----------------------------------------------------------------

/** The renderer's fragment per table source; a table not edited is not rendered again. */
const tables = new Map<string, Promise<string>>();
const TABLE_CACHE = 200;

/** A table's source as the core renders it (`render_markdown`). */
export function renderTable(source: string): Promise<string> {
  const known = tables.get(source);
  if (known) return known;
  if (tables.size >= TABLE_CACHE) tables.clear();
  const rendered = unwrap(commands.renderMarkdown(source));
  // A failure is not kept: the next draw asks again.
  rendered.catch(() => tables.delete(source));
  tables.set(source, rendered);
  return rendered;
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
export function numberColumns(table: HTMLTableElement): void {
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
 * The core's table fragment in sebaro's parts (DAT-05, spec/02 §3.9):
 * `table.sb-table` in `div.sb-table-wrap[role=region][tabindex=0]`, named
 * `name` (the heading before it, `lib/tableNames.ts` words), a column of
 * numbers `.sb-num`. An image in a cell is loaded like any other.
 */
export function dressTable(host: HTMLElement, html: string, name: string, notePath: string, done: () => void): () => void {
  host.innerHTML = html;
  const stops: (() => void)[] = [];
  for (const table of host.querySelectorAll("table")) {
    const wrap = document.createElement("div");
    wrap.className = "sb-table-wrap";
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", name);
    wrap.tabIndex = 0;
    table.classList.add("sb-table");
    numberColumns(table);
    table.replaceWith(wrap);
    wrap.append(table);
  }
  for (const img of host.querySelectorAll("img")) {
    const target = imageTarget(notePath, img.getAttribute("src") ?? "");
    img.removeAttribute("src");
    if (target) stops.push(loadImage(img, target, done));
  }
  return () => stops.forEach((stop) => stop());
}

// ---- diagrams ---------------------------------------------------------------

let mermaidModule: Promise<Mermaid> | null = null;
/** The colours mermaid was last configured with, as one string. */
let mermaidConfigured: string | null = null;
/** Diagram ids must differ within the document; one counter for the session. */
let diagramSerial = 0;

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
export function mermaidLook(): { themeVariables: Record<string, string | boolean>; themeCSS?: string } {
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
 * the colours changed.
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

/** Sources mermaid could not read, so a broken fence is said once, not at every draw. */
const unreadable = new Set<string>();

/**
 * Draw `source` into `host` as its diagram. A fence mermaid cannot read
 * stays its source, in a code block, and says why once. Draws run one after
 * the other: mermaid renders into one shared scratch element.
 */
let drawing: Promise<void> = Promise.resolve();
export function drawDiagram(host: HTMLElement, source: string, done: () => void): void {
  const plain = () => {
    const pre = document.createElement("pre");
    pre.className = "sb-code";
    pre.textContent = source;
    host.replaceChildren(pre);
    done();
  };
  if (unreadable.has(source)) {
    plain();
    return;
  }
  drawing = drawing
    .then(async () => {
      if (!host.isConnected) return;
      const mermaid = await mermaidFor();
      diagramSerial += 1;
      try {
        const { svg } = await mermaid.render(`novalis-mermaid-${diagramSerial}`, source);
        host.innerHTML = svg;
        done();
      } catch (error) {
        unreadable.add(source);
        plain();
        report(error);
      }
    })
    .catch(report);
}
