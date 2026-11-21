import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon } from "./Icon";

const DELAY_MS = 400;
const GRACE_MS = 100;

type Props = {
  icon: string;
  label: string;
  /** the tool's shortcut, after its name in the tooltip: a <Keys> */
  keys?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>;

/** A tool with an icon alone and its tooltip „name shortcut“. The tooltip only describes: the tool keeps its own
 *  name. It shows 400 ms after the pointer rests on the tool or the keyboard focus reaches it, never after a touch;
 *  leaving, a press and Escape hide it. */
export function Tool({ icon, label, keys, ...button }: Props) {
  const own = useId();
  // the tooltip's id follows the tool's, where the tool has one
  const id = button.id ? `${button.id}-tip` : own;
  const tool = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const timer = useRef(0);
  const shown = useRef(false);

  const soon = (run: () => void, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(run, ms);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    if (shown.current) tip.current?.hidePopover();
    shown.current = false;
  };
  // under the tool, centred, 8 px away so the focus ring stays clear; above it without room below; inside the window
  const show = () => {
    const [from, bubble] = [tool.current?.getBoundingClientRect(), tip.current];
    if (!from || !bubble) return;
    bubble.showPopover();
    shown.current = true;
    const size = bubble.getBoundingClientRect();
    const below = from.bottom + 8;
    const fits = below + size.height <= window.innerHeight - 8 || from.top - 8 - size.height < 8;
    const left = from.left + from.width / 2 - size.width / 2;
    bubble.style.top = `${Math.round(fits ? below : from.top - 8 - size.height)}px`;
    bubble.style.left = `${Math.round(Math.max(8, Math.min(left, document.documentElement.clientWidth - size.width - 8)))}px`;
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <>
      <button
        ref={tool}
        className="sb-icon-button sb-icon-button--compact"
        type="button"
        aria-label={label}
        aria-describedby={id}
        {...button}
        onPointerEnter={(event) => event.pointerType !== "touch" && soon(show, DELAY_MS)}
        onPointerLeave={() => soon(hide, GRACE_MS)}
        onPointerDown={hide}
        onFocus={(event) => event.currentTarget.matches(":focus-visible") && soon(show, DELAY_MS)}
        onBlur={hide}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !shown.current) return;
          // hides the tooltip only: whatever else Escape would close stays open
          event.preventDefault();
          event.stopPropagation();
          hide();
        }}
      >
        <Icon name={icon} />
      </button>
      <span
        ref={tip}
        className="sb-tooltip"
        role="tooltip"
        id={id}
        popover="manual"
        onPointerEnter={() => window.clearTimeout(timer.current)}
        onPointerLeave={() => soon(hide, GRACE_MS)}
      >
        <span aria-hidden="true">{label}</span>
        {keys}
      </span>
    </>
  );
}
