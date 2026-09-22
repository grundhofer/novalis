import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";

import { formatDay } from "../i18n";
import { dispatchCommand, moveEntry, openTreeContextMenu } from "../lib/commands";
import { bindingFor, glyphsOf } from "../lib/keymap";
import { nsToMs } from "../lib/paths";
import { BOARD_DRAG_TYPE, CARD_DRAG_TYPE, useBoard } from "../stores/board";
import { useTabs } from "../stores/tabs";
import { report, useUi } from "../stores/ui";
import { cloudCounts, treeRows, useVault, type TreeRow } from "../stores/vault";

/**
 * The tree: virtualized (`@tanstack/react-virtual`), folders first, cloud
 * badges, board items.
 *
 * Rows come from the folders that are loaded; opening a folder costs one
 * `list_dir` and a watcher batch patches what is already there. Nothing here
 * ever triggers a walk (PLAN.md §2.3 rules 1 and 5).
 *
 * The head carries the three controls of ADR-0012 (new note, new folder,
 * board) and the legend doubles as the sort switch; both go through
 * `dispatchCommand` and the stores, so a click here and the menu item do the
 * same thing.
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
 * off a board row and a board off a folder.
 */

const ROW_HEIGHT = 28;

type DragKind = "file" | "board" | "card";

/** What a drag carries, by the types it declares. */
function dragKind(dataTransfer: DataTransfer): DragKind | null {
  const { types } = dataTransfer;
  // A card carries `text/plain` as well (BoardPane), so its own type decides first.
  if (types.includes(CARD_DRAG_TYPE)) return "card";
  if (types.includes(BOARD_DRAG_TYPE)) return "board";
  if (types.includes("text/plain")) return "file";
  return null;
}

/** True over the tree's own space, not over a row: there the root is the target. */
function overTreeSpace(event: DragEvent<HTMLDivElement>): boolean {
  const target = event.target as Element;
  return target === event.currentTarget || target.classList.contains("tree-inner");
}

/** The tooltip of a head control: its label and the chord the menu shows. */
function tooltip(label: string, command: string): string {
  const binding = bindingFor(command);
  return binding ? `${label} ${glyphsOf(binding.chord)}` : label;
}

export default function Sidebar() {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement | null>(null);
  /** The folder or board row a drag is over, for the `drop` highlight. */
  const [overPath, setOverPath] = useState<string | null>(null);
  const vault = useVault((s) => s.vault);
  const children = useVault((s) => s.children);
  const expanded = useVault((s) => s.expanded);
  const selected = useVault((s) => s.selected);
  const activeTab = useTabs((s) => s.active);
  const boardVisible = useUi((s) => s.boardVisible);
  const treeSort = useUi((s) => s.treeSort);
  const boards = useBoard((s) => s.boards);

  const rows: TreeRow[] = useMemo(
    () => treeRows(children, expanded, treeSort, boards),
    [children, expanded, treeSort, boards],
  );
  const counts = useMemo(() => cloudCounts(children), [children]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

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

  const dropInto = (event: DragEvent<HTMLDivElement>, toFolder: string) => {
    const path = event.dataTransfer.getData("text/plain");
    setOverPath(null);
    void moveEntry(path, toFolder).catch(report);
  };

  /** A board dropped on board row `after`, or on the tree's space (`null`): last. */
  const dropBoard = (event: DragEvent<HTMLDivElement>, after: string | null) => {
    const slug = event.dataTransfer.getData(BOARD_DRAG_TYPE);
    setOverPath(null);
    // On its own row: already there.
    if (!slug || slug === after) return;
    void useBoard
      .getState()
      .placeBoard(slug, after ? { kind: "after", id: after } : { kind: "last" })
      .catch(report);
  };

  const dropCard = (event: DragEvent<HTMLDivElement>, board: string) => {
    const id = event.dataTransfer.getData(CARD_DRAG_TYPE);
    setOverPath(null);
    if (!id) return;
    void useBoard.getState().moveCardToBoard(id, board).catch(report);
  };

  if (!vault) return <nav className="sidebar" />;

  const boardLabel = t(boardVisible ? "menu.view.hideBoard" : "menu.view.showBoard");

  return (
    <nav className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-title">
          <span className="vault-name">{vault.name}</span>
          <span className="sidebar-tools">
            <button
              className="btn ghost tool"
              type="button"
              title={tooltip(t("menu.file.newNote"), "file.newNote")}
              aria-label={t("menu.file.newNote")}
              onClick={() => dispatchCommand("file.newNote")}
            >
              +
            </button>
            <button
              className="btn ghost tool"
              type="button"
              title={tooltip(t("menu.file.newFolder"), "tree.newFolder")}
              aria-label={t("menu.file.newFolder")}
              onClick={() => dispatchCommand("tree.newFolder")}
            >
              <span className="glyph-folder" aria-hidden="true" />
            </button>
            <button
              className={boardVisible ? "btn ghost tool on" : "btn ghost tool"}
              type="button"
              title={tooltip(boardLabel, "board.toggle")}
              aria-label={boardLabel}
              aria-pressed={boardVisible}
              onClick={() => dispatchCommand("board.toggle")}
            >
              <span className="glyph-board" aria-hidden="true" />
            </button>
          </span>
        </div>
        <span className="legend">
          <button
            className={treeSort === "name" ? "legend-sort on" : "legend-sort"}
            type="button"
            title={t("tree.sortByName")}
            aria-pressed={treeSort === "name"}
            onClick={() => useUi.getState().setTreeSort("name")}
          >
            {t("tree.columnName")}
          </button>
          <button
            className={treeSort === "modified" ? "legend-sort on" : "legend-sort"}
            type="button"
            title={t("tree.sortByModified")}
            aria-pressed={treeSort === "modified"}
            onClick={() => useUi.getState().setTreeSort("modified")}
          >
            {t("tree.columnModified")}
          </button>
        </span>
      </div>

      <button className="tree-row today-row" type="button" onClick={() => dispatchCommand("file.todayNote")}>
        <span className="chev" aria-hidden="true" />
        <span className="name">{t("tree.todayNote")}</span>
      </button>

      <div
        className="tree"
        ref={scroller}
        onDragOver={(event) => {
          // A row that is not a target lets the event through; refusing it
          // here keeps a file row from reading as a target. A card has no
          // place in the tree's space either.
          if (!overTreeSpace(event)) return;
          const kind = dragKind(event.dataTransfer);
          if (kind !== "file" && kind !== "board") return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          if (!overTreeSpace(event)) return;
          const kind = dragKind(event.dataTransfer);
          if (kind === "file") dropInto(event, "");
          else if (kind === "board") dropBoard(event, null);
        }}
      >
        <div className="tree-inner" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            const { entry } = row;
            const active = entry.path === activeTab || entry.path === selected;
            const isBoard = !!entry.boardSlug;
            const draggable = !entry.dir || isBoard;
            // A folder takes a file; a board takes a board or a card.
            const accepts: DragKind[] = isBoard ? ["board", "card"] : entry.dir ? ["file"] : [];
            const dropTarget = accepts.length > 0;
            const classes = ["tree-row"];
            if (entry.dir) classes.push("folder");
            else classes.push("file");
            if (entry.boardSlug) classes.push("board-item");
            if (row.expanded) classes.push("open");
            if (active) classes.push("active");
            if (entry.cloudOnly) classes.push("cloud");
            if (dropTarget && entry.path === overPath) classes.push("drop");

            return (
              <div
                className={classes.join(" ")}
                key={entry.path}
                style={{
                  height: `${item.size}px`,
                  transform: `translateY(${item.start}px)`,
                  paddingLeft: `${14 + row.depth * 16}px`,
                }}
                role="treeitem"
                aria-selected={active}
                aria-expanded={entry.dir && !entry.boardSlug ? row.expanded : undefined}
                tabIndex={-1}
                onClick={() => openRow(row)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  void openTreeContextMenu(entry.path, !!entry.boardSlug).catch(report);
                }}
                draggable={draggable || undefined}
                onDragStart={
                  draggable
                    ? (event) => {
                        if (entry.boardSlug) event.dataTransfer.setData(BOARD_DRAG_TYPE, entry.boardSlug);
                        else event.dataTransfer.setData("text/plain", entry.path);
                        event.dataTransfer.effectAllowed = "move";
                      }
                    : undefined
                }
                onDragEnd={draggable ? () => setOverPath(null) : undefined}
                onDragOver={
                  dropTarget
                    ? (event) => {
                        const kind = dragKind(event.dataTransfer);
                        if (!kind || !accepts.includes(kind)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        event.dataTransfer.dropEffect = "move";
                        if (overPath !== entry.path) setOverPath(entry.path);
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
                        setOverPath((current) => (current === entry.path ? null : current));
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
                        else if (kind === "board") dropBoard(event, entry.boardSlug);
                        else if (entry.boardSlug) dropCard(event, entry.boardSlug);
                      }
                    : undefined
                }
              >
                {active && <span className="active-marker" aria-hidden="true" />}
                <span className="chev" aria-hidden="true" />
                <span className="name">{entry.name}</span>
                {entry.cloudOnly && (
                  <span className="badge badge-cloud" title={t("tree.cloudOnlyHint")}>
                    {t("tree.cloudOnly")}
                  </span>
                )}
                {/* A sync client's conflict copy, findable where it lies; the
                    tooltip names the note it shadows. Rename or Move to Trash
                    from the context menu resolves it (PLAN.md §5.3, stage 0). */}
                {entry.conflictCopyOf && (
                  <span className="badge badge-conflict" title={entry.conflictCopyOf}>
                    {t("tree.conflictCopy")}
                  </span>
                )}
                {entry.boardSlug ? (
                  <span className="meta">{t("tree.board")}</span>
                ) : (
                  !entry.dir && <span className="meta">{formatDay(nsToMs(entry.mtimeNs), t)}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="sidebar-foot">
        <button
          className="btn ghost tool sidebar-settings"
          type="button"
          title={t("palette.cmd.settings")}
          aria-label={t("palette.cmd.settings")}
          onClick={() => dispatchCommand("settings.open")}
        >
          <span className="glyph-gear" aria-hidden="true" />
        </button>
        {counts.cloudOnly > 0 && (
          <span className="hint">
            <span className="hint-dot" aria-hidden="true" />
            {t("tree.footCloudOnly", { count: counts.cloudOnly })}
          </span>
        )}
        {counts.conflicts > 0 && (
          <span className="hint">
            <span className="hint-dot" aria-hidden="true" />
            {t("tree.footConflicts", { count: counts.conflicts })}
          </span>
        )}
      </div>
    </nav>
  );
}
