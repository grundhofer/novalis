import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { formatDay } from "../i18n";
import { afterDialog, areaOf } from "../lib/areas";
import { dispatchCommand, moveEntry, openTreeContextMenu } from "../lib/commands";
import { ariaKeyshortcutsOf, bindingFor, isOwnChord } from "../lib/keymap";
import { copyIntoFolder } from "../lib/attachments";
import { NO_DRAG_IMAGE } from "../lib/dragImage";
import { folderOf, nsToMs } from "../lib/paths";
import { windowRowHeight } from "../lib/windowRow";
import { BOARD_DRAG_TYPE, CARD_DRAG_TYPE, ENTRY_DRAG_TYPE, useBoard } from "../stores/board";
import { useFiles } from "../stores/files";
import { useTabs } from "../stores/tabs";
import { report, sidebarShown, useUi } from "../stores/ui";
import { treeRows, useVault, type TreeRow } from "../stores/vault";
import { FileName } from "./FileName";
import Icon from "./Icon";
import Tool from "./Tool";

/**
 * The sidebar (sebaro's `sb-side-nav sb-window__sidebar`, spec/02 §4.3,
 * §4.17, NAV-04): the place „Heutige Notiz“, the vault's name with the head
 * tools, the sort, the tree, and the place „Einstellungen“ bottom left
 * (DSK-02). Its width is the store's (240 px, 200–360; D100, DSK-07), set
 * by the divider beside it (SidebarResize). No number stands on it
 * (HAL-05): the totals are the action zone's state sentence (STA-07).
 *
 * The tree: sebaro's `sb-tree` (spec/02 §4.14, NAV-11), virtualized
 * (`@tanstack/react-virtual`), folders first, board items. It is flat: each
 * row is an `sb-row sb-tree__row` with its `aria-level`, from which
 * sebaro.css indents it; no group is nested (the virtualizer draws a
 * window of rows). Rows stay one line, the full name in `title`
 * (ADR-0051 #24); their height grows with the root font (`windowRowHeight`).
 * A row's state is glyph and word in `sb-row__meta` (STA-08); where it does
 * not fit beside the name, sebaro.css puts it on a line of its own under the
 * name (D108 (1)) and the virtualizer measures that row (`measureElement`).
 *
 * Rows come from the folders that are loaded; opening a folder costs one
 * `list_dir` and a watcher batch patches what is already there. Nothing here
 * ever triggers a walk (PLAN.md §2.3 rules 1 and 5).
 *
 * The head carries the three tools of ADR-0012 (new note, new folder,
 * board) and the sort switch below it; both go through `dispatchCommand`
 * and the stores, so a click here and the menu item do the same thing.
 *
 * A file row drags and a folder row takes the drop (ADR-0018); the tree's
 * own space below the rows is the vault root. The payload is the path in
 * `text/plain` — WebKit abandons a drag whose data store is empty when
 * dragstart returns, so the drop would never fire (see BoardPane).
 *
 * A board row drags too (ADR-0019), under its own type, and takes two kinds
 * of drop: another board, placed after it, and a card of the open board
 * (from BoardPane), moved to it. A board dropped on the tree's space goes
 * last. Which kind a drag is comes from `dataTransfer.types`: the data
 * itself is unreadable until the drop, and the types are what keeps a file
 * off a board row and a board off a folder. The marks are sebaro's
 * (spec/02 §4.22, DSK-11), in `data-sb-state`: the dragged row keeps a 2 px
 * ink frame, a folder or board that takes the row a 3 px cobalt frame, a
 * board placed after another the 3 px cobalt line below it. HTML drag and
 * drop stays (the Finder's files arrive by it, ADR-0041), sebaro's pointer
 * drag is not built (docs/sebaro-umbau.md §6 B).
 */

/** How long typed letters add up to one name (spec/02 §4.14). */
const TYPEAHEAD_MS = 500;

type DragKind = "file" | "board" | "card" | "finder";

/** What a drag carries, by the types it declares. */
function dragKind(dataTransfer: DataTransfer): DragKind | null {
  const { types } = dataTransfer;
  // A card carries `text/plain` as well (BoardPane), so its own type decides first.
  if (types.includes(CARD_DRAG_TYPE)) return "card";
  if (types.includes(BOARD_DRAG_TYPE)) return "board";
  if (types.includes("text/plain")) return "file";
  // Files from the Finder (ADR-0041): copied, never moved.
  if (types.includes("Files")) return "finder";
  return null;
}

/** True over the tree's own space, not over a row: there the root is the target. */
function overTreeSpace(event: DragEvent<HTMLDivElement>): boolean {
  const target = event.target as Element;
  // The empty state stands in that space, its words included.
  return target === event.currentTarget || target.classList.contains("sb-tree") || !!target.closest(".sb-empty");
}

/**
 * Where a drag over a row would land (spec/02 §4.22, DSK-11): into a folder
 * or a board (a file, a card), or after a board (another board). The path
 * `ROOT_DROP` is the tree's free space under its rows, the vault root: the
 * whole tree takes the frame then (`.sb-tree[data-sb-state]`, D102, NV-G6).
 */
type Drop = { path: string; state: "drop-into" | "drop-after" };
const ROOT_DROP = "";

/** sebaro.css indents levels 1–8; a deeper row sets the indent itself (spec/02 §4.14). */
const STYLED_LEVELS = 8;

/**
 * Each row's place in its set of siblings (`aria-posinset`, `aria-setsize`;
 * NAV-11): the tree is flat and only a window of it is drawn, so a screen
 * reader cannot count the siblings from the DOM. Siblings share a depth and
 * the folder above them; the boards stand with the root's rows.
 */
function siblingSets(rows: TreeRow[]): { posinset: number[]; setsize: number[] } {
  /** The last row seen at each depth: the parent of the next row one deeper. */
  const lastAt: number[] = [];
  const parents = rows.map((row, index) => {
    const parent = row.depth > 0 ? (lastAt[row.depth - 1] ?? -1) : -1;
    lastAt[row.depth] = index;
    lastAt.length = row.depth + 1;
    return parent;
  });
  const counts = new Map<number, number>();
  const posinset = parents.map((parent) => {
    const position = (counts.get(parent) ?? 0) + 1;
    counts.set(parent, position);
    return position;
  });
  return { posinset, setsize: parents.map((parent) => counts.get(parent) ?? 0) };
}

/**
 * A sidebar with a foot (spec/02 §4.17, D105 (46)): its upper block
 * (places, head, sort and tree) scrolls by itself in `sb-side-nav__scroll`
 * when large text leaves it too little height, and the tree keeps a
 * scroller of its own with four rows (NV-Z9), so a row could lie under the
 * foot or inside the tree's scroller. Every scroller from `element` up to
 * the block scrolls, innermost first, by the least amount that shows
 * `element` in it; the block also shows the lower edge of the scroller just
 * inside it, as far as its height allows. Only these scroll, never the
 * page or the content. React's counterpart of `sb-window.js`'s
 * `revealInSideNav` (CHECKS §38, ADR-0051 #21): it runs when something in
 * the block takes focus, and a command that shows a row without focus
 * calls it with the tree (docs/sebaro-luecken.md Z4).
 */
export function revealInSideNav(element: Element | null): void {
  const block = element?.closest<HTMLElement>(".sb-side-nav__scroll");
  if (!element || !block || element === block) return;
  let outer: HTMLElement | null = null;
  for (let up = element.parentElement; up; up = up.parentElement) {
    const overflow = getComputedStyle(up).overflowY;
    const scrolls =
      up === block || ((overflow === "auto" || overflow === "scroll") && up.scrollHeight > up.clientHeight);
    if (scrolls) {
      const box = up.getBoundingClientRect();
      const shown = element.getBoundingClientRect();
      const bottom = up === block && outer ? Math.max(shown.bottom, outer.getBoundingClientRect().bottom) : shown.bottom;
      const top = box.top + up.clientTop;
      const end = top + up.clientHeight;
      let delta = 0;
      if (bottom > end) delta = Math.min(bottom - end, shown.top - top);
      else if (shown.top < top) delta = shown.top - top;
      if (delta) up.scrollTop += delta;
      if (up !== block) outer = up;
    }
    if (up === block) break;
  }
}

export default function Sidebar() {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement | null>(null);
  /** The row a drag is over and how it would land, for its mark. */
  const [over, setOver] = useState<Drop | null>(null);
  /** The row being dragged, for its ink frame. */
  const [dragging, setDragging] = useState<string | null>(null);
  /** One line at the root font in use (RAU-06, ADR-0051 #24), measured again when it changes. */
  const [rowHeight, setRowHeight] = useState(windowRowHeight);
  /** An unseen window row whose height follows the root font. */
  const probe = useRef<HTMLSpanElement | null>(null);
  const sidebarWidth = useUi((s) => s.sidebarWidth);
  // What shows: beside the content, or over it while its overlay is open.
  const sidebarVisible = useUi(sidebarShown);
  const vault = useVault((s) => s.vault);
  const children = useVault((s) => s.children);
  const expanded = useVault((s) => s.expanded);
  const selected = useVault((s) => s.selected);
  const focused = useVault((s) => s.focused);
  const takeFocus = useVault((s) => s.takeFocus);
  const showFocused = useVault((s) => s.showFocused);
  const activeTab = useTabs((s) => s.active);
  const boardVisible = useUi((s) => s.boardVisible);
  const settingsView = useUi((s) => s.settingsView);
  const treeSort = useUi((s) => s.treeSort);
  const boards = useBoard((s) => s.boards);

  const rows: TreeRow[] = useMemo(
    () => treeRows(children, expanded, treeSort, boards),
    [children, expanded, treeSort, boards],
  );
  const sets = useMemo(() => siblingSets(rows), [rows]);
  /** The one chosen row, the current place (`aria-selected`, spec/02 §4.14). */
  const chosen = selected ?? activeTab;

  /**
   * The tree's one tab stop (NAV-11, spec/02 §4.14): the row the keys are
   * on, else the chosen one, else the active tab's, else the first.
   */
  const stop = useMemo(() => {
    for (const path of [focused, selected, activeTab]) {
      const index = path ? rows.findIndex((r) => r.entry.path === path) : -1;
      if (index >= 0) return index;
    }
    return rows.length > 0 ? 0 : -1;
  }, [rows, focused, selected, activeTab]);

  const hasVault = !!vault;
  // The root font changed (large text, ZUG-09): the probe's height did too,
  // so the rows take the new height while the sidebar stays open.
  useEffect(() => {
    const element = probe.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => setRowHeight(windowRowHeight()));
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasVault]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    // The tab stop is always drawn, scrolled out or not, so Tab finds it
    // and the focus it holds is not lost with an unmounted row.
    rangeExtractor: (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      return stop < 0 || indexes.includes(stop) ? indexes : [...indexes, stop].sort((a, b) => a - b);
    },
  });

  // Rows drawn at the old height are placed again at the new one.
  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  // A key moved focus, or a command asked for it (Move To…): the row is
  // scrolled into view and, when asked, takes the keyboard once it is drawn.
  // A hidden sidebar stays mounted: the request waits until it shows.
  useEffect(() => {
    if (!sidebarVisible || (!takeFocus && !showFocused)) return;
    if (stop >= 0) {
      virtualizer.scrollToIndex(stop);
      revealInSideNav(scroller.current);
    }
    if (takeFocus) {
      const path = rows[stop]?.entry.path;
      // Asked for by a dialog's action (Rename, New Folder): once it has closed.
      afterDialog(() => {
        const row = [...(scroller.current?.querySelectorAll<HTMLElement>("[role=treeitem]") ?? [])].find(
          (element) => element.dataset.path === path,
        );
        row?.focus({ preventScroll: true });
      });
    }
    useVault.setState({ takeFocus: false, showFocused: false });
  }, [sidebarVisible, takeFocus, showFocused, rows, stop, virtualizer]);

  // The keys' row counts only while the tree has the keyboard (NAV-11):
  // focus that lands in another area hands the tree commands back to the
  // chosen row, whose mark stays in sight. The palette, a dialog or a native
  // menu lie in no area, so a command given there still finds the keys' row.
  // Focus that comes back to a row without a key (F6, a press without a
  // click) makes that row the keys' row, so they act where the ring is.
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const area = event.target instanceof Element ? areaOf(event.target) : null;
      if (area?.id === "sidebar") {
        const path =
          event.target instanceof HTMLElement
            ? event.target.closest<HTMLElement>("[role=treeitem]")?.dataset.path
            : undefined;
        if (path && path !== useVault.getState().focused) useVault.getState().focus(path);
        return;
      }
      if (!area) return;
      const { focused, selected } = useVault.getState();
      if (focused !== selected) useVault.getState().focus(selected);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  /** Typed letters, for the jump to a row by name. */
  const typed = useRef<{ text: string; timer?: ReturnType<typeof setTimeout> }>({ text: "" });

  const openRow = (row: TreeRow) => {
    const { entry } = row;
    useVault.getState().select(entry.path);
    if (entry.boardSlug) {
      useUi.getState().setActiveBoard(entry.boardSlug);
      void useBoard.getState().load(entry.boardSlug).catch(report);
      return;
    }
    if (entry.dir) {
      void useVault.getState().toggleFolder(entry.path).catch(report);
      return;
    }
    void useTabs.getState().open(entry.path).catch(report);
  };

  /**
   * The tree's own keys (NAV-11, spec/02 §4.14) — keys inside a widget, like
   * the palette's arrows, not app chords (docs/KEYMAP.md "Not listed"). They
   * move focus only and never open anything: ↑/↓ the next / previous row,
   * Home / End the first / last, → opens a folder or steps into it, ← closes
   * it or steps to its parent, letters jump to the next row whose name
   * starts with them (500 ms). Enter or Space opens the row as a click does
   * (ADR-0051 #12), and so does ⌘↓ (Finder). ⌘⌫ stays the keymap's trash.
   */
  const onTreeKey = (event: KeyboardEvent<HTMLElement>) => {
    const { key, metaKey, altKey, ctrlKey, shiftKey } = event;
    if (altKey || ctrlKey) return;
    const row = rows[stop];
    const move = (index: number) => {
      const target = rows[Math.max(0, Math.min(index, rows.length - 1))];
      if (!target) return;
      useVault.getState().focus(target.entry.path, true);
      virtualizer.scrollToIndex(rows.indexOf(target));
      revealInSideNav(scroller.current);
    };
    const isFolder = (r: TreeRow | undefined) => !!r && r.entry.dir && !r.entry.boardSlug;
    if (metaKey) {
      if (key !== "ArrowDown" || shiftKey) return;
      if (row) openRow(row);
    } else if (key.length === 1 && key !== " ") {
      // Shift only makes a capital, which matches like the small letter.
      if (!/\S/.test(key)) return;
      move(typeahead(key));
    } else if (shiftKey) {
      return;
    } else if (key === "ArrowDown") {
      move(stop + 1);
    } else if (key === "ArrowUp") {
      move(stop - 1);
    } else if (key === "Home") {
      move(0);
    } else if (key === "End") {
      move(rows.length - 1);
    } else if (key === "ArrowRight") {
      if (!row || !isFolder(row)) return;
      if (!row.expanded) void useVault.getState().toggleFolder(row.entry.path).catch(report);
      else if (rows[stop + 1]?.depth === row.depth + 1) move(stop + 1);
    } else if (key === "ArrowLeft") {
      if (!row) return;
      if (isFolder(row) && row.expanded) {
        void useVault.getState().toggleFolder(row.entry.path).catch(report);
      } else if (row.depth > 0) {
        const parent = folderOf(row.entry.path);
        move(rows.findIndex((r) => r.entry.path === parent));
      }
    } else if (key === "Enter" || key === " ") {
      if (row) openRow(row);
    } else {
      return;
    }
    event.preventDefault();
  };

  /**
   * The row typed letters lead to, as sebaro's tree finds it: the same
   * letter again goes on to the next row with it, more letters search
   * from the row focus is on. Where nothing matches, focus stays.
   */
  const typeahead = (character: string): number => {
    const state = typed.current;
    clearTimeout(state.timer);
    state.text += character.toLowerCase();
    state.timer = setTimeout(() => {
      state.text = "";
    }, TYPEAHEAD_MS);
    const letters = [...state.text];
    const single = letters.every((letter) => letter === letters[0]);
    for (let step = 1; step <= rows.length; step += 1) {
      const index = (stop + (single ? step : step - 1) + rows.length) % rows.length;
      const name = rows[index]?.entry.name.toLowerCase() ?? "";
      if (name.startsWith(single ? (letters[0] ?? "") : state.text)) return index;
    }
    return stop;
  };

  /**
   * Images and PDFs dropped from the Finder on a folder (ADR-0041): copied
   * there, never over a file. Anything else is said once, not copied.
   */
  const dropFinder = (event: DragEvent<HTMLDivElement>, toFolder: string) => {
    event.preventDefault();
    setOver(null);
    const files = [...event.dataTransfer.files];
    void (async () => {
      let refused = 0;
      for (const file of files) {
        if ((await copyIntoFolder(toFolder, file)) === null) refused += 1;
      }
      await useVault.getState().reload(toFolder);
      await useFiles.getState().refresh();
      if (refused > 0) useUi.getState().showMessage("tree.dropRefused", { count: refused });
    })().catch(report);
  };

  const dropInto = (event: DragEvent<HTMLDivElement>, toFolder: string) => {
    const path = event.dataTransfer.getData("text/plain");
    setOver(null);
    void moveEntry(path, toFolder).catch(report);
  };

  /** A board dropped on board row `after`, or on the tree's space (`null`): last. */
  const dropBoard = (event: DragEvent<HTMLDivElement>, after: string | null) => {
    const slug = event.dataTransfer.getData(BOARD_DRAG_TYPE);
    setOver(null);
    // On its own row: already there.
    if (!slug || slug === after) return;
    void useBoard
      .getState()
      .placeBoard(slug, after ? { kind: "after", id: after } : { kind: "last" })
      .catch(report);
  };

  const dropCard = (event: DragEvent<HTMLDivElement>, board: string) => {
    const id = event.dataTransfer.getData(CARD_DRAG_TYPE);
    setOver(null);
    if (!id) return;
    void useBoard.getState().moveCardToBoard(id, board).catch(report);
  };

  // A named region: one of the areas F6 moves through (spec/02 §4.20), and
  // what the divider's `aria-controls` names.
  // Hidden, it stays in the page (spec/02 §4.17: the part carries `hidden`),
  // so the title bar's tool and the divider always name it; F6 skips it.
  const navProps = {
    className: "sb-side-nav sb-window__sidebar",
    id: "sidebar",
    hidden: !sidebarVisible,
    "aria-label": t("sidebar.label"),
    style: { inlineSize: `${sidebarWidth}px` },
  };
  const settingsChord = bindingFor("settings.open")?.chord;
  // The place „Einstellungen“ bottom left, icon and word (DSK-02, NAV-10):
  // it opens the settings view, and while the view shows it is the current
  // place, the place line and the filled icon (NAV-01). It announces
  // sebaro's fixed ⌘, (spec/02 §4.19). No second total here (STA-07,
  // HAL-05). The word is one word: where it alone does not fit its line it
  // takes a hyphen (ZUG-09), the job sb-fit.js would do
  // (docs/sebaro-luecken.md J). The foot is sebaro's `sb-side-nav__foot`
  // (spec/02 §4.17, D105 (46)).
  const foot = (
    <div className="sb-side-nav__foot">
      <ul>
        <li>
          <button
            className="sb-side-nav__item"
            type="button"
            aria-current={settingsView ? "page" : undefined}
            aria-keyshortcuts={settingsChord ? ariaKeyshortcutsOf(settingsChord) : undefined}
            onClick={() => dispatchCommand("settings.open")}
          >
            <Icon name={settingsView ? "settings--filled" : "settings"} size={20} />
            <span className="sb-hyphenate">{t("sidebar.settings")}</span>
          </button>
        </li>
      </ul>
    </div>
  );
  // Without a vault there is no place, head or tree, but „Einstellungen“
  // keeps its place bottom left (ADR-0051 #1, #47; DSK-02): the empty
  // scroll part above holds the foot at the sidebar's end
  // (docs/sebaro-luecken.md Z).
  if (!vault)
    return (
      <nav {...navProps}>
        <div className="sb-side-nav__scroll" />
        {foot}
      </nav>
    );

  const todayChord = bindingFor("file.todayNote")?.chord;
  /** The root is listed and holds nothing: the tree's empty state (DAT-07). */
  const empty = rows.length === 0 && children[""] !== undefined;

  return (
    <nav {...navProps}>
      {/* sebaro's two parts of a sidebar with a foot (spec/02 §4.17,
          D105 (46)): places, head, sort and tree scroll together in
          `sb-side-nav__scroll` when large text leaves them too little
          height; the foot below never scrolls, so it never lies over a row
          (DSK-02). */}
      <div className="sb-side-nav__scroll" onFocus={(event) => revealInSideNav(event.target)}>
        {/* A place: icon and word (NAV-10, NAV-02), in its own list before the
            head that labels the tree (spec/02 §4.3, §4.14). The note it opens
            carries the place line in the tree, so this row never does. */}
        <ul>
          <li>
            <button
              className="sb-side-nav__item"
              type="button"
              aria-keyshortcuts={todayChord ? ariaKeyshortcutsOf(todayChord) : undefined}
              data-sb-own-shortcut={todayChord && isOwnChord(todayChord) ? "" : undefined}
              onClick={() => dispatchCommand("file.todayNote")}
            >
              <Icon name="home" size={20} />
              {t("tree.todayNote")}
            </button>
          </li>
        </ul>

        {/* The vault's name labels the tree in sebaro's group head with its
            tools (spec/02 §4.17, D104 (36)): `sb-side-nav__name` names the
            tree, the tools stand at its end in `sb-side-nav__tools` (NAV-10,
            ADR-0012): new note, new folder, and the board, which stays an
            icon (ADR-0051 #27.9). The name is a folder's: it breaks after
            - . _ / (D100 (6)). */}
        <div className="sb-side-nav__head">
          <p className="sb-side-nav__name" id="sidebar-vault">
            <FileName name={vault.name} />
          </p>
          <div className="sb-side-nav__tools" role="group" aria-label={vault.name}>
            <Tool
              id="new-note"
              icon="plus"
              label={t("menu.file.newNote")}
              command="file.newNote"
              onClick={() => dispatchCommand("file.newNote")}
            />
            <Tool
              id="new-folder"
              icon="folder"
              label={t("menu.file.newFolder")}
              command="tree.newFolder"
              onClick={() => dispatchCommand("tree.newFolder")}
            />
            <Tool
              id="board"
              icon="board"
              label={t("tree.board")}
              command="board.toggle"
              pressed={boardVisible && !settingsView}
              onClick={() => dispatchCommand("board.toggle")}
            />
          </div>
        </div>

        {/* The sort (ADR-0012) in sebaro's sort choice (spec/02 §4.14,
            D102 (3)): compact switches with their word, the chosen one
            pressed with its direction as `arrow-up--16` / `arrow-down--16`
            and the hidden word. The directions are fixed: name ascending,
            modified newest first (a second press turns nothing). */}
        <div className="sb-sort-choice" role="group" aria-label={t("tree.sort")}>
          <button
            className="sb-secondary-action sb-secondary-action--compact"
            type="button"
            title={t("tree.sortByName")}
            aria-pressed={treeSort === "name"}
            onClick={() => useUi.getState().setTreeSort("name")}
          >
            {t("tree.columnName")}
            <Icon name="arrow-up" />
            {treeSort === "name" && <span className="sb-visually-hidden">{t("tree.sortAscending")}</span>}
          </button>
          <button
            className="sb-secondary-action sb-secondary-action--compact"
            type="button"
            title={t("tree.sortByModified")}
            aria-pressed={treeSort === "modified"}
            onClick={() => useUi.getState().setTreeSort("modified")}
          >
            {t("tree.columnModified")}
            <Icon name="arrow-down" />
            {treeSort === "modified" && <span className="sb-visually-hidden">{t("tree.sortDescending")}</span>}
          </button>
        </div>

        <div
          className="nv-tree"
          ref={scroller}
          onDragOver={(event) => {
            // A row that is not a target lets the event through; refusing it
            // here keeps a file row from reading as a target. A card has no
            // place in the tree's space either.
            const space = overTreeSpace(event);
            const kind = dragKind(event.dataTransfer);
            if (!space || (kind !== "file" && kind !== "board" && kind !== "finder")) {
              setOver((current) => (current?.path === ROOT_DROP ? null : current));
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = kind === "finder" ? "copy" : "move";
            if (over?.path !== ROOT_DROP) setOver({ path: ROOT_DROP, state: "drop-into" });
          }}
          onDragLeave={(event) => {
            if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
            setOver((current) => (current?.path === ROOT_DROP ? null : current));
          }}
          onDrop={(event) => {
            if (!overTreeSpace(event)) return;
            const kind = dragKind(event.dataTransfer);
            if (kind === "file") dropInto(event, "");
            else if (kind === "board") dropBoard(event, null);
            else if (kind === "finder") dropFinder(event, "");
          }}
        >
          <span className="sb-row nv-tree__probe" ref={probe} aria-hidden="true">
            {"\u00a0"}
          </span>
          {empty ? (
            // sebaro's empty state (DAT-07, spec/02 §3.14): what is missing and
            // how the tree fills; the action is the zone's „Neue Notiz“.
            <div className="sb-empty">
              <h2 className="sb-empty__title">{t("tree.emptyTitle")}</h2>
              <p className="sb-empty__text">{t("tree.empty")}</p>
            </div>
          ) : (
            <ul
              className="sb-tree"
              role="tree"
              aria-labelledby="sidebar-vault"
              data-sb-state={over?.path === ROOT_DROP ? "drop-into" : undefined}
              style={{ blockSize: `${virtualizer.getTotalSize()}px` }}
              onKeyDown={onTreeKey}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index];
                if (!row) return null;
                const { entry } = row;
                const active = entry.path === chosen;
                const isBoard = !!entry.boardSlug;
                const isFolder = entry.dir && !isBoard;
                const draggable = !entry.dir || isBoard;
                // A folder takes a file; a board takes a board or a card.
                const accepts: DragKind[] = isBoard ? ["board", "card"] : entry.dir ? ["file", "finder"] : [];
                const dropTarget = accepts.length > 0;
                const level = row.depth + 1;
                const state =
                  over?.path === entry.path ? over.state : dragging === entry.path ? "dragging" : undefined;

                return (
                  <li
                    role="none"
                    className="nv-tree__slot"
                    key={entry.path}
                    style={{ blockSize: `${item.size}px`, transform: `translateY(${item.start}px)` }}
                  >
                    <div
                      ref={virtualizer.measureElement}
                      data-index={item.index}
                      className="sb-row sb-tree__row"
                      style={level > STYLED_LEVELS ? ({ "--sb-tree-indent": row.depth } as CSSProperties) : undefined}
                      role="treeitem"
                      aria-level={level}
                      aria-posinset={sets.posinset[item.index]}
                      aria-setsize={sets.setsize[item.index]}
                      aria-selected={active}
                      aria-expanded={isFolder ? row.expanded : undefined}
                      // One tab stop (spec/02 §4.14); the path finds the row again.
                      tabIndex={item.index === stop ? 0 : -1}
                      // One line, cut at the end on purpose (ADR-0051 #24): the
                      // full name is the row's tooltip, with the day a status
                      // took from the meta.
                      title={rowTitle(row, t)}
                      data-sb-truncate=""
                      data-path={entry.path}
                      data-sb-drag={draggable ? "" : undefined}
                      data-sb-state={state}
                      onClick={() => openRow(row)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        void openTreeContextMenu(entry.path, !!entry.boardSlug, entry.dir).catch(report);
                      }}
                      draggable={draggable || undefined}
                      onDragStart={
                        draggable
                          ? (event) => {
                              if (entry.boardSlug) event.dataTransfer.setData(BOARD_DRAG_TYPE, entry.boardSlug);
                              else {
                                event.dataTransfer.setData("text/plain", entry.path);
                                // The editor's drop reads this (ADR-0040): a tree
                                // row, not text that happens to look like a path.
                                event.dataTransfer.setData(ENTRY_DRAG_TYPE, entry.path);
                              }
                              event.dataTransfer.effectAllowed = "move";
                              if (NO_DRAG_IMAGE) event.dataTransfer.setDragImage(NO_DRAG_IMAGE, 0, 0);
                              setDragging(entry.path);
                            }
                          : undefined
                      }
                      onDragEnd={
                        draggable
                          ? () => {
                              setOver(null);
                              setDragging(null);
                            }
                          : undefined
                      }
                      onDragOver={
                        dropTarget
                          ? (event) => {
                              // A row never takes itself (spec/02 §4.22): it keeps
                              // its ink frame and the pointer shows no drop (DSK-11).
                              if (dragging === entry.path) return;
                              const kind = dragKind(event.dataTransfer);
                              if (!kind || !accepts.includes(kind)) return;
                              event.preventDefault();
                              event.stopPropagation();
                              event.dataTransfer.dropEffect = kind === "finder" ? "copy" : "move";
                              // A board dropped on a board goes after it: the line
                              // between the rows; anything else goes into the row.
                              const wanted: Drop["state"] = kind === "board" ? "drop-after" : "drop-into";
                              if (over?.path !== entry.path || over.state !== wanted) {
                                setOver({ path: entry.path, state: wanted });
                              }
                            }
                          : undefined
                      }
                      onDragLeave={
                        dropTarget
                          ? (event) => {
                              // Leaving the name span for the row itself is not
                              // leaving the row; where the browser reports no
                              // related target the next dragover restores the mark.
                              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                              setOver((current) => (current?.path === entry.path ? null : current));
                            }
                          : undefined
                      }
                      onDrop={
                        dropTarget
                          ? (event) => {
                              const kind = dragKind(event.dataTransfer);
                              if (!kind || !accepts.includes(kind)) return;
                              event.stopPropagation();
                              if (kind === "file") dropInto(event, entry.path);
                              else if (kind === "finder") dropFinder(event, entry.path);
                              else if (kind === "board") dropBoard(event, entry.boardSlug);
                              else if (entry.boardSlug) dropCard(event, entry.boardSlug);
                            }
                          : undefined
                      }
                    >
                      <span className="sb-tree__twist" aria-hidden="true">
                        {isFolder && <Icon name="chevron-right" />}
                      </span>
                      <Icon
                        name={isBoard ? "board" : entry.dir ? "folder" : "file-text"}
                        size={20}
                        className="sb-row__icon"
                      />
                      <span className="sb-row__name">{entry.name}</span>
                      <RowMeta row={row} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {foot}
    </nav>
  );
}

/** A row's state in its meta, which then holds no day (spec/02 §4.14). */
const hasStatus = (entry: TreeRow["entry"]) => entry.cloudOnly || !!entry.conflictCopyOf;

/** The day a note changed, „Board“ for a board, nothing for a folder. */
function dayOf(entry: TreeRow["entry"], t: (key: string) => string): string | null {
  return entry.boardSlug ? t("tree.board") : entry.dir ? null : formatDay(nsToMs(entry.mtimeNs), t);
}

/**
 * The row's tooltip: the full name, and the day a note changed. The meta
 * does not always show it: a status takes its place, and at large text in a
 * narrow sidebar the meta drops it (styles/app.css). A board's „Board“ is no
 * day; its icon says it.
 */
function rowTitle(row: TreeRow, t: (key: string, values?: Record<string, string>) => string): string {
  const { entry } = row;
  const day = entry.boardSlug ? null : dayOf(entry, t);
  return day ? t("tree.rowTitle", { name: entry.name, day }) : entry.name;
}

/**
 * A row's state or date (STA-08, spec/02 §4.13): glyph and word, a grey
 * glyph that informs („nur online“), the warning glyph for what asks for a
 * choice (the sync client's conflict copy, D92). A status replaces the day
 * it changed (or „Board“), which then stands in the row's tooltip, so the
 * name keeps its room in a narrow sidebar (spec/02 §4.14). Never a total.
 */
function RowMeta({ row }: { row: TreeRow }) {
  const { t } = useTranslation();
  const { entry } = row;
  const day = hasStatus(entry) ? null : dayOf(entry, t);
  if (!hasStatus(entry) && !day) return null;
  return (
    <span className="sb-row__meta">
      {entry.cloudOnly && (
        <span className="sb-status sb-status--neutral" title={t("tree.cloudOnlyHint")}>
          <Icon name="info" />
          {t("tree.cloudOnly")}
        </span>
      )}
      {/* A sync client's conflict copy, findable where it lies; the tooltip
          names the note it shadows. Rename or Move to Trash from the context
          menu resolves it (PLAN.md §5.3, stage 0). */}
      {entry.conflictCopyOf && (
        <span className="sb-status sb-status--warning" title={entry.conflictCopyOf}>
          <Icon name="warning" />
          {t("tree.conflictCopy")}
        </span>
      )}
      {day}
    </span>
  );
}
