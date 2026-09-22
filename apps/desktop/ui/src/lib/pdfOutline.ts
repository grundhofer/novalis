/**
 * A PDF's outline (its bookmarks) as the rows of the contents popover
 * (ADR-0025): depth-first, each with the page it leads to.
 *
 * Only what the document itself answers is shown. An entry that points at a
 * web address, at a named destination the file does not carry, or at nothing
 * at all is left out — its children stay, one level up — so every row is a
 * page the viewer can go to.
 */

/** The part of `PDFDocumentProxy` this module reads, so a test can stand in for it. */
export interface OutlineSource {
  getOutline(): Promise<OutlineNode[] | null>;
  getDestination(id: string): Promise<unknown[] | null>;
  getPageIndex(ref: { num: number; gen: number }): Promise<number>;
}

export interface OutlineNode {
  readonly title: string;
  readonly dest: string | unknown[] | null;
  readonly items: readonly OutlineNode[];
}

export interface OutlineRow {
  readonly label: string;
  /** 1-based, like the viewer's page number. */
  readonly page: number;
  /** 0 for a top-level entry. */
  readonly depth: number;
}

function isRef(value: unknown): value is { num: number; gen: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { num?: unknown }).num === "number" &&
    typeof (value as { gen?: unknown }).gen === "number"
  );
}

/**
 * The 1-based page an explicit or named destination leads to, or `null`.
 * An explicit destination starts with the page's reference; a few writers
 * put the 0-based page index there instead.
 */
async function pageOf(doc: OutlineSource, dest: OutlineNode["dest"]): Promise<number | null> {
  const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
  const target = explicit?.[0];
  if (isRef(target)) return (await doc.getPageIndex(target)) + 1;
  if (typeof target === "number" && Number.isInteger(target) && target >= 0) return target + 1;
  return null;
}

export async function outlineOf(doc: OutlineSource, pageCount: number): Promise<OutlineRow[]> {
  const rows: OutlineRow[] = [];
  const walk = async (nodes: readonly OutlineNode[], depth: number): Promise<void> => {
    // Siblings are resolved together: each lookup is a round trip to the
    // worker, and a long outline is hundreds of them. A broken reference is
    // the file's fault, not a reason to lose the rest of the outline.
    const pages = await Promise.all(nodes.map((node) => pageOf(doc, node.dest).catch(() => null)));
    for (const [index, node] of nodes.entries()) {
      const page = pages[index] ?? null;
      const shown = page !== null && page <= pageCount;
      if (shown) rows.push({ label: node.title.trim() || String(page), page, depth });
      // Children follow their parent, so they wait for its row.
      await walk(node.items, shown ? depth + 1 : depth);
    }
  };
  await walk((await doc.getOutline()) ?? [], 0);
  return rows;
}

/**
 * The row the reader is in: the last one that starts on or before the page
 * shown, or `-1` before the first.
 */
export function currentRow(rows: readonly OutlineRow[], page: number): number {
  let found = -1;
  rows.forEach((row, index) => {
    if (row.page <= page) found = index;
  });
  return found;
}
