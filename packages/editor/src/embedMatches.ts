export interface EmbedMatch {
  from: number;
  to: number;
  /** The raw target between the brackets, trimmed. May carry a `#section`
   *  anchor (passed through verbatim; section slicing is a later phase). */
  target: string;
}

// `![[target]]` — the image-style transclusion syntax. The leading `!` is what
// distinguishes an embed from a plain `[[wikilink]]`; the target is anything
// but brackets/newlines (so `![[Note#Heading]]` matches with the anchor kept).
const EMBED_RE = /!\[\[([^\[\]\n]+?)\]\]/g;

/** Find `![[…]]` embed references within a single text node's string. Pure. */
export function findEmbeds(text: string): EmbedMatch[] {
  const out: EmbedMatch[] = [];
  EMBED_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMBED_RE.exec(text)) !== null) {
    const target = m[1].trim();
    if (!target) continue;
    out.push({ from: m.index, to: m.index + m[0].length, target });
  }
  return out;
}
