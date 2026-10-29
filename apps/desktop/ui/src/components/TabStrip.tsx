import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { dispatchCommand } from "../lib/commands";
import { previewKind } from "../lib/fileTypes";
import { ariaKeyshortcutsOf, bindingFor, glyphsOf } from "../lib/keymap";
import { fileNameOf, stemOf } from "../lib/paths";
import { useBoard } from "../stores/board";
import { useEditorSave } from "../stores/editorSave";
import { useTabs } from "../stores/tabs";
import { report, useUi } from "../stores/ui";
import { useVault, vaultIsEmpty } from "../stores/vault";
import Icon from "./Icon";

/**
 * A tab's drag payload (ADR-0028): its own type, so the tree — which reads
 * `text/plain` as a file and the ADR-0019 types as a board or card — and the
 * editor ignore a tab dropped on them. WebKit abandons a drag whose data
 * store is empty when dragstart returns, so the path goes in as the data.
 */
const TAB_DRAG_TYPE = "application/x-novalis-tab";

const isTabDrag = (event: DragEvent) => event.dataTransfer.types.includes(TAB_DRAG_TYPE);

/**
 * Scroll the tab row sideways, and only it, so `tab` stands inside it:
 * after the row's scroll padding and after the pinned tab, which
 * sebaro.css keeps at the row's start (`position: sticky`, D108 (4)), never
 * under it. React's counterpart of `sb-window.js`'s `revealTab` (spec/02
 * §4.21, ADR-0051 #21); `scrollIntoView` would also scroll the page and
 * leave the tab under the pinned one.
 */
export function revealTab(tab: HTMLElement): void {
  const list = tab.closest<HTMLElement>("[role='tablist']");
  const item = tab.closest<HTMLElement>(".sb-doc-tabs__item") ?? tab;
  if (!list || list.scrollWidth <= list.clientWidth) return;
  const row = list.getBoundingClientRect();
  const box = item.getBoundingClientRect();
  const style = getComputedStyle(list);
  const padding = parseFloat(style.scrollPaddingInlineStart) || 0;
  const rtl = style.direction === "rtl";
  let start = rtl ? row.right - padding : row.left + padding;
  const end = rtl ? row.left : row.right;
  const pinned = list.querySelector<HTMLElement>(".sb-doc-tabs__item--pinned");
  if (pinned && pinned !== item) {
    const pin = pinned.getBoundingClientRect();
    start = rtl ? Math.min(start, pin.left) : Math.max(start, pin.right);
  }
  let delta = 0;
  if (!rtl) {
    if (box.left < start) delta = box.left - start;
    else if (box.right > end) delta = Math.min(box.right - end, box.left - start);
  } else if (box.right > start) delta = box.right - start;
  else if (box.left < end) delta = Math.max(box.left - end, box.right - start);
  if (delta) list.scrollLeft += delta;
}

/** The one panel the current tab shows (App.tsx); every tab controls it. */
export const DOC_PANEL_ID = "doc-panel";
const BOARD_TAB_ID = "doc-tab-board";
const noteTabId = (index: number) => `doc-tab-${index}`;

/**
 * The open board's tab (ADR-0050): the one board at a time, first in the
 * strip, current while the board pane shows. A board shown by the toggle
 * before any was chosen is the board store's. It is sebaro's pinned tab
 * (spec/02 §4.21, D102 (5), ADR-0051 #35): it comes and goes with the board
 * tool and View ▸ Board only.
 */
function useBoardTab(): string | null {
  const boardVisible = useUi((s) => s.boardVisible);
  const chosenBoard = useUi((s) => s.activeBoard);
  const loadedBoard = useBoard((s) => s.slug);
  return chosenBoard ?? (boardVisible ? loadedBoard : null);
}

/**
 * The id of the current tab, which names the panel (`aria-labelledby`), or
 * `null` while none is current: no file open, or only a hidden board's tab.
 */
export function useCurrentTabId(): string | null {
  const boardSlug = useBoardTab();
  const boardVisible = useUi((s) => s.boardVisible);
  const index = useTabs((s) => (s.active ? s.tabs.indexOf(s.active) : -1));
  if (boardVisible) return boardSlug ? BOARD_TAB_ID : null;
  return index < 0 ? null : noteTabId(index);
}

/**
 * The one panel of the document tabs (spec/02 §4.21): what the current tab
 * shows, named by it. novalis shows one file at a time, so every tab
 * controls this panel; with nothing current it has no role.
 */
export function DocPanel({ children }: { children: ReactNode }) {
  const current = useCurrentTabId();
  return (
    <div
      className="sb-doc-tabs__panel nv-doc-panel"
      id={DOC_PANEL_ID}
      role={current ? "tabpanel" : undefined}
      aria-labelledby={current ?? undefined}
      tabIndex={current ? 0 : undefined}
    >
      {children}
    </div>
  );
}

const keyOf = (entry: { path: string | null }) => entry.path ?? BOARD_TAB_ID;

interface Entry {
  id: string;
  /** The note's path; `null` for the board's tab. */
  path: string | null;
  name: string;
  title: string;
  current: boolean;
  dirty: boolean;
}

/**
 * sebaro's document tabs (`sb-doc-tabs`, spec/02 §4.21, DSK-10; ADR-0051
 * #21): React writes sebaro's markup and keeps its key contract, the window
 * script is not loaded. 32 px rows that grow with the root font, the current
 * tab with the 3 px place line, the cross (`close--16`) on the current tab
 * and on the others while pointed at or focused. The cross is a pointer
 * shortcut, `aria-hidden` and without a tab stop (D94): the keyboard closes
 * the focused tab with Entf (fn ⌫ on a Mac keyboard) or ⌘W, announced by
 * `aria-keyshortcuts`; a middle click closes too. The tabs are one tab stop
 * (roving tabindex): ← → Pos1 Ende choose and focus a tab (automatic
 * activation); ⌃⇥ / ⌃⇧⇥ are the keymap's and step through the notes only.
 *
 * Long names are cut at the end with the full name in `title`
 * (`data-sb-truncate`): DSK-10 and spec/09 over ZUG-09, a recorded conflict
 * (docs/sebaro-luecken.md D „Reiter“). An unsaved note carries sebaro's
 * mark (`sb-doc-tabs__mark`, the dot `changed--16` before the name, D105 (5)) and the hidden
 * word „geändert“ (spec/02 §4.21, D102 (4)): novalis saves before it closes,
 * so closing never asks.
 *
 * The board's tab is sebaro's pinned tab (`sb-doc-tabs__item--pinned`,
 * D102 (5), ADR-0050 as amended by ADR-0051 #35): first, not draggable, not
 * in ⌃⇥, without a cross, with the hidden word „angeheftet“ (spec/02
 * §4.21), and Entf, ⌘W or a middle click do not close it;
 * the board tool and View ▸ Board show and hide it; it stays at the row's
 * start while the row scrolls (sebaro.css, D108 (4)). With nothing current the sentence `sb-doc-tabs__none` says how to
 * open a note. The preview switch (⌘E, ADR-0051 #16) is sebaro's compact
 * switch with the eye and its word (D102 (2), D105 (2)); it stands beside the row, outside its
 * scrolling, so many tabs never push it out of sight.
 */
export default function TabStrip() {
  const { t } = useTranslation();
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const tabs = useTabs((s) => s.tabs);
  const active = useTabs((s) => s.active);
  const docs = useEditorSave((s) => s.docs);
  const previewing = useUi((s) => (active ? !!s.previewing[active] : false));
  const boardVisible = useUi((s) => s.boardVisible);
  const boardSlug = useBoardTab();
  const boardName = useBoard((s) => s.boards.find((b) => b.slug === boardSlug)?.name ?? boardSlug);
  const currentId = useCurrentTabId();
  const noneRef = useRef<HTMLParagraphElement>(null);
  const root = useVault((s) => s.children[""]);
  const boards = useBoard((s) => s.boards);
  const empty = useMemo(() => root !== undefined && vaultIsEmpty({ "": root }, boards), [root, boards]);
  // The tab that has focus, by its key: once it is gone, however it was
  // closed (Entf, ⌘W, a middle click), focus goes to the tab that became
  // current, else to the sentence (spec/02 §4.21).
  const focused = useRef<string | null>(null);

  const entries: Entry[] = [
    ...(boardSlug
      ? [{ id: BOARD_TAB_ID, path: null, name: boardName ?? "", title: boardName ?? "", current: boardVisible, dirty: false }]
      : []),
    ...tabs.map((path, index) => ({
      id: noteTabId(index),
      path,
      name: stemOf(path),
      title: fileNameOf(path),
      current: !boardVisible && path === active,
      dirty: !!docs[path]?.dirty,
    })),
  ];
  // The one tab stop: the current tab, else the first.
  const stop = currentId ?? entries[0]?.id ?? null;

  // The current tab is scrolled into the row's view (docs/sebaro-luecken.md
  // D „Reiter“), however it became current: a click, ⌃⇥, the tree. Chosen
  // by a key while a tab has focus (⌃⇥, ⌘1…9), it takes the focus too, as
  // sebaro's tabs do (spec/02 §4.21), so the one tab stop and the focus stay
  // together; focus anywhere else is left where it is.
  useEffect(() => {
    if (!currentId) return;
    const tab = document.getElementById(currentId);
    if (tab) revealTab(tab);
    const focus = document.activeElement;
    if (
      tab &&
      focus instanceof HTMLElement &&
      focus !== tab &&
      focus.getAttribute("role") === "tab" &&
      focus.closest(".sb-doc-tabs")
    ) {
      tab.focus();
    }
  }, [currentId]);

  useEffect(() => {
    const gone = focused.current;
    if (gone === null || entries.some((entry) => keyOf(entry) === gone)) return;
    focused.current = null;
    // Only focus that fell with the tab is handed on, never focus that is
    // somewhere else by now.
    if (document.activeElement && document.activeElement !== document.body) return;
    (currentId ? document.getElementById(currentId) : noneRef.current)?.focus();
  });

  const choose = (entry: Entry) => {
    if (entry.path === null) useUi.getState().setActiveBoard(boardSlug);
    else void useTabs.getState().activate(entry.path).catch(report);
  };

  // The board's pinned tab is not closed here (D102 (5), ADR-0051 #35).
  const close = (entry: Entry) => {
    if (entry.path !== null) void useTabs.getState().close(entry.path).catch(report);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const entry = entries[index]!;
    focused.current = keyOf(entry);
    if (event.key === "Delete") {
      event.preventDefault();
      close(entry);
      return;
    }
    const last = entries.length - 1;
    const to =
      event.key === "ArrowRight"
        ? (index + 1) % entries.length
        : event.key === "ArrowLeft"
          ? (index - 1 + entries.length) % entries.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (to === null) return;
    event.preventDefault();
    const target = entries[to]!;
    document.getElementById(target.id)?.focus();
    choose(target);
  };

  const dropOn = (event: DragEvent, index: number) => {
    if (!isTabDrag(event)) return;
    event.preventDefault();
    setDropAt(null);
    useTabs.getState().move(event.dataTransfer.getData(TAB_DRAG_TYPE), index);
  };

  const overAt = (event: DragEvent, index: number) => {
    if (!isTabDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropAt(index);
  };

  // A tab dragged rightward lands after the one it is dropped on (`move`
  // takes it out first), leftward before it: the line stands on that side.
  const from = dragging === null ? -1 : tabs.indexOf(dragging);
  const hasPreview = !!active && !boardVisible && !!previewKind(active);
  const previewChord = bindingFor("note.togglePreview")?.chord;

  return (
    <>
      {entries.length > 0 && (
        <div className="nv-doc-head">
          <div
            className="sb-doc-tabs"
            role="tablist"
            aria-label={t("tabs.label")}
            onDragLeave={() => setDropAt(null)}
          >
            {entries.map((entry, index) => {
              // Index among the notes: the board's tab is not one of them.
              const at = index - (boardSlug ? 1 : 0);
              const state =
                entry.path !== null && entry.path === dragging
                  ? "dragging"
                  : entry.path !== null && dropAt === at
                    ? from >= 0 && from < at
                      ? "drop-after"
                      : "drop-before"
                    : undefined;
              return (
                <span
                  className={entry.path === null ? "sb-doc-tabs__item sb-doc-tabs__item--pinned" : "sb-doc-tabs__item"}
                  role="presentation"
                  key={keyOf(entry)}
                  data-sb-state={state}
                  draggable={entry.path !== null}
                  onDragStart={
                    entry.path === null
                      ? undefined
                      : (event) => {
                          event.dataTransfer.setData(TAB_DRAG_TYPE, entry.path!);
                          event.dataTransfer.effectAllowed = "move";
                          setDragging(entry.path);
                        }
                  }
                  onDragOver={entry.path === null ? undefined : (event) => overAt(event, at)}
                  onDrop={entry.path === null ? undefined : (event) => dropOn(event, at)}
                  onDragEnd={() => {
                    setDropAt(null);
                    setDragging(null);
                  }}
                  onMouseDown={(event) => {
                    if (event.button === 1) {
                      event.preventDefault();
                      close(entry);
                    }
                  }}
                >
                  <button
                    className="sb-doc-tabs__tab"
                    type="button"
                    role="tab"
                    id={entry.id}
                    aria-selected={entry.current}
                    aria-controls={DOC_PANEL_ID}
                    aria-keyshortcuts={entry.path === null ? undefined : "Meta+W Delete"}
                    tabIndex={entry.id === stop ? 0 : -1}
                    title={entry.title}
                    data-sb-truncate=""
                    onClick={() => choose(entry)}
                    onFocus={() => (focused.current = keyOf(entry))}
                    // Focus that leaves for somewhere else is not handed back;
                    // focus that goes nowhere (the tab removed, the window
                    // left) may be.
                    onBlur={(event) => {
                      if (event.relatedTarget) focused.current = null;
                    }}
                    onKeyDown={(event) => onKeyDown(event, index)}
                  >
                    {/* The „geändert“ mark first, then the file's kind
                        (spec/02 §4.21): the board's icon. */}
                    {entry.dirty && <Icon name="changed" className="sb-doc-tabs__mark" />}
                    {entry.path === null && <Icon name="board" />}
                    {entry.name}
                    {entry.dirty && <span className="sb-visually-hidden">{t("tabs.unsaved")}</span>}
                    {entry.path === null && <span className="sb-visually-hidden">{t("tabs.pinned")}</span>}
                  </button>
                  {entry.path !== null && (
                    <span
                      className="sb-doc-tabs__close"
                      aria-hidden="true"
                      title={t("menu.file.closeTab")}
                      // A press on the cross leaves focus where it is.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => close(entry)}
                    >
                      <Icon name="close" />
                    </span>
                  )}
                </span>
              );
            })}
            {/* Where a tab dropped after the last one lands (ADR-0028). */}
            <span
              className="nv-doc-tabs__end"
              role="presentation"
              data-sb-state={dropAt === tabs.length ? "drop-before" : undefined}
              onDragOver={(event) => overAt(event, tabs.length)}
              onDrop={(event) => dropOn(event, tabs.length)}
            />
          </div>
          {/* The preview switch (ADR-0020, ADR-0051 #16): sebaro's compact
              switch with the eye before its word (spec/02 §4.17, D102 (2),
              D105 (2): 20 px, never the eye alone), its state in
              `aria-pressed`, `Cmd+E` in `aria-keyshortcuts`. Only a file
              with a second representation has it — a note, a CSV or TSV, an
              SVG (ADR-0025) — so it is not there for a PDF. */}
          {hasPreview && (
            <div className="nv-doc-head__tools">
              <button
                className="sb-secondary-action sb-secondary-action--compact"
                type="button"
                aria-pressed={previewing}
                aria-keyshortcuts={previewChord ? ariaKeyshortcutsOf(previewChord) : undefined}
                data-sb-own-shortcut=""
                onClick={() => dispatchCommand("note.togglePreview")}
              >
                <Icon name="eye" size={20} />
                {t("editor.preview")}
              </button>
            </div>
          )}
        </div>
      )}
      {/* The board pane says its own empty state. In an empty vault there
          is nothing to choose and nothing for ⌘P to find: the sentence
          names no action, the sidebar's empty state does (spec/07 §4.8,
          ADR-0051 #58). */}
      {!currentId && !boardVisible && (
        <p className="sb-doc-tabs__none" ref={noneRef} tabIndex={-1}>
          {empty ? t("editor.emptyStateNothing") : t("editor.emptyState", { chord: glyphsOf("Cmd+P") })}
        </p>
      )}
    </>
  );
}
