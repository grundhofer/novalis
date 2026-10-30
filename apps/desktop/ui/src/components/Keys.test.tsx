import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Keys from "./Keys";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const said = (chord: string) => {
  const { container } = render(<Keys chord={chord} />);
  return container.querySelector(".sb-visually-hidden")?.textContent;
};

// spec/02 §4.18, ICO-08: the glyphs for the eye, the words for a screen reader.
describe("Keys", () => {
  it("says every named key of the keymap in words, in one language", () => {
    expect(said("Ctrl+Shift+Tab")).toBe("keys.ctrl keys.shift keys.tab");
    expect(said("Cmd+Backspace")).toBe("keys.cmd keys.backspace");
    expect(said("Cmd+Plus")).toBe("keys.cmd keys.plus");
    expect(said("Cmd+Minus")).toBe("keys.cmd keys.minus");
    expect(said("Left")).toBe("keys.left");
    expect(said("Right")).toBe("keys.right");
    expect(said("Home")).toBe("keys.home");
    expect(said("End")).toBe("keys.end");
    expect(said("PageUp")).toBe("keys.pageUp");
    expect(said("PageDown")).toBe("keys.pageDown");
  });

  // sebaro's notation: ⌘ is Mod, ⌫ is Backspace (its Delete is ⌦).
  it("writes the chord in sebaro's data-sb-keys notation", () => {
    const { container } = render(<Keys chord="Cmd+Backspace" />);
    expect(container.querySelector(".sb-keys")?.getAttribute("data-sb-keys")).toBe("Mod+Backspace");
  });

  // spec/07 §4.8 (D102 (12), NV-E7): punctuation is said and noted by name.
  it("says and notes Comma, Period and Slash by name", () => {
    expect(said("Cmd+,")).toBe("keys.cmd keys.comma");
    expect(said("Cmd+.")).toBe("keys.cmd keys.period");
    expect(said("Cmd+/")).toBe("keys.cmd keys.slash");
    const { container } = render(<Keys chord="Cmd+," />);
    expect(container.querySelector(".sb-keys")?.getAttribute("data-sb-keys")).toBe("Mod+Comma");
    expect(container.querySelector("[aria-hidden=true]")?.textContent).toBe("⌘,");
    const slash = render(<Keys chord="Cmd+/" />).container;
    expect(slash.querySelector(".sb-keys")?.getAttribute("data-sb-keys")).toBe("Mod+Slash");
  });

  // D102 (12): Pos1, Ende, Bild auf and Bild ab have no glyph and stand as words.
  it("shows Home, End, PageUp and PageDown as words after the modifier glyphs", () => {
    const { container } = render(<Keys chord="Cmd+End" />);
    expect(container.querySelector("[aria-hidden=true]")?.textContent).toBe("⌘keys.end");
    const page = render(<Keys chord="PageDown" />).container;
    expect(page.querySelector("[aria-hidden=true]")?.textContent).toBe("keys.pageDown");
  });

  it("says a letter or F6 as it is", () => {
    expect(said("Cmd+K")).toBe("keys.cmd K");
    expect(said("F6")).toBe("F6");
  });
});
