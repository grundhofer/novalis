import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useEditorSave } from "../stores/editorSave";
import { useTabs } from "../stores/tabs";
import { cloudCounts, useVault } from "../stores/vault";

/** Words · characters · position · cloud state (PLAN.md §5.3). */
export default function StatusBar() {
  const { t } = useTranslation();
  const active = useTabs((s) => s.active);
  const doc = useEditorSave((s) => (active ? s.docs[active] : undefined));
  const vault = useVault((s) => s.vault);
  const children = useVault((s) => s.children);
  const counts = useMemo(() => cloudCounts(children), [children]);

  const words = useMemo(() => {
    if (!doc) return 0;
    const trimmed = doc.text.trim();
    return trimmed ? trimmed.split(/\s+/u).length : 0;
  }, [doc]);

  const copy = active ? useEditorSave.getState().conflictCopyPath(active) : null;

  return (
    <footer className="statusbar">
      {doc && (
        <>
          <span className="status-item">{t("status.words", { count: words })}</span>
          <span className="status-item">{t("status.characters", { count: doc.text.length })}</span>
          {doc.readOnly && <span className="status-item">{t("status.readOnly")}</span>}
          {doc.plainMode && <span className="status-item">{t("status.plainMode")}</span>}
          {copy && <span className="status-item warn">{t("status.conflictCopyActive", { path: copy })}</span>}
        </>
      )}
      <span className="status-spacer" />
      {vault?.kind === "fileProvider" && (
        <span className="status-item sync">
          <span className="status-dot" aria-hidden="true" />
          {t("status.cloud.fileProvider", { provider: vault.name })}
        </span>
      )}
      {vault?.kind === "mirrored" && <span className="status-item sync">{t("status.cloud.mirrored")}</span>}
      {counts.cloudOnly > 0 && (
        <span className="status-item">{t("status.cloud.cloudOnly", { count: counts.cloudOnly })}</span>
      )}
      {counts.conflicts > 0 && (
        <span className="status-item warn">
          {t("status.cloud.conflicts", { count: counts.conflicts })}
        </span>
      )}
    </footer>
  );
}
