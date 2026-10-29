import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { glyphsOf } from "../lib/keymap";

/**
 * The spoken name of one part of a chord (spec/02 §4.18): the modifiers and
 * every named key of docs/KEYMAP.md in words (the arrows, Return and Escape
 * as sebaro's palette foot says them, §4.16) and the punctuation keys of
 * spec/07 §4.8's table, so a chord is read in one language; a letter, digit,
 * `[`, `]` and F6 as they are.
 */
export function spoken(part: string, t: TFunction): string {
  switch (part) {
    case "Ctrl":
      return t("keys.ctrl");
    case "Alt":
      return t("keys.alt");
    case "Shift":
      return t("keys.shift");
    case "Cmd":
      return t("keys.cmd");
    case "Up":
      return t("keys.up");
    case "Down":
      return t("keys.down");
    case "Left":
      return t("keys.left");
    case "Right":
      return t("keys.right");
    case "Enter":
      return t("keys.enter");
    case "Escape":
      return t("keys.escape");
    case "Backspace":
      return t("keys.backspace");
    case "Tab":
      return t("keys.tab");
    case "Home":
      return t("keys.home");
    case "End":
      return t("keys.end");
    case "PageUp":
      return t("keys.pageUp");
    case "PageDown":
      return t("keys.pageDown");
    case "Plus":
      return t("keys.plus");
    case "Minus":
      return t("keys.minus");
    case ",":
      return t("keys.comma");
    case ".":
      return t("keys.period");
    case "/":
      return t("keys.slash");
    default:
      return part;
  }
}

/** The keymap's punctuation keys by their names in sebaro's `data-sb-keys` (spec/07 §4.8). */
const SEBARO_KEYS: Readonly<Record<string, string>> = {
  Cmd: "Mod",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
};

/**
 * One part of a docs/KEYMAP.md chord in sebaro's `data-sb-keys` notation
 * (spec/02 §4.18): ⌘ is `Mod`, punctuation goes by its name; the keymap's
 * `Backspace` (⌫) and the rest are sebaro's names already.
 */
function sebaroKey(part: string): string {
  return SEBARO_KEYS[part] ?? part;
}

/** The keys that stand as words, not glyphs, on every system (D102 (12), spec/07 §4.8). */
const WORD_KEYS = new Set(["Home", "End", "PageUp", "PageDown"]);

/**
 * The shown form of a chord: the glyphs of `glyphsOf`, and Pos1, Ende, Bild
 * auf and Bild ab as words right after the modifier glyphs („⌘Ende“).
 */
export function shown(chord: string, t: TFunction): string {
  return chord
    .split("+")
    .map((part) => (WORD_KEYS.has(part) ? spoken(part, t) : glyphsOf(part)))
    .join("");
}

/**
 * A shortcut as text in the font's key glyphs, sebaro's `sb-keys` (D68,
 * ICO-08, spec/02 §4.18): the glyphs for the eye, the words for a screen
 * reader. novalis ships for macOS only, so the macOS form is the only one
 * written; `sb-window.js`, which would rewrite it per platform, is not
 * loaded (ADR-0051 #21). `chord` is in docs/KEYMAP.md notation.
 */
export default function Keys({ chord }: { chord: string }) {
  const { t } = useTranslation();
  const parts = chord.split("+");
  return (
    <span className="sb-keys" data-sb-keys={parts.map(sebaroKey).join("+")}>
      <span aria-hidden="true">{shown(chord, t)}</span>
      <span className="sb-visually-hidden">{parts.map((part) => spoken(part, t)).join(" ")}</span>
    </span>
  );
}
