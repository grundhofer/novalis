import { useTranslation } from "react-i18next";

import { useEditorSave } from "../stores/editorSave";
import { useTabs } from "../stores/tabs";
import { useVault } from "../stores/vault";

/**
 * The external-change banner (PLAN.md §5.3 steps 2 and 3).
 *
 * By the time it appears the buffer is already safe: a refused save has
 * written it to a conflict copy, and the banner only asks which version wins.
 * The three actions are exactly the ones in the spec.
 */
export default function Banner() {
  const { t } = useTranslation();
  const active = useTabs((s) => s.active);
  const doc = useEditorSave((s) => (active ? s.docs[active] : undefined));
  const vaultKind = useVault((s) => s.vault?.kind ?? "local");

  if (!active || !doc?.banner) return null;
  const store = useEditorSave.getState();
  const copy = store.conflictCopyPath(active);

  if (doc.banner.kind === "replacedBySync") {
    return (
      <div className="banner banner-warning" role="alert">
        <span className="banner-title">{t("banner.replacedBySync.title")}</span>
        <div className="banner-actions">
          <button className="btn ghost" type="button" onClick={() => void store.reloadFromDisk(active)}>
            {t("banner.replacedBySync.reload")}
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={() => void store.keepMine(active, vaultKind)}
          >
            {t("banner.replacedBySync.restoreMine")}
          </button>
        </div>
      </div>
    );
  }

  if (doc.banner.kind === "changedOnDisk") {
    return (
      <div className="banner banner-warning" role="alert">
        <span className="banner-title">{t("banner.changedOnDisk.title")}</span>
        {copy && <span className="banner-body">{t("banner.changedOnDisk.body", { path: copy })}</span>}
        <div className="banner-actions">
          <button className="btn ghost" type="button" onClick={() => void store.reloadFromDisk(active)}>
            {t("banner.changedOnDisk.reload")}
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => void store.keepMine(active, vaultKind)}
          >
            {t("banner.changedOnDisk.keepMine")}
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              void store.keepBoth(active).then((path) => useTabs.getState().rename(active, path));
            }}
          >
            {t("banner.changedOnDisk.saveConflictCopy")}
          </button>
        </div>
      </div>
    );
  }

  const key =
    doc.banner.kind === "notUtf8"
      ? "banner.notUtf8"
      : doc.banner.kind === "hugeFile"
        ? "banner.hugeFile"
        : "banner.plainMode";

  return (
    <div className="banner" role="status">
      <span className="banner-body">{t(key)}</span>
      <div className="banner-actions">
        <button className="btn ghost" type="button" onClick={() => store.dismissBanner(active)}>
          {t("banner.dismiss")}
        </button>
      </div>
    </div>
  );
}
