// DocTabs.tsx: the tabs of the open documents, at the top of the content.
import { useEffect, useRef, type KeyboardEvent } from "react";
import { reveal } from "./reveal";
import { Icon } from "./Icon";

export type DocTab = { id: string; name: string; icon: string; changed: boolean };

type Props = {
  label: string;
  tabs: DocTab[];
  selected: string | null;
  /** the hidden word after the name of a changed document: „, geändert“ */
  changedWord: string;
  closeWord: string;
  /** the keys that close a tab while it has the focus, as aria-keyshortcuts names them */
  closeKeys: string;
  onSelect(id: string): void;
  onClose(id: string): void;
};

/** The id of a tab's button and of its panel, which the owner draws: `<div role="tabpanel" id aria-labelledby>`. */
export const tabId = (id: string) => `tab-${id}`;
export const panelId = (id: string) => `panel-${id}`;

/** One tab stop: the arrows, Home and End choose and move the focus, Entf closes the tab with the focus. The cross
 *  and the middle button close by pointer. The chosen tab is scrolled into the row. */
export function DocTabs({ label, tabs, selected, changedWord, closeWord, closeKeys, onSelect, onClose }: Props) {
  const list = useRef<HTMLDivElement>(null);
  // the focus was on a tab before this render: it follows the chosen tab, also after its tab closed
  const held = useRef(false);

  useEffect(() => {
    const tab = selected ? document.getElementById(tabId(selected)) : null;
    if (tab?.parentElement && list.current) reveal(list.current, tab.parentElement);
    if (held.current) tab?.focus();
    held.current = false;
  }, [selected]);

  const choose = (id: string | undefined) => {
    if (!id) return;
    held.current = true;
    onSelect(id);
  };
  const onKeyDown = (event: KeyboardEvent, at: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowRight") choose(tabs[(at + 1) % tabs.length]?.id);
    else if (event.key === "ArrowLeft") choose(tabs[(at - 1 + tabs.length) % tabs.length]?.id);
    else if (event.key === "Home") choose(tabs[0]?.id);
    else if (event.key === "End") choose(tabs[tabs.length - 1]?.id);
    else if (event.key === "Delete") {
      held.current = true;
      onClose(tabs[at]?.id ?? "");
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div ref={list} className="sb-doc-tabs" data-sb-truncate role="tablist" aria-label={label} hidden={!tabs.length}>
      {tabs.map((tab, at) => (
        <span key={tab.id} className="sb-doc-tabs__item" role="presentation">
          <button
            className="sb-doc-tabs__tab"
            type="button"
            role="tab"
            id={tabId(tab.id)}
            aria-selected={tab.id === selected}
            aria-controls={panelId(tab.id)}
            aria-keyshortcuts={closeKeys}
            tabIndex={tab.id === selected ? 0 : -1}
            title={tab.name}
            onClick={() => onSelect(tab.id)}
            onAuxClick={(event) => event.button === 1 && onClose(tab.id)}
            onKeyDown={(event) => onKeyDown(event, at)}
          >
            {tab.changed && <Icon name="changed--16" size={16} className="sb-doc-tabs__mark" />}
            <Icon name={tab.icon} size={16} />
            {tab.name}
            {tab.changed && <span className="sb-visually-hidden">{changedWord}</span>}
          </button>
          <span className="sb-doc-tabs__close" aria-hidden="true" title={closeWord} onClick={() => onClose(tab.id)}>
            <Icon name="close--16" size={16} />
          </span>
        </span>
      ))}
    </div>
  );
}
