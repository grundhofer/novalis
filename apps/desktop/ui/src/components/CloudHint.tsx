import { useTranslation } from "react-i18next";

import { useUi } from "../stores/ui";
import { useVault } from "../stores/vault";

/**
 * PLAN.md §5.6 step 1: a vault in a cloud folder is said once — one line
 * above the editor, dismissed for good (`cloudHintShown` in `state.json`);
 * the status bar keeps naming the provider after that. Not the
 * external-change banner, which belongs to a document.
 */
export default function CloudHint() {
  const { t } = useTranslation();
  const kind = useVault((s) => s.vault?.kind ?? "local");
  const shown = useUi((s) => s.cloudHintShown);

  if (kind === "local" || shown) return null;
  return (
    <div className="banner" role="status">
      <span className="banner-body">{t("status.cloud.hintOnce")}</span>
      <div className="banner-actions">
        <button className="btn ghost" type="button" onClick={() => useUi.getState().dismissCloudHint()}>
          {t("banner.dismiss")}
        </button>
      </div>
    </div>
  );
}
