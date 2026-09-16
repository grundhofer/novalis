import { useTranslation } from "react-i18next";

import { dispatchCommand } from "../lib/commands";
import { isNote, stemOf } from "../lib/paths";
import { useEditorSave } from "../stores/editorSave";
import { useTabs } from "../stores/tabs";
import { report, useUi } from "../stores/ui";

/** The tab strip (layout L2, the decided layout — docs/DECISIONS.md §4.6). */
export default function TabStrip() {
  const { t } = useTranslation();
  const tabs = useTabs((s) => s.tabs);
  const active = useTabs((s) => s.active);
  const docs = useEditorSave((s) => s.docs);
  const previewing = useUi((s) => (active ? !!s.previewing[active] : false));

  if (tabs.length === 0) return <div className="tabs tabs-empty" />;

  return (
    <div className="tabbar">
    <div className="tabs" role="tablist">
      {tabs.map((path) => {
        const doc = docs[path];
        return (
          <div
            className={path === active ? "tab active" : "tab"}
            key={path}
            role="tab"
            aria-selected={path === active}
            tabIndex={-1}
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
      <div className="tab-spacer" />
    </div>
    {/* The small button the owner asked for (ADR-0020): the same command as
        `Cmd+E`. Outside the scrolling strip, so a row of many tabs never
        pushes it out of sight; a glyph with the state in its tooltip, not a
        word. Only a note has a rendered form, so it is not there for a PDF. */}
    {active && isNote(active) && (
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
