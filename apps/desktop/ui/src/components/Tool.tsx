import { ariaKeyshortcutsOf, bindingFor, isOwnChord } from "../lib/keymap";
import Icon, { type IconName } from "./Icon";
import Keys from "./Keys";

/**
 * A tool: sebaro's icon-only `sb-icon-button--compact` (32 px, icon 20;
 * spec/02 §4.18, NAV-10), for what acts in the current place. It is named
 * for screen readers by `label`, carries the chord of `command` from the
 * keymap as `aria-keyshortcuts` (with `data-sb-own-shortcut` when the chord
 * is not one of sebaro's fixed ones, spec/02 §4.19), and its tooltip is sebaro's
 * (`sb-tooltip.js`, loaded by index.html): „Name Kürzel“, the name
 * `aria-hidden` inside because the button carries it, so a screen reader
 * adds only the spoken shortcut. A tool that shows a state passes `pressed`
 * (`aria-pressed`; sebaro.css gives it the link colour, no place line).
 * A tool whose action cannot run right now (the first page's „Vorherige
 * Seite“) is `disabled`: `aria-disabled`, not the native attribute, and its
 * click does nothing. So a tool that disables itself by its own press (the
 * last page's „Nächste Seite“) keeps the focus, and with it the pane's keys,
 * and its tooltip still names it; sebaro.css greys its icon to text-subtle
 * for `[aria-disabled="true"]` as for `:disabled`, never by opacity (STA-03).
 *
 * The title bar's sidebar tool is written out in TitleBar.tsx with the same
 * markup (it also needs `aria-expanded` / `aria-controls`).
 */
export default function Tool({
  id,
  icon,
  label,
  command,
  pressed,
  disabled,
  onClick,
}: {
  /** Unique in the page: the tooltip's id is `tip-<id>`. */
  id: string;
  icon: IconName;
  label: string;
  /** The command whose chord the tooltip and `aria-keyshortcuts` name; none for a tool without one (Close). */
  command?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const chord = command ? bindingFor(command)?.chord : undefined;
  const tip = `tip-${id}`;
  return (
    <>
      <button
        className="sb-icon-button sb-icon-button--compact"
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        aria-keyshortcuts={chord ? ariaKeyshortcutsOf(chord) : undefined}
        data-sb-own-shortcut={chord && isOwnChord(chord) ? "" : undefined}
        aria-describedby={tip}
        aria-disabled={disabled || undefined}
        onClick={disabled ? undefined : onClick}
      >
        <Icon name={icon} size={20} />
      </button>
      <span className="sb-tooltip" role="tooltip" id={tip} popover="manual">
        <span aria-hidden="true">{label}</span>
        {chord && <Keys chord={chord} />}
      </span>
    </>
  );
}
