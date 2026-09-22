import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useVault } from "../stores/vault";

/**
 * A vault the old app wrote and nobody has migrated (PLAN.md §10, "the
 * app's first-open prompt is read-only"): one line above the editor that
 * says what to run. The app migrates nothing itself. Dismissed for the
 * session only — after `novalis migrate --apply` the vault's `migrated`
 * stamp retires it for good.
 */
export default function LegacyHint() {
  const { t } = useTranslation();
  const vault = useVault((s) => s.vault);
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (!vault?.legacy || dismissed === vault.root) return null;
  return (
    <div className="banner" role="status">
      <span className="banner-title">{t("banner.legacyVault.title")}</span>
      {/* One line like every banner; the tooltip carries what the line cuts. */}
      <span className="banner-body" title={`${t("banner.legacyVault.step1")} ${t("banner.legacyVault.step2")}`}>
        {t("banner.legacyVault.step1")} {t("banner.legacyVault.step2")}
      </span>
      <div className="banner-actions">
        <button className="btn ghost" type="button" onClick={() => setDismissed(vault.root)}>
          {t("banner.dismiss")}
        </button>
      </div>
    </div>
  );
}
