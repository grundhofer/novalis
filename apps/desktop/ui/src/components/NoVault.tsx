import { useTranslation } from "react-i18next";

/**
 * The window without a vault (spec/02 §3.14, DAT-07): sebaro's empty state,
 * heading and one sentence how the window fills, start-aligned. Its button
 * is the action zone's primary „Vault öffnen …“ (ADR-0048), one per view, at
 * the bottom, so it has none of its own. `App` puts it alone into the
 * window's content (`sb-window__content`), where sebaro centres it between
 * the title bar and the action zone (NV-E18, docs/sebaro-luecken.md E).
 */
export default function NoVault() {
  const { t } = useTranslation();
  return (
    <div className="sb-empty">
      <h1 className="sb-empty__title">{t("app.openVault.title")}</h1>
      <p className="sb-empty__text">{t("app.openVault.body")}</p>
    </div>
  );
}
