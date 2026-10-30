import { useId, type SyntheticEvent } from "react";

import Icon from "./Icon";

/** One row of a „Mehr“ menu. */
export interface MoreEntry {
  label: string;
  onSelect?: () => void;
  /** No target right now (the first column's „nach links“): shown, skipped by the arrows (D102 (9)). */
  disabled?: boolean;
  /** „Löschen …“: last, after a separator, the danger word with the trash (AKT-10, EBE-07). */
  danger?: boolean;
  /** A submenu of choices, the current one checked (spec/02 §4.10, §4.18). */
  choices?: { label: string; checked: boolean; onSelect: () => void }[];
}

/**
 * sebaro's „Mehr“ (spec/02 §3.16, §4.10; AKT-10, EBE-07, FOR-05): the tool
 * `sb-icon-button--compact` with `more-horizontal`, always visible, named
 * „Mehr zu …“, with its tooltip (NAV-10), opening an `sb-menu` popover. The
 * browser opens and closes it (`popovertarget`); `sb-menu.js`, loaded by
 * index.html (ADR-0051 #21), adds `aria-expanded`, the place under the
 * button, the arrow keys, typed letters and the focus return. Rows are words
 * in the window density (32 px, `label`); a destructive row comes last after
 * a separator, the danger word with the trash, and opens its confirmation.
 * A row with `choices` opens a submenu of check rows (`menuitemradio`).
 *
 * The menu lives inside the element it acts on, so a click or a context
 * menu in it must not reach that element's own handlers (a card opens its
 * note on a click); every event stops here. Nothing in it starts a drag.
 */
export default function MoreMenu({ label, entries }: { label: string; entries: MoreEntry[] }) {
  const id = useId();
  const menu = `more${id}`;
  const tip = `tip${id}`;
  const stop = (event: SyntheticEvent) => event.stopPropagation();
  const plain = entries.filter((entry) => !entry.danger);
  const danger = entries.filter((entry) => entry.danger);

  const row = (entry: MoreEntry, index: number) => {
    if (entry.choices) {
      const sub = `${menu}-${index}`;
      return (
        <li role="none" key={entry.label}>
          <button
            className="sb-menu__item"
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-haspopup="menu"
            aria-expanded={false}
            popoverTarget={sub}
          >
            {entry.label}
            <span className="sb-menu__sub" aria-hidden="true">
              <Icon name="chevron-right" />
            </span>
          </button>
          <ul className="sb-menu" role="menu" id={sub} aria-label={entry.label} popover="auto">
            {entry.choices.map((choice) => (
              <li role="none" key={choice.label}>
                <button
                  className="sb-menu__item"
                  type="button"
                  role="menuitemradio"
                  tabIndex={-1}
                  aria-checked={choice.checked}
                  onClick={choice.checked ? undefined : choice.onSelect}
                >
                  <span className="sb-menu__check" aria-hidden="true">
                    <Icon name="check" />
                  </span>
                  {choice.label}
                </button>
              </li>
            ))}
          </ul>
        </li>
      );
    }
    return (
      <li role="none" key={entry.label}>
        <button
          className={entry.danger ? "sb-menu__item sb-menu__item--danger" : "sb-menu__item"}
          type="button"
          role="menuitem"
          tabIndex={-1}
          aria-disabled={entry.disabled || undefined}
          onClick={entry.disabled ? undefined : entry.onSelect}
        >
          {entry.danger && <Icon name="trash" size={20} />}
          {entry.label}
        </button>
      </li>
    );
  };

  return (
    <>
      <button
        className="sb-icon-button sb-icon-button--compact"
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={false}
        aria-describedby={tip}
        popoverTarget={menu}
        draggable={false}
        onClick={stop}
        onDoubleClick={stop}
        onContextMenu={stop}
      >
        <Icon name="more-horizontal" size={20} />
      </button>
      <span className="sb-tooltip" role="tooltip" id={tip} popover="manual">
        <span aria-hidden="true">{label}</span>
      </span>
      <ul
        className="sb-menu"
        role="menu"
        id={menu}
        aria-label={label}
        popover="auto"
        draggable={false}
        onClick={stop}
        onDoubleClick={stop}
        onContextMenu={stop}
        onDragStart={stop}
      >
        {plain.map(row)}
        {plain.length > 0 && danger.length > 0 && <li role="separator" className="sb-menu__sep" />}
        {danger.map((entry, index) => row(entry, plain.length + index))}
      </ul>
    </>
  );
}
