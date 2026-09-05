import { tags } from "@lezer/highlight";
import type { InlineContext, MarkdownConfig } from "@lezer/markdown";

/**
 * The two inline parsers the GFM bundle does not have (PLAN.md §7.2):
 * `[[wikilinks]]` and inline `#tags`.
 *
 * Both are small extensions to `@lezer/markdown`, which is the whole point of
 * choosing it: the parse tree stays the source of truth and the decorations
 * are read off it, so nothing here can change a byte of the document
 * (§2.3 rule 2).
 */

const OPEN_BRACKET = 91; // [
const CLOSE_BRACKET = 93; // ]
const HASH = 35; // #

const WikiDelimiter = { resolve: "WikiLink", mark: "WikiLinkMark" };

/** `[[target]]`, `[[target|label]]` and `[[target#heading]]`. */
export const WikiLink: MarkdownConfig = {
  defineNodes: [
    { name: "WikiLink", style: tags.link },
    { name: "WikiLinkMark", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: "WikiLinkStart",
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== OPEN_BRACKET || cx.char(pos + 1) !== OPEN_BRACKET) return -1;
        return cx.addDelimiter(WikiDelimiter, pos, pos + 2, true, false);
      },
      before: "Link",
    },
    {
      name: "WikiLinkEnd",
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== CLOSE_BRACKET || cx.char(pos + 1) !== CLOSE_BRACKET) return -1;
        return cx.addDelimiter(WikiDelimiter, pos, pos + 2, false, true);
      },
      before: "Link",
    },
  ],
};

const TAG_BODY = /[\p{L}\p{N}_/-]/u;
const WORD_BEFORE = /[\p{L}\p{N}_]/u;

/**
 * Inline `#tag`. A `#` that follows a word character is not a tag (`C#`,
 * `rgb(#fff)` after a letter), and a `#` at the start of a line has already
 * been consumed by the heading block parser before inline parsing runs.
 */
export const Tag: MarkdownConfig = {
  defineNodes: [{ name: "TagRef", style: tags.labelName }],
  parseInline: [
    {
      name: "TagRef",
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== HASH) return -1;
        if (pos > cx.offset && WORD_BEFORE.test(cx.slice(pos - 1, pos))) return -1;
        let end = pos + 1;
        while (end < cx.end && TAG_BODY.test(cx.slice(end, end + 1))) end += 1;
        // `#` alone, and a tag of only digits (`#1`, an issue reference), are
        // not tags.
        const body = cx.slice(pos + 1, end);
        if (body.length === 0 || /^[\d/-]+$/.test(body)) return -1;
        return cx.addElement(cx.elt("TagRef", pos, end));
      },
      before: "Escape",
    },
  ],
};

/** The link target inside a `[[…]]`, with `|label` and `#heading` stripped. */
export function wikiTargetOf(raw: string): string {
  const inner = raw.replace(/^\[\[/, "").replace(/\]\]$/, "");
  const withoutLabel = inner.split("|")[0] ?? inner;
  return (withoutLabel.split("#")[0] ?? withoutLabel).trim();
}
