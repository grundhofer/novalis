import { useTranslation } from "react-i18next";

import { stemOf } from "../lib/paths";
import { useEditorSave } from "../stores/editorSave";
import { useTabs } from "../stores/tabs";

/** The tab strip (layout L2, the decided layout — docs/DECISIONS.md §4.6). */
export default function TabStrip() {
  const { t } = useTranslation();
  const tabs = useTabs((s) => s.tabs);
  const active = useTabs((s) => s.active);
  const docs = useEditorSave((s) => s.docs);

  if (tabs.length === 0) return <div className="tabs tabs-empty" />;

  return (
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
                void useTabs.getState().close(path);
              }
            }}
            onClick={() => void useTabs.getState().activate(path)}
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
                void useTabs.getState().close(path);
              }}
            />
          </div>
        );
      })}
      <div className="tab-spacer" />
    </div>
  );
}
