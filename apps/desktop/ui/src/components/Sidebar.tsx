import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { formatDay } from "../i18n";
import { dispatchCommand } from "../lib/commands";
import { bindingFor, glyphsOf } from "../lib/keymap";
import { nsToMs } from "../lib/paths";
import { useBoard } from "../stores/board";
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
 */

const ROW_HEIGHT = 28;

/** The tooltip of a head control: its label and the chord the menu shows. */
function tooltip(label: string, command: string): string {
  const binding = bindingFor(command);
  return binding ? `${label} ${glyphsOf(binding.chord)}` : label;
}

export default function Sidebar() {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement | null>(null);
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

  if (!vault) return <nav className="sidebar" />;

  const boardLabel = t(boardVisible ? "menu.view.hideBoard" : "menu.view.showBoard");

  return (
    <nav className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-title">
          <span className="vault-name">{vault.name}</span>
          <span className="sidebar-tools">
            <button
              className="btn ghost sidebar-tool"
              type="button"
              title={tooltip(t("menu.file.newNote"), "file.newNote")}
              aria-label={t("menu.file.newNote")}
              onClick={() => dispatchCommand("file.newNote")}
            >
              +
            </button>
            <button
              className="btn ghost sidebar-tool"
              type="button"
              title={tooltip(t("menu.file.newFolder"), "tree.newFolder")}
              aria-label={t("menu.file.newFolder")}
              onClick={() => dispatchCommand("tree.newFolder")}
            >
              <span className="glyph-folder" aria-hidden="true" />
            </button>
            <button
              className={boardVisible ? "btn ghost sidebar-tool on" : "btn ghost sidebar-tool"}
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

      <button className="today-row" type="button" onClick={() => dispatchCommand("file.todayNote")}>
        <span className="chev" aria-hidden="true" />
        <span className="name">{t("tree.todayNote")}</span>
      </button>

      <div className="tree" ref={scroller}>
        <div className="tree-inner" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            const { entry } = row;
            const active = entry.path === activeTab || entry.path === selected;
            const classes = ["tree-row"];
            if (entry.dir) classes.push("folder");
            else classes.push("file");
            if (entry.boardSlug) classes.push("board-item");
            if (row.expanded) classes.push("open");
            if (active) classes.push("active");
            if (entry.cloudOnly) classes.push("cloud");

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
              >
                {active && <span className="active-marker" aria-hidden="true" />}
                <span className="chev" aria-hidden="true" />
                <span className="name">{entry.name}</span>
                {entry.cloudOnly && (
                  <span className="badge badge-cloud" title={t("tree.cloudOnlyHint")}>
                    {t("tree.cloudOnly")}
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
