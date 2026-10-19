import { useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";

import { dispatchCommand } from "../lib/commands";
import { previewKind } from "../lib/fileTypes";
import { stemOf } from "../lib/paths";
import { useBoard } from "../stores/board";
import { useEditorSave } from "../stores/editorSave";
import { useTabs } from "../stores/tabs";
import { report, useUi } from "../stores/ui";
import Icon from "./Icon";

/**
 * A tab's drag payload (ADR-0028): its own type, so the tree — which reads
 * `text/plain` as a file and the ADR-0019 types as a board or card — and the
 * editor ignore a tab dropped on them. WebKit abandons a drag whose data
 * store is empty when dragstart returns, so the path goes in as the data.
 */
const TAB_DRAG_TYPE = "application/x-novalis-tab";

const isTabDrag = (event: DragEvent) => event.dataTransfer.types.includes(TAB_DRAG_TYPE);

/** The tab strip (layout L2, the decided layout — docs/DECISIONS.md §4.6). */
export default function TabStrip() {
  const { t } = useTranslation();
  const [dropAt, setDropAt] = useState<number | null>(null);
  const tabs = useTabs((s) => s.tabs);
  const active = useTabs((s) => s.active);
  const docs = useEditorSave((s) => s.docs);
  const previewing = useUi((s) => (active ? !!s.previewing[active] : false));
  const boardVisible = useUi((s) => s.boardVisible);
  // The open board is a tab like a note's (ADR-0050): the one board at a
  // time, first in the strip, current while the board pane shows. A board
  // shown by the toggle before any was chosen is the board store's.
  const chosenBoard = useUi((s) => s.activeBoard);
  const loadedBoard = useBoard((s) => s.slug);
  const boardSlug = chosenBoard ?? (boardVisible ? loadedBoard : null);
  const boardName = useBoard((s) => s.boards.find((b) => b.slug === boardSlug)?.name ?? boardSlug);

  // Inside the bar even when empty: on its own in the column, the strip's
  // `flex: 1` (meant for the row) grew it to half the pane's height.
  if (tabs.length === 0 && !boardSlug) {
    return (
      <div className="tabbar">
        <div className="tabs tabs-empty" />
      </div>
    );
  }

  return (
    <div className="tabbar">
    <div className="tabs" role="tablist" onDragLeave={() => setDropAt(null)}>
      {boardSlug && (
        <div
          className={boardVisible ? "tab board-tab active" : "tab board-tab"}
          role="tab"
          aria-selected={boardVisible}
          tabIndex={-1}
          onMouseDown={(event) => {
            if (event.button === 1) {
              event.preventDefault();
              useUi.getState().setActiveBoard(null);
            }
          }}
          onClick={() => useUi.getState().setActiveBoard(boardSlug)}
        >
          <Icon name="board" />
          <span className="tab-name">{boardName}</span>
          <button
            className="tab-close"
            type="button"
            title={t("menu.file.closeTab")}
            aria-label={t("menu.file.closeTab")}
            onClick={(event) => {
              event.stopPropagation();
              useUi.getState().setActiveBoard(null);
            }}
          />
        </div>
      )}
      {tabs.map((path, index) => {
        const doc = docs[path];
        const current = !boardVisible && path === active;
        return (
          <div
            className={
              (current ? "tab active" : "tab") + (dropAt === index ? " drop" : "")
            }
            key={path}
            role="tab"
            aria-selected={current}
            tabIndex={-1}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(TAB_DRAG_TYPE, path);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              if (!isTabDrag(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropAt(index);
            }}
            onDrop={(event) => {
              if (!isTabDrag(event)) return;
              event.preventDefault();
              setDropAt(null);
              useTabs.getState().move(event.dataTransfer.getData(TAB_DRAG_TYPE), index);
            }}
            onDragEnd={() => setDropAt(null)}
            onMouseDown={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                void useTabs.getState().close(path).catch(report);
              }
            }}
            onClick={() => void useTabs.getState().activate(path).catch(report)}
          >
            <span className="tab-name">{stemOf(path)}</span>
            {doc?.dirty && <span className="tab-dot" aria-hidden="true" />}
            <button
              className="tab-close"
              type="button"
              title={t("menu.file.closeTab")}
              aria-label={t("menu.file.closeTab")}
              onClick={(event) => {
                event.stopPropagation();
                void useTabs.getState().close(path).catch(report);
              }}
            />
          </div>
        );
      })}
      <div
        className={dropAt === tabs.length ? "tab-spacer drop" : "tab-spacer"}
        onDragOver={(event) => {
          if (!isTabDrag(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropAt(tabs.length);
        }}
        onDrop={(event) => {
          if (!isTabDrag(event)) return;
          event.preventDefault();
          setDropAt(null);
          useTabs.getState().move(event.dataTransfer.getData(TAB_DRAG_TYPE), tabs.length);
        }}
      />
    </div>
    {/* The small button the owner asked for (ADR-0020): the same command as
        `Cmd+E`. Outside the scrolling strip, so a row of many tabs never
        pushes it out of sight; a glyph with the state in its tooltip, not a
        word. Only a file with a second representation has it — a note, a
        CSV or TSV, an SVG (ADR-0025) — so it is not there for a PDF. */}
    {active && !boardVisible && previewKind(active) && (
      <button
        className={previewing ? "btn ghost tool tab-preview on" : "btn ghost tool tab-preview"}
        type="button"
        aria-pressed={previewing}
        title={t(previewing ? "editor.edit" : "editor.preview")}
        aria-label={t(previewing ? "editor.edit" : "editor.preview")}
        onClick={() => dispatchCommand("note.togglePreview")}
      >
        <span className="glyph-eye" aria-hidden="true" />
      </button>
    )}
    </div>
  );
}
