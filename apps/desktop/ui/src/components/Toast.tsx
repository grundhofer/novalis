import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useUi } from "../stores/ui";

/**
 * One line, bottom right, for a failed command. The message is the catalog
 * entry for the core's error code — the core has no strings of its own
 * (PLAN.md §5.2).
 */
export default function Toast() {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => useUi.getState().clearToast(), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;

  return (
    <div className="toast" role="alert">
      <span className="toast-body">{t(toast.key, toast.values)}</span>
      <button
        className="btn ghost"
        type="button"
        onClick={() => useUi.getState().clearToast()}
      >
        {t("app.close")}
      </button>
    </div>
  );
}
