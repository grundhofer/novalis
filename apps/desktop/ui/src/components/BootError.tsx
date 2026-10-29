import { useState } from "react";
import { useTranslation } from "react-i18next";

import { commands, errorKey, errorValues, NovalisError, unwrap } from "../ipc/client";
import { Callout } from "./Banner";
import { detailsOf } from "./ErrorDetails";
import { withFileNames } from "./FileName";

/**
 * The technical text under a failed boot's „Details“. Deliberately the raw
 * code and message rather than a catalog sentence: this is diagnostic data,
 * and it has to survive a failure of anything the catalog depends on.
 */
export function describeBootError(error: unknown): string {
  if (error instanceof NovalisError) {
    const where = error.ipc.path ? ` (${error.ipc.path})` : "";
    const detail = error.ipc.detail ? `: ${error.ipc.detail}` : "";
    return `${error.code}${where}${detail}`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/**
 * „Vault öffnen …“ from a failed start: the window has no stores to fill,
 * so the vault is opened and the page starts again. `open_vault` wrote it
 * as `lastVault`, and the new boot opens it. Nothing picked, nothing done.
 */
async function openVaultAndRestart(): Promise<void> {
  const picked = await unwrap(commands.openVaultDialog());
  if (!picked) return;
  await unwrap(commands.openVault(picked));
  window.location.reload();
}

/**
 * A boot that failed (Rule 5, fail loud: never a blank window): sebaro's
 * error callout (STA-05, spec/02 §3.11) with what failed and what to do in
 * words (TXT-07, spec/07 §4.1), the code under „Details“ (spec/02 §3.28)
 * and „Vault öffnen …“ as its secondary action. The start tile has faded
 * already (`failStart`, STR-01). There is no action zone here: a vault that
 * does not open says why in the callout itself, in place of the start's
 * reason. The callout stands in sebaro's `sb-start-error` (spec/09 §13.1,
 * D108): under the title bar's 48 px, at most 40rem wide; the window's
 * density comes from <html> (index.html).
 */
export default function BootError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const [failure, setFailure] = useState<unknown>(null);
  const translate = (key: string, values: Record<string, string | number>) => t(key, values);
  const text = failure === null ? t("errors.bootText") : withFileNames(translate, errorKey(failure), errorValues(failure));
  const details =
    failure === null ? describeBootError(error) : (detailsOf(errorKey(failure), errorValues(failure)) ?? undefined);
  return (
    <div className="boot boot-error">
      <div className="sb-start-error">
        <Callout kind="error" alert title={t("errors.title")} text={text} details={details}>
          <button
            className="sb-secondary-action sb-secondary-action--compact"
            type="button"
            onClick={() => {
              setFailure(null);
              openVaultAndRestart().catch(setFailure);
            }}
          >
            {t("app.openVault.button")}
          </button>
        </Callout>
      </div>
    </div>
  );
}
