/**
 * The `#` headings of a Markdown text, for the palette's heading jump (PLAN.md
 * §4.3) and for `[[note#heading]]` (§7.2). Read from the text, not from an
 * editor, so both work while the note is previewed and before the editor's
 * chunk has loaded. Fenced code is skipped: a `# comment` in a shell block is
 * not a heading.
 */

export interface Heading {
  /** 1-based. */
  line: number;
  /** As the palette shows it: the hashes, one space, the heading text. */
  text: string;
  /** The heading text alone, without closing hashes. */
  title: string;
}

const HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

export function headingsOf(text: string): Heading[] {
  const out: Heading[] = [];
  let fence: string | null = null;
  text.split("\n").forEach((raw, index) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const opener = FENCE.exec(line)?.[1];
    if (fence !== null) {
      if (opener && opener[0] === fence[0] && opener.length >= fence.length) fence = null;
      return;
    }
    if (opener) {
      fence = opener;
      return;
    }
    const match = HEADING.exec(line);
    if (match?.[2]) out.push({ line: index + 1, text: `${match[1]} ${match[2]}`, title: match[2] });
  });
  return out;
}

/** The line of the first heading whose text is `title`, ignoring case; or `null`. */
export function headingLine(text: string, title: string): number | null {
  const want = title.trim().toLowerCase();
  return headingsOf(text).find((heading) => heading.title.toLowerCase() === want)?.line ?? null;
}
