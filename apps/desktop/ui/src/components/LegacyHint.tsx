import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

import { useVault } from "../stores/vault";
import { Callout } from "./Banner";

/** A catalog sentence whose `` `command` `` parts are code (spec/07 §3 rule 11). */
function withCode(sentence: string): ReactNode {
  return sentence.split("`").map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part));
}

/**
 * A vault the old app wrote and nobody has migrated (PLAN.md §10, "the
 * app's first-open prompt is read-only"): a note above the editor
 * (./Banner `Callout`) that says what to run, the command in code; it
 * wraps instead of cutting (ZUG-09). The app migrates nothing itself.
 * Dismissed for the session only — after `novalis migrate --apply` the
 * vault's `migrated` stamp retires it for good.
 */
export default function LegacyHint() {
  const { t } = useTranslation();
  const vault = useVault((s) => s.vault);
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (!vault?.legacy || dismissed === vault.root) return null;
  return (
    <Callout
      kind="note"
      title={t("banner.legacyVault.title")}
      text={
        <>
          {withCode(t("banner.legacyVault.step1"))} {t("banner.legacyVault.step2")}
        </>
      }
      onHide={() => setDismissed(vault.root)}
    />
  );
}
