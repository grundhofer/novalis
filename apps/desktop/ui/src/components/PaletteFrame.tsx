import { useCallback, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { chordOf, commandForChord, glyphsOf } from "../lib/keymap";
import { useUi } from "../stores/ui";
import { spoken } from "./Keys";

/**
 * The commands that open one of the three overlays. Their chords pass the
 * frame to the window's keymap, which opens the other overlay or, for the
 * palette's own chord, closes it (spec/02 §4.16: „pressed again it closes“).
 */
const OVERLAY_COMMANDS = new Set(["palette.open", "quickOpen.open", "search.vault"]);

/**
 * The frame the palette, Quick Open and the vault search share: sebaro's
 * `dialog.sb-command-palette` in window density (spec/02 §4.16, NAV-09,
 * ADR-0051 #21), opened with `showModal()` over the scrim. Focus goes into
 * `input` when it opens and back to where it came from when it closes
 * (ZUG-06, §4.20); Escape and a press on the scrim close it. The keys stay
 * inside: the window's shortcuts do not see them, except the chords of the
 * three overlays.
 *
 * `dismiss` closes the dialog at once, focus back at the opener, before what
 * was chosen runs: a modal dialog makes the rest of the page inert, so a
 * command that moves focus (F6, a dialog it opens) must find the page
 * open again.
 */
export function usePaletteFrame(input: { current: HTMLInputElement | null }, select = false) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const leave = useCallback((element: HTMLDialogElement) => {
    const active = document.activeElement;
    if (element.open) element.close();
    const lost = !active || active === document.body || element.contains(active);
    if (lost && opener.current?.isConnected) opener.current.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return undefined;
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    if (!element.open) element.showModal();
    input.current?.focus();
    if (select) input.current?.select();
    return () => leave(element);
    // Once per overlay: the component is mounted per opening, and `input`
    // and `leave` keep their identity.
  }, [input, leave, select]);

  const dismiss = useCallback(() => {
    if (dialog.current) leave(dialog.current);
    useUi.getState().setOverlay({ kind: "none" });
  }, [leave]);

  // A press on the scrim closes (spec/02 §4.16). The scrim is the dialog's
  // `::backdrop`, so the press lands on the dialog itself, outside its box.
  const onMouseDown = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return;
    const box = event.currentTarget.getBoundingClientRect();
    const inside =
      event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) dismiss();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      return;
    }
    const chord = chordOf(event.nativeEvent);
    const binding = chord ? commandForChord(chord) : undefined;
    if (binding && OVERLAY_COMMANDS.has(binding.command)) return;
    event.stopPropagation();
  };

  const props = {
    ref: dialog,
    onMouseDown,
    onKeyDown,
    // Escape by the browser's own way: the store closes the overlay.
    onCancel: (event: { preventDefault: () => void }) => {
      event.preventDefault();
      dismiss();
    },
  };
  return { dialog: props, dismiss };
}

/** One or more keys as sebaro's `sb-keys`: the glyphs for the eye, the words for a screen reader. */
function FootKeys({ keys }: { keys: readonly string[] }) {
  const { t } = useTranslation();
  return (
    <span className="sb-keys" data-sb-keys={keys.join(" ")}>
      <span aria-hidden="true">{keys.map(glyphsOf).join("")}</span>
      <span className="sb-visually-hidden">{keys.map((key) => spoken(key, t)).join(", ")}</span>
    </span>
  );
}

/**
 * The key hints at the frame's foot (`__foot`): „↑↓ wechseln · ↩ <verb> ·
 * ⎋ schließen“, the keys as `.sb-keys` (ICO-08). `children` follow them
 * (the search's counts).
 */
export function PaletteFoot({ verbKey, children }: { verbKey: string; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <p className="sb-command-palette__foot">
      <span>
        <FootKeys keys={["Up", "Down"]} />
        {t("palette.foot.navigate")}
      </span>
      <span>
        <FootKeys keys={["Enter"]} />
        {t(verbKey)}
      </span>
      <span>
        <FootKeys keys={["Escape"]} />
        {t("palette.foot.close")}
      </span>
      {children}
    </p>
  );
}

/** The next active row of a list of `count` after an arrow: round, as sebaro's palette (spec/02 §4.16). */
export function step(index: number, count: number, back: boolean): number {
  if (count === 0) return 0;
  return (index + (back ? -1 : 1) + count) % count;
}
