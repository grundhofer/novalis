/**
 * The names of generated tables for screen readers (spec/02 §3.9, ADR-0051
 * #52, #57): a renderer that wraps a table without a caption in a region
 * names the region after the heading before it. The Markdown preview, the
 * EPUB reader and the DOCX reader use the same rule and the same words
 * (`preview.tableUnder`, `preview.tableUnderNumbered`,
 * `preview.tableNumbered`).
 */

/** Stands for a table's number in its words until the table is named. */
export const TABLE_NUMBER = "\u0000";
/** Stands for the heading before a table in its words. */
export const TABLE_HEADING = "\u0002";

/**
 * A table's words, `TABLE_HEADING` standing for the heading before it and
 * `TABLE_NUMBER` for its place: „Tabelle unter „…““, „Tabelle 2 unter
 * „…““, and without a heading „Tabelle 1“.
 */
export interface TableWords {
  under: string;
  underNumbered: string;
  numbered: string;
}

/**
 * The name of each untitled table's region in `host`: after the heading
 * before it in the text, „Tabelle unter „<Überschrift>““, a second untitled
 * table under the same heading „Tabelle 2 unter „<Überschrift>““; without a
 * heading before it „Tabelle 1“, „Tabelle 2“ in the order of the text. A
 * table with a caption is named by it (DAT-05), so it is neither named nor
 * counted here; Markdown has none.
 */
export function tableNames(host: ParentNode, words: TableWords): Map<Element, string> {
  const say = (template: string, number: number, heading = "") =>
    template.split(TABLE_NUMBER).join(String(number)).split(TABLE_HEADING).join(heading);
  const names = new Map<Element, string>();
  let heading: string | null = null;
  let underHeading = 0;
  let untitled = 0;
  for (const element of host.querySelectorAll("h1, h2, h3, h4, h5, h6, table")) {
    if (element.tagName !== "TABLE") {
      heading = element.textContent?.trim() || null;
      underHeading = 0;
    } else if ((element as HTMLTableElement).caption?.textContent?.trim()) {
      continue;
    } else if (heading === null) {
      untitled += 1;
      names.set(element, say(words.numbered, untitled));
    } else {
      underHeading += 1;
      names.set(element, say(underHeading === 1 ? words.under : words.underNumbered, underHeading, heading));
    }
  }
  return names;
}
