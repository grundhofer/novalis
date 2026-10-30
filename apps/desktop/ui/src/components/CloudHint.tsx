import { useTranslation } from "react-i18next";

import { useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import { Callout } from "./Banner";

/**
 * PLAN.md §5.6 step 1: a vault in a cloud folder is said once — a note
 * above the editor (./Banner `Callout`), dismissed for good
 * (`cloudHintShown` in `state.json`); the status bar keeps naming the
 * provider after that. Not the external-change banner, which belongs to a
 * document.
 */
export default function CloudHint() {
  const { t } = useTranslation();
  const kind = useVault((s) => s.vault?.kind ?? "local");
  const shown = useUi((s) => s.cloudHintShown);

  if (kind === "local" || shown) return null;
  return (
    <Callout kind="note" text={t("status.cloud.hintOnce")} onHide={() => useUi.getState().dismissCloudHint()} />
  );
}
