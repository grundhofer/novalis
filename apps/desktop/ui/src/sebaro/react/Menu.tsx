// Menu.tsx: a menu button and its menu, with groups under a heading and with submenus. The menus are popovers: the
// browser closes them on Escape and on a press beside them; this file adds the places, the keys and the way of the
// focus.
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type ToggleEvent,
} from "react";
import { flushSync } from "react-dom";
import { Icon } from "./Icon";

/** An item that acts. Without `onPress` it has no target now: it stays in the menu, disabled. */
export type MenuAction = {
  label: string;
  id?: string;
  /** the language of the label where it is not the page's (the name of a language in a language menu) */
  lang?: string;
  /** the item's shortcut, after its word: a <Keys> */
  keys?: ReactNode;
  danger?: boolean;
  /** a setting: the item carries a check while it is on; `radio` for one of several */
  checked?: boolean;
  radio?: boolean;
  onPress?: () => void;
};
/** An entry of a menu: an item, an item that opens a submenu (`id` is the submenu's), a group of items under a
 *  heading, or the line between two blocks. */
export type MenuEntry =
  | MenuAction
  | { label: string; id: string; items: MenuEntry[] }
  | { heading: string; items: MenuAction[] }
  | "separator";

type Side = "right" | "left";
type Level = {
  /** an item was chosen: every menu closes, the focus goes back, then the item acts */
  onChoose(action: () => void): void;
  /** the focus leaves with Tab: every menu closes */
  onLeave(): void;
  /** the name of the row that leads back to the menu `name`: „Zurück zu Datei“ */
  backWord?: ((name: string) => string) | undefined;
};

const EDGE = 8;
// the items of one menu, those of its groups among them, never those of a submenu
const ITEMS = [":scope > li >", ":scope > li > .sb-menu__group > li >"]
  .map((at) => `${at} [role^='menuitem']:not([aria-disabled='true'])`)
  .join(", ");
const items = (menu: HTMLElement) => [...menu.querySelectorAll<HTMLElement>(ITEMS)];
const px = (n: number) => `${Math.round(n)}px`;
const within = (n: number, size: number, room: number) =>
  Math.min(Math.max(EDGE, n), Math.max(EDGE, room - size - EDGE));

/** The first item of a menu (after its back row), or the last. */
function focusItem(menu: HTMLElement, which: "first" | "last") {
  const list = items(menu);
  const first = list.length > 1 && list[0]?.classList.contains("sb-menu__back") ? list[1] : list[0];
  (which === "last" ? list[list.length - 1] : first)?.focus();
}

/** Back to `to` when the focus was in the closed menu or is nowhere now; a press on something else keeps it. */
function giveFocusBack(menu: HTMLElement, to: HTMLElement | null) {
  const active = document.activeElement;
  if (!active || active === document.body || menu.contains(active)) to?.focus();
}

/** Under the button with its end on the button's end; above it when the room below is smaller; moved up into the
 *  window when it fits neither side (the stylesheet keeps a menu no taller than the window: it scrolls). */
function placeUnder(menu: HTMLElement, button: HTMLElement) {
  const from = button.getBoundingClientRect();
  const size = menu.getBoundingClientRect();
  const below = window.innerHeight - from.bottom - 4 - EDGE;
  const top = size.height <= below || below >= from.top ? from.bottom + 4 : from.top - 4 - size.height;
  menu.style.top = px(within(top, size.height, window.innerHeight));
  menu.style.left = px(within(from.right - size.width, size.width, document.documentElement.clientWidth));
}

/** Beside its parent, the first item level with the item that opened it: on the side the parent went, else on the
 *  reading side, else on the other. Null when no side has room. */
function placeBeside(menu: HTMLElement, item: HTMLElement, parent: HTMLElement, went?: Side): Side | null {
  const [beside, size, style] = [parent.getBoundingClientRect(), menu.getBoundingClientRect(), getComputedStyle(menu)];
  const line = parseFloat(style.borderLeftWidth);
  const at = { right: beside.right - line, left: beside.left - size.width + line };
  const room = document.documentElement.clientWidth;
  const sides: Side[] = went ? [went] : ["right", "left"];
  const side = sides.find((one) => at[one] >= EDGE && at[one] + size.width <= room - EDGE);
  if (!side) return null;
  const top = item.getBoundingClientRect().top - parseFloat(style.borderTopWidth) - parseFloat(style.paddingTop);
  menu.style.top = px(within(top, size.height, window.innerHeight));
  menu.style.left = px(at[side]);
  return side;
}

/** In the place and width of its parent, which stays open but hidden: no level lies over the items of another. */
function placeOver(menu: HTMLElement, parent: HTMLElement) {
  const over = parent.getBoundingClientRect();
  menu.style.inlineSize = px(over.width);
  menu.style.top = px(within(over.top, menu.getBoundingClientRect().height, window.innerHeight));
  menu.style.left = px(over.left);
  parent.setAttribute("data-sb-replaced", "");
}

/** The keys inside one menu: the arrows move and wrap, Home and End jump, letters jump to the next item that starts
 *  with them, Arrow right opens a submenu, Arrow left goes back, Tab leaves. */
function useMenuKeys(level: Level, onBack?: () => void) {
  const typed = useRef({ text: "", at: 0 });
  return (event: KeyboardEvent<HTMLUListElement>) => {
    const list = items(event.currentTarget);
    const at = list.findIndex((item) => item === document.activeElement);
    if (at < 0) return;
    const to = (n: number) => list[(n + list.length) % list.length]?.focus();
    // the browser closes this menu on Escape; nothing else in the window answers the key
    if (event.key === "Escape") return event.stopPropagation();
    if (event.key === "Tab") return level.onLeave();
    if (event.key === "ArrowDown") to(at + 1);
    else if (event.key === "ArrowUp") to(at - 1);
    else if (event.key === "Home") to(0);
    else if (event.key === "End") to(-1);
    else if (event.key === "ArrowRight" && list[at]?.getAttribute("aria-haspopup")) list[at].click();
    else if (event.key === "ArrowLeft" && onBack) onBack();
    else if (event.key.length === 1 && /\S/.test(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey) {
      // letters typed within 500 ms belong together; the same letter again goes on to the next item with it
      const now = Date.now();
      const text = (now - typed.current.at < 500 ? typed.current.text : "") + event.key.toLowerCase();
      typed.current = { text, at: now };
      const again = [...text].every((letter) => letter === text[0]);
      const from = again ? at + 1 : at;
      const order = [...list.slice(from), ...list.slice(0, from)];
      const start = again ? text.slice(0, 1) : text;
      order.find((item) => item.textContent.trim().toLowerCase().startsWith(start))?.focus();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };
}

type EntriesProps = { menu: string; entries: MenuEntry[]; level: Level; checks: boolean; went?: Side | undefined };

/** The items of one menu. `menu`: its id, from which the headings of its groups take theirs. `checks`: the items
 *  leave room for a check before their word. `went`: the side this menu opened to, which its own submenus keep. */
function Entries({ menu, entries, level, checks, went }: EntriesProps) {
  const item = (entry: MenuAction, at: number) => {
    const role = entry.checked === undefined ? "menuitem" : entry.radio ? "menuitemradio" : "menuitemcheckbox";
    return (
      <li key={at} role="none">
        <button
          className={entry.danger ? "sb-menu__item sb-menu__item--danger" : "sb-menu__item"}
          type="button"
          role={role}
          id={entry.id}
          lang={entry.lang}
          tabIndex={-1}
          aria-checked={entry.checked}
          aria-disabled={entry.onPress ? undefined : true}
          onClick={() => entry.onPress && level.onChoose(entry.onPress)}
        >
          {checks && (
            <span className="sb-menu__check" aria-hidden="true">
              {entry.checked !== undefined && <Icon name="check--16" size={16} />}
            </span>
          )}
          {entry.label}
          {entry.keys}
        </button>
      </li>
    );
  };
  return entries.map((entry, at) => {
    if (entry === "separator") return <li key={at} role="separator" className="sb-menu__sep" />;
    if ("heading" in entry)
      return (
        <li key={at} role="none">
          <p className="sb-menu__heading" id={`${menu}-${at}`}>
            {entry.heading}
          </p>
          <ul className="sb-menu__group" role="group" aria-labelledby={`${menu}-${at}`}>
            {entry.items.map(item)}
          </ul>
        </li>
      );
    if ("items" in entry) return <SubMenu key={at} entry={entry} level={level} checks={checks} went={went} />;
    return item(entry, at);
  });
}

type SubProps = {
  entry: { label: string; id: string; items: MenuEntry[] };
  level: Level;
  checks: boolean;
  went?: Side | undefined;
};

/** An item that opens a submenu, and the submenu: both in one list item, as the tree of menus is. */
function SubMenu({ entry, level, checks, went }: SubProps) {
  const item = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<Side | null>(null);
  const [cameFrom, setCameFrom] = useState(""); // the name of the menu this one was opened from, for the back row
  const parent = () => item.current?.closest<HTMLElement>(".sb-menu") ?? null;

  const show = () => {
    const [list, from, above] = [menu.current, item.current, parent()];
    if (!list || !from || !above) return;
    list.showPopover();
    const beside = placeBeside(list, from, above, went);
    // no room beside: the back row is drawn first, so the place is measured with it
    flushSync(() => {
      setOpen(true);
      setSide(beside);
      setCameFrom(above.getAttribute("aria-label") ?? "");
    });
    if (!beside) placeOver(list, above);
    focusItem(list, "first");
  };
  const back = () => {
    menu.current?.hidePopover();
    parent()?.removeAttribute("data-sb-replaced"); // the parent is seen again before the focus goes back to it
    item.current?.focus();
  };
  const onToggle = (event: ToggleEvent<HTMLUListElement>) => {
    // React hands the event of a submenu up to its parent menus too: only this menu's own closing counts
    if (event.target !== event.currentTarget || event.newState !== "closed") return;
    setOpen(false);
    parent()?.removeAttribute("data-sb-replaced");
    event.currentTarget.style.inlineSize = "";
    giveFocusBack(event.currentTarget, item.current);
  };
  const onKeyDown = useMenuKeys(level, back);

  return (
    <li role="none">
      <button
        ref={item}
        className="sb-menu__item"
        type="button"
        role="menuitem"
        tabIndex={-1}
        aria-haspopup="menu"
        aria-expanded={open}
        popoverTarget={entry.id}
        onClick={(event: MouseEvent) => {
          event.preventDefault(); // the menu is shown here, so it is placed in the same step
          if (menu.current?.matches(":popover-open")) back();
          else show();
        }}
      >
        {checks && <span className="sb-menu__check" aria-hidden="true" />}
        {entry.label}
        <span className="sb-menu__sub" aria-hidden="true">
          <Icon name="chevron-right--16" size={16} />
        </span>
      </button>
      <ul
        ref={menu}
        className="sb-menu"
        role="menu"
        id={entry.id}
        aria-label={entry.label}
        popover="auto"
        onToggle={onToggle}
        onKeyDown={onKeyDown}
      >
        {open && !side && (
          <li role="none" className="sb-menu__back-row">
            <button
              className="sb-menu__item sb-menu__back"
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-label={level.backWord?.(cameFrom)}
              onClick={back}
            >
              <span className="sb-menu__back-mark" aria-hidden="true">
                <Icon name="chevron-right--16" size={16} />
              </span>
              {cameFrom}
            </button>
          </li>
        )}
        <Entries menu={entry.id} entries={entry.items} level={level} checks went={side ?? undefined} />
      </ul>
    </li>
  );
}

type Props = {
  /** the id of the menu; the button's is `<id>-button` */
  id: string;
  label: string;
  entries: MenuEntry[];
  /** the classes of the button: sb-icon-button, sb-secondary-action … */
  className: string;
  /** the name of a button that shows an icon alone; a button with a word is named by it */
  buttonLabel?: string;
  /** the items of the menu leave room for a check before their word (a menu of choices); a submenu always does */
  checks?: boolean;
  /** the name of the row that leads back from a submenu without room beside its parent: „Zurück zu Datei“; without
   *  it the row is named by the parent's name alone */
  backWord?: (name: string) => string;
  /** the menu of a window: F10 opens it from anywhere, and Escape then gives the focus back to where it was */
  windowMenu?: boolean;
  /** what the button shows */
  children: ReactNode;
};

/** A button that opens a menu. A press, Enter or Space open it on its first item, Arrow down too, Arrow up on its
 *  last. Choosing an item closes it and gives the focus back before the item acts. A change of the window's size or
 *  a scroll outside the menus closes it. */
export function MenuButton({
  id,
  label,
  entries,
  className,
  buttonLabel,
  checks = false,
  backWord,
  windowMenu,
  children,
}: Props) {
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const cameFrom = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);

  const show = (which: "first" | "last", from: HTMLElement | null = null) => {
    if (!menu.current || !button.current) return;
    cameFrom.current = from;
    menu.current.showPopover();
    placeUnder(menu.current, button.current);
    setOpen(true);
    focusItem(menu.current, which);
  };
  const close = () => menu.current?.hidePopover();
  const level: Level = {
    onChoose(action) {
      close();
      (cameFrom.current ?? button.current)?.focus();
      action();
    },
    onLeave: close,
    backWord,
  };
  const onKeyDown = useMenuKeys(level);

  // a window of another size has other places for the menus, and a page that scrolls takes the button away from
  // under its menu: they close. A menu that scrolls its own items stays.
  useEffect(() => {
    if (!open) return;
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Element && event.target.closest(".sb-menu"))) close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!windowMenu) return;
    const onF10 = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "F10" || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      if (menu.current?.matches(":popover-open")) close();
      else show("first", document.activeElement instanceof HTMLElement ? document.activeElement : null);
    };
    window.addEventListener("keydown", onF10);
    return () => window.removeEventListener("keydown", onF10);
  }, [windowMenu]);

  return (
    <>
      <button
        ref={button}
        className={className}
        type="button"
        id={`${id}-button`}
        aria-label={buttonLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        popoverTarget={id}
        onClick={(event) => {
          event.preventDefault(); // the menu is shown here, so it is placed in the same step
          if (menu.current?.matches(":popover-open")) close();
          else show("first");
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          show(event.key === "ArrowDown" ? "first" : "last");
        }}
      >
        {children}
      </button>
      <ul
        ref={menu}
        className={windowMenu ? "sb-menu sb-menu--window" : "sb-menu"}
        role="menu"
        id={id}
        aria-label={label}
        popover="auto"
        data-sb-density={windowMenu ? "window" : undefined}
        onToggle={(event) => {
          // React hands the event of a submenu up to this menu too: only its own closing counts
          if (event.target !== event.currentTarget || event.newState !== "closed") return;
          setOpen(false);
          giveFocusBack(event.currentTarget, cameFrom.current ?? button.current);
        }}
        onKeyDown={onKeyDown}
      >
        <Entries menu={id} entries={entries} level={level} checks={checks} />
      </ul>
    </>
  );
}
