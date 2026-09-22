import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { providerOf } from "../lib/paths";
import { useCursor } from "../stores/cursor";
import { useEditorSave } from "../stores/editorSave";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import { cloudCounts, useVault } from "../stores/vault";

/** The word count of the mirror; never split in plain mode (ADR-0022 F7). */
export function countWords(text: string | undefined, plainMode: boolean): number {
  if (text === undefined || plainMode) return 0;
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

/**
 * Words · characters · position · cloud state (PLAN.md §5.3). The position is
 * the editor's main cursor; the selection and the cursor count show only
 * when there is one, or more than one.
 *
 * The counts follow the mirror, which the autosave tick refreshes — not the
 * keystroke (ADR-0022 F7): splitting a 5 MB buffer into words on every key
 * was most of what a keystroke cost. In plain mode (≥ 5 MB) words are not
 * counted at all; characters are the string's length, free.
 */
export default function StatusBar() {
  const { t } = useTranslation();
  const active = useTabs((s) => s.active);
  const doc = useEditorSave((s) => (active ? s.docs[active] : undefined));
  const vault = useVault((s) => s.vault);
  const children = useVault((s) => s.children);
  const counts = useMemo(() => cloudCounts(children), [children]);

  const text = doc?.text;
  const plainMode = doc?.plainMode ?? false;
  const words = useMemo(() => countWords(text, plainMode), [text, plainMode]);

  const copy = active ? useEditorSave.getState().conflictCopyPath(active) : null;
  // The editor's, so only while the editor shows this tab — not the preview.
  const previewing = useUi((s) => (active ? !!s.previewing[active] : false));
  const cursor = useCursor((s) => (s.cursor?.path === active && !previewing ? s.cursor : null));

  return (
    <footer className="statusbar">
      {doc && (
        <>
          {!doc.plainMode && <span className="status-item">{t("status.words", { count: words })}</span>}
          <span className="status-item">{t("status.characters", { count: doc.text.length })}</span>
          {cursor && (
            <span className="status-item">{t("status.position", { line: cursor.line, column: cursor.column })}</span>
          )}
          {/* Only when they say something (the owner: fewer infos). */}
          {cursor && cursor.selected > 0 && (
            <span className="status-item">{t("status.selected", { count: cursor.selected })}</span>
          )}
          {cursor && cursor.cursors > 1 && (
            <span className="status-item">{t("status.cursors", { count: cursor.cursors })}</span>
          )}
          {doc.readOnly && <span className="status-item">{t("status.readOnly")}</span>}
          {doc.plainMode && <span className="status-item">{t("status.plainMode")}</span>}
          {copy && <span className="status-item warn">{t("status.conflictCopyActive", { path: copy })}</span>}
        </>
      )}
      <span className="status-spacer" />
      {vault?.kind === "fileProvider" && (
        <span className="status-item sync">
          <span className="status-dot" aria-hidden="true" />
          {t("status.cloud.fileProvider", { provider: providerOf(vault.root) ?? vault.name })}
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
