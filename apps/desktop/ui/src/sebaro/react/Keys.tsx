import { keyText, platform, type KeyWords } from "./chords";

/** A shortcut as this platform writes it: „⌘K“ on macOS, „Strg+K“ elsewhere, and its spoken form for screen
 *  readers. `spec` is the macOS form ("Mod+K"); keys side by side are separated by a space ("Up Down"). `words`
 *  are the names of the keys in the page's language. */
export function Keys({ spec, words }: { spec: string; words: KeyWords }) {
  const text = keyText(spec, platform(), words);
  return (
    <span className="sb-keys">
      <span aria-hidden="true">{text.shown}</span>
      <span className="sb-visually-hidden">{text.said}</span>
    </span>
  );
}
