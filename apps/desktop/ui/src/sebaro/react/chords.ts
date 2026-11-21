// chords.ts: a shortcut as a platform writes it. A chord is written once, in its macOS form ("Mod+K", "Ctrl+Mod+S";
// Mod is ⌘). What Windows and Linux press and show instead follows from the rules here: Strg stands for ⌘, ⌃⌘ becomes
// Strg+Alt, and four chords have a form of their own.

export type Platform = "mac" | "other";

/** The words of the keys in the page's language, from the product's string table. Signs are the same in every
 *  language and stand here. */
export type KeyWords = {
  shown: Record<string, string>;
  spoken: Record<string, string>;
  spokenOther: Record<string, string>;
};

/** The shell names the platform on <html> before the page's scripts run; a browser tells by itself. */
export function platform(): Platform {
  const named = document.documentElement.dataset.sbPlatform;
  if (named) return named === "mac" ? "mac" : "other";
  return /mac|iphone|ipad/i.test(navigator.platform) ? "mac" : "other";
}

const MODS = ["Ctrl", "Alt", "Shift", "Mod"];
const OTHER_ORDER = ["Mod", "Ctrl", "Alt", "Shift"];
const OTHER_FORM: Record<string, string> = {
  "Mod+Backspace": "Delete",
  "Shift+Mod+Z": "Mod+Y",
  "Mod+Left": "Alt+Left",
  "Mod+Right": "Alt+Right",
};
const SIGNS: Record<string, string> = { Up: "↑", Down: "↓", Left: "←", Right: "→", Comma: ",", Plus: "+", Minus: "-" };
const MAC_SIGNS: Record<string, string> = {
  ...SIGNS,
  Mod: "⌘",
  Ctrl: "⌃",
  Shift: "⇧",
  Alt: "⌥",
  Enter: "↩",
  Escape: "⎋",
  Backspace: "⌫",
  Delete: "⌦",
  Tab: "⇥",
};

/** The keys of one chord on a platform, modifiers first in the platform's order: "Ctrl+Mod+S" off macOS gives
 *  Mod, Alt, S (shown as „Strg+Alt+S“). */
export function chord(spec: string, on: Platform): string[] {
  const mac = on === "mac";
  let parts = (mac ? spec : (OTHER_FORM[spec] ?? spec)).split("+");
  if (!mac && parts.includes("Mod")) parts = parts.map((part) => (part === "Ctrl" ? "Alt" : part));
  const order = mac ? MODS : OTHER_ORDER;
  const mods = parts.filter((part) => MODS.includes(part)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...mods, ...parts.filter((part) => !MODS.includes(part))];
}

/** What a person sees and what a screen reader says for a chord, or for keys side by side ("Up Down"). */
export function keyText(spec: string, on: Platform, words: KeyWords): { shown: string; said: string } {
  const mac = on === "mac";
  const chords = spec.split(" ").map((one) => chord(one, on));
  const letter = (key: string) => (key.length === 1 ? key.toUpperCase() : key);
  return {
    shown: chords
      .map((keys) =>
        keys
          .map((key) => (mac ? MAC_SIGNS[key] : (SIGNS[key] ?? words.shown[key])) ?? letter(key))
          .join(mac ? "" : "+"),
      )
      .join(""),
    said: chords
      .map((keys) => keys.map((key) => (!mac && words.spokenOther[key]) || words.spoken[key] || letter(key)).join(" "))
      .join(", "),
  };
}
