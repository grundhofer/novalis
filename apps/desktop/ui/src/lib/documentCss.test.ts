import { describe, expect, it } from "vitest";

import tokens from "../sebaro/tokens.css?raw";
import { DOCUMENT_CSS, dressDocument } from "./documentCss";
import { TABLE_HEADING, TABLE_NUMBER } from "./tableNames";

const TOKENS = new Set([...tokens.matchAll(/(--sb-[a-z0-9-]+)\s*:/g)].map(([, name]) => name));

describe("the dress of a book chapter and a Word document", () => {
  // The shadow root is out of sebaro.css's reach, so the dress is written on
  // its tokens: each one it names must be one the export has, and no value
  // is its own (TEC-07).
  it("is written on the export's tokens, with no colour of its own", () => {
    const used = [...DOCUMENT_CSS.matchAll(/var\((--sb-[a-z0-9-]+)\)/g)].map(([, name]) => name);
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) expect(TOKENS.has(name ?? ""), name).toBe(true);
    expect(DOCUMENT_CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsl/i);
    // The roles the pilot used and sebaro's prose does not (FAR-02, TXT-17).
    expect(DOCUMENT_CSS).not.toMatch(/accent-subtle|hover-fill|text-align: center|font-style: italic/);
  });

  // sebaro's prose after D105 (css/parts/02-prose.css, NV-K2, K3), as the
  // Markdown preview has it from sebaro.css: the room above each heading
  // level, the list indent of a nested list, and the spacing inside an item.
  it("follows sebaro's prose for headings and lists", () => {
    expect(DOCUMENT_CSS).toContain("h1 { margin-block-start: var(--sb-space-12); }");
    expect(DOCUMENT_CSS).toContain("h2 { margin-block-start: var(--sb-space-10); }");
    expect(DOCUMENT_CSS).toContain("h3 { margin-block-start: var(--sb-space-8); }");
    expect(DOCUMENT_CSS).toContain(":is(h1, h2, h3, h4, h5, h6) { margin: var(--sb-spacing-stack) 0;");
    expect(DOCUMENT_CSS).toContain(":is(ul, ol) { padding-inline-start: 1.5em; }");
    expect(DOCUMENT_CSS).toContain("li :is(ul, ol) { margin-block: var(--sb-space-1) 0; }");
    expect(DOCUMENT_CSS).toMatch(/li > :is\(p, ul, ol, blockquote, pre, div\) \+ :is\(ul, ol\) \{ margin-block-start: var\(--sb-space-2\); \}/);
    expect(DOCUMENT_CSS).not.toContain("1.6em");
  });

  // DAT-05: a cell's own paragraphs (mammoth writes each cell's text in a
  // <p>) take no stack margin at the cell's edges, so the row is even.
  it("takes the stack margin off a cell's first and last block", () => {
    expect(DOCUMENT_CSS).toContain(":is(th, td) > :first-child { margin-block-start: 0; }");
    expect(DOCUMENT_CSS).toContain(":is(th, td) > :last-child { margin-block-end: 0; }");
  });

  // DAT-05, as sebaro.css has it: a th wears the label over the
  // border-strong line, a th in tbody (a row header, and any th of a table
  // without a thead, which the HTML parser puts there) body-strong over the
  // row's hairline (`.sb-table tbody th`). A row the XML parser leaves
  // directly under table is one the HTML parser would put into tbody.
  it("tells column heads from row headers", () => {
    const head = DOCUMENT_CSS.match(/\nth \{([^}]*)\}/);
    expect(head?.[1]).toContain("font-weight: var(--sb-type-label-weight);");
    expect(head?.[1]).toContain("border-block-end-color: var(--sb-color-border-strong);");
    const row = DOCUMENT_CSS.match(/\n:is\(tbody, table > tr\) th \{([^}]*)\}/);
    expect(row?.[1]).toContain("font-size: 1em;");
    expect(row?.[1]).toContain("font-weight: var(--sb-type-body-strong-weight);");
    expect(row?.[1]).toContain("border-block-end-color: var(--sb-color-border);");
    // Only the column heads get the strong line.
    expect(DOCUMENT_CSS.match(/border-strong/g)).toHaveLength(1);
  });

  // sebaro's :focus-visible ring stops at the shadow root: a link, a code
  // block and a table's region carry it themselves (ZUG-02).
  it("rings a focused link, code block and table region", () => {
    expect(DOCUMENT_CSS).toContain("a:focus-visible { outline: var(--sb-focus-ring); outline-offset: var(--sb-focus-offset); }");
    expect(DOCUMENT_CSS).toContain(
      ":is(pre, .table-wrap):focus-visible { outline: var(--sb-focus-ring); outline-offset: calc(-1 * var(--sb-focus-width)); }",
    );
  });

  // DAT-05, TXT-08: a wide table or code block scrolls in its own frame,
  // and by keyboard. Its region is named by its caption, else as in the
  // preview after the heading before it (spec/02 §3.9, ADR-0051 #57).
  it("puts a table in a named scrolling region and makes code focusable", () => {
    const body = document.createElement("div");
    body.innerHTML =
      "<table><tr><td>1</td></tr></table>" +
      "<h2> Kosten </h2>" +
      "<table><caption> Miete </caption><tr><td>2</td></tr></table>" +
      "<table><tr><td>3</td></tr></table>" +
      "<h3>Plan</h3>" +
      "<table><tr><td>4</td></tr></table>" +
      "<pre><code>x</code></pre>";
    dressDocument(body, {
      under: `Tabelle unter „${TABLE_HEADING}“`,
      underNumbered: `Tabelle ${TABLE_NUMBER} unter „${TABLE_HEADING}“`,
      numbered: `Tabelle ${TABLE_NUMBER}`,
    });

    const wraps = [...body.querySelectorAll(".table-wrap")];
    expect(wraps.map((wrap) => wrap.getAttribute("aria-label"))).toEqual([
      "Tabelle 1",
      "Miete",
      "Tabelle unter „Kosten“",
      "Tabelle unter „Plan“",
    ]);
    for (const wrap of wraps) {
      expect(wrap.getAttribute("role")).toBe("region");
      expect(wrap.getAttribute("tabindex")).toBe("0");
      expect(wrap.firstElementChild?.tagName).toBe("TABLE");
    }
    expect(body.querySelector("pre")?.getAttribute("tabindex")).toBe("0");
  });
});
