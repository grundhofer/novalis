import { describe, expect, it } from "vitest";

import {
  ariaKeyshortcutsOf,
  ariaKeyshortcutsOfScope,
  bindingFor,
  chordOf,
  commandForChord,
  fieldKeeps,
  glyphsOf,
  isOwnChord,
  SEBARO_FIXED,
} from "./keymap";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("the keymap (docs/KEYMAP.md)", () => {
  // ADR-0051: ⌘K is the palette, ⇧⌘P its second chord, and the palette
  // and the menu show the first.
  it("opens the palette on ⌘K and shows ⌘K for it", () => {
    expect(commandForChord("Cmd+K")?.command).toBe("palette.open");
    expect(commandForChord("Shift+Cmd+P")?.command).toBe("palette.open");
    expect(bindingFor("palette.open")?.chord).toBe("Cmd+K");
    expect(commandForChord("Shift+Cmd+K")?.command).toBe("markdown.link");
  });

  // spec/09 §13.1: „+“ is a key of its own on the German layout, where US
  // has `]`; on US it is `⇧=`, and the unshifted `=` counts as well.
  it("reads ⌘+ and ⌘− as characters, on either layout", () => {
    expect(chordOf(key({ code: "BracketRight", key: "+", metaKey: true }))).toBe("Cmd+Plus");
    expect(chordOf(key({ code: "Equal", key: "=", metaKey: true }))).toBe("Cmd+Plus");
    expect(chordOf(key({ code: "Equal", key: "+", shiftKey: true, metaKey: true }))).toBe("Cmd+Plus");
    expect(chordOf(key({ code: "Minus", key: "-", metaKey: true }))).toBe("Cmd+Minus");
    expect(chordOf(key({ code: "Slash", key: "-", metaKey: true }))).toBe("Cmd+Minus");
    expect(commandForChord("Cmd+Plus")?.command).toBe("view.fontLarger");
    expect(commandForChord("Cmd+Minus")?.command).toBe("view.fontSmaller");
    // A plain „+“ is typing, not a chord.
    expect(chordOf(key({ code: "BracketRight", key: "+" }))).toBeNull();
  });

  it("keeps every other chord on the key's position", () => {
    expect(chordOf(key({ code: "BracketRight", key: "]", metaKey: true }))).toBe("Cmd+]");
    expect(chordOf(key({ code: "KeyN", key: "˜", altKey: true, metaKey: true }))).toBe("Alt+Cmd+N");
    expect(chordOf(key({ code: "Tab", key: "Tab", ctrlKey: true }))).toBe("Ctrl+Tab");
    expect(chordOf(key({ code: "Tab", key: "Tab", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+Tab");
    expect(commandForChord("Ctrl+Tab")?.command).toBe("tab.next");
    expect(commandForChord("Ctrl+Shift+Tab")?.command).toBe("tab.previous");
    expect(commandForChord("Ctrl+Cmd+S")?.command).toBe("sidebar.toggle");
    expect(commandForChord("Alt+Cmd+N")?.command).toBe("tree.newFolder");
    // ⌘⌫ trashes; ⌘⌦ (fn ⌫) is no chord of the keymap.
    expect(chordOf(key({ code: "Backspace", key: "Backspace", metaKey: true }))).toBe("Cmd+Backspace");
    expect(commandForChord("Cmd+Backspace")?.command).toBe("tree.trash");
    expect(chordOf(key({ code: "Delete", key: "Delete", metaKey: true }))).toBeNull();
    // ⇧⌘N stays free for sebaro's New Window (DSK-09).
    expect(commandForChord("Shift+Cmd+N")).toBeUndefined();
  });

  // spec/02 §4.20: F6 / ⇧F6 move through the areas, from anywhere.
  it("reads F6 and ⇧F6 as the area chords", () => {
    expect(chordOf(key({ code: "F6", key: "F6" }))).toBe("F6");
    expect(chordOf(key({ code: "F6", key: "F6", shiftKey: true }))).toBe("Shift+F6");
    expect(commandForChord("F6")).toEqual({ chord: "F6", command: "area.next", scope: "global" });
    expect(commandForChord("Shift+F6")).toEqual({ chord: "Shift+F6", command: "area.previous", scope: "global" });
    expect(glyphsOf("Shift+F6")).toBe("⇧F6");
  });

  it("draws the new keys with their glyphs", () => {
    expect(glyphsOf("Cmd+Plus")).toBe("⌘+");
    expect(glyphsOf("Cmd+Minus")).toBe("⌘−");
    expect(glyphsOf("Ctrl+Shift+Tab")).toBe("⌃⇧⇥");
    expect(glyphsOf("Ctrl+Cmd+S")).toBe("⌃⌘S");
  });

  // `aria-keyshortcuts` takes the `KeyboardEvent.key` names: ArrowLeft, not
  // the keymap's Left (spec/02 §4.18 writes the macOS form).
  it("writes chords as aria-keyshortcuts names", () => {
    expect(ariaKeyshortcutsOf("Ctrl+Cmd+S")).toBe("Control+Meta+S");
    expect(ariaKeyshortcutsOf("Left")).toBe("ArrowLeft");
    expect(ariaKeyshortcutsOf("Ctrl+Cmd+Up")).toBe("Control+Meta+ArrowUp");
    expect(ariaKeyshortcutsOfScope("viewer")).toBe("ArrowLeft ArrowRight PageUp PageDown Home End");
    // The keymap's Backspace is ⌫, which `KeyboardEvent.key` calls so too.
    expect(ariaKeyshortcutsOf("Cmd+Backspace")).toBe("Meta+Backspace");
  });

  // spec/02 §4.19: sebaro's 15 fixed rows; any other chord a control
  // announces is marked as the app's own (data-sb-own-shortcut).
  it("tells sebaro's fixed chords from novalis' own", () => {
    expect(new Set(Object.values(SEBARO_FIXED)).size).toBe(15);
    expect(isOwnChord("Cmd+K")).toBe(false);
    expect(isOwnChord("Ctrl+Cmd+S")).toBe(false);
    expect(isOwnChord("Cmd+C")).toBe(false);
    expect(isOwnChord("Cmd+J")).toBe(true);
    expect(isOwnChord("Shift+Cmd+P")).toBe(true);
    // sebaro's Zurück / Vor (D102 (14), ADR-0051 #36).
    expect(isOwnChord("Cmd+Left")).toBe(false);
    expect(isOwnChord("Ctrl+Cmd+Right")).toBe(false);
  });

  // D102 (14), ADR-0051 #36: Back / Forward are ⌘← / ⌘→, and ⌃⌘← / ⌃⌘→
  // where a text field keeps the first two; ⌘[ / ⌘] are gone.
  it("goes back and forward on ⌘← / ⌘→ and ⌃⌘← / ⌃⌘→", () => {
    expect(chordOf(key({ code: "ArrowLeft", key: "ArrowLeft", metaKey: true }))).toBe("Cmd+Left");
    expect(chordOf(key({ code: "ArrowRight", key: "ArrowRight", ctrlKey: true, metaKey: true }))).toBe(
      "Ctrl+Cmd+Right",
    );
    expect(commandForChord("Cmd+Left")?.command).toBe("nav.back");
    expect(commandForChord("Cmd+Right")?.command).toBe("nav.forward");
    expect(commandForChord("Ctrl+Cmd+Left")?.command).toBe("nav.back");
    expect(commandForChord("Ctrl+Cmd+Right")?.command).toBe("nav.forward");
    expect(bindingFor("nav.back")?.chord).toBe("Cmd+Left");
    expect(bindingFor("nav.forward")?.chord).toBe("Cmd+Right");
    expect(commandForChord("Cmd+[")).toBeUndefined();
    expect(commandForChord("Cmd+]")).toBeUndefined();
    expect(glyphsOf("Ctrl+Cmd+Left")).toBe("⌃⌘←");
    expect(ariaKeyshortcutsOf("Cmd+Right")).toBe("Meta+ArrowRight");
  });

  // spec/02 §4.19: a text field keeps ⌘← / ⌘→ for the line's start and end,
  // the editor (contenteditable) too; ⌃⌘← / ⌃⌘→ and every other chord are
  // the app's there.
  it("leaves ⌘← / ⌘→ to a text field", () => {
    const input = document.createElement("input");
    const checkbox = Object.assign(document.createElement("input"), { type: "checkbox" });
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const line = editor.appendChild(document.createElement("span"));
    const off = document.createElement("div");
    off.setAttribute("contenteditable", "false");
    const button = document.createElement("button");
    for (const field of [input, document.createElement("textarea"), editor, line]) {
      expect(fieldKeeps("Cmd+Left", field)).toBe(true);
      expect(fieldKeeps("Cmd+Right", field)).toBe(true);
      expect(fieldKeeps("Ctrl+Cmd+Left", field)).toBe(false);
      expect(fieldKeeps("Cmd+K", field)).toBe(false);
    }
    for (const other of [checkbox, off, button, null]) expect(fieldKeeps("Cmd+Left", other)).toBe(false);
  });
});
