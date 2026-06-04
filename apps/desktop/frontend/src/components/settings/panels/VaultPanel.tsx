import { useEffect, useState } from "react";

import { FolderInput, FolderX } from "lucide-react";
import { useTranslation } from "react-i18next";

import { api, type RecentVault } from "../../../ipc/api";
import { useVault } from "../../../stores/vaultStore";
import { SettingRow, SettingsSection } from "../../ui";

/** Display name (last path segment) for a vault path. */
function vaultName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/** Settings panel to switch the active vault and jump back to a recent one. */
export function VaultPanel({ onSwitched }: { onSwitched?: () => void }) {
  const { t } = useTranslation(["settings", "common"]);
  const vaultPath = useVault((s) => s.vaultPath);
  const [recent, setRecent] = useState<RecentVault[]>([]);
  const [missing, setMissing] = useState<Set<string>>(new Set());

  // Load the recent list and flag entries whose folder is gone. The `active`
  // guard drops results from a superseded run, so a slow validate loop can't
  // clobber fresher state when the vault changes.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await api.listRecentVaults();
        if (!active) return;
        setRecent(list);
        const gone = new Set<string>();
        await Promise.all(
          list.map(async (v) => {
            try {
              await api.validateVault(v.path);
            } catch {
              gone.add(v.path);
            }
          }),
        );
        if (active) setMissing(gone);
      } catch {
        if (active) setRecent([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [vaultPath]);

  // Close Settings *before* opening so the full-screen loading state doesn't
  // unmount and re-animate the modal. switchVault flushes unsaved edits to the
  // outgoing vault first (and bails, surfacing an error, if that flush fails).
  const switchTo = (path: string) => {
    onSwitched?.();
    void useVault.getState().switchVault(path);
  };

  const pickAndSwitch = async () => {
    const path = await api.pickVaultFolder();
    if (path) switchTo(path);
  };

  // Optimistic local removal; the backend `retain` is authoritative.
  const removeRecent = async (path: string) => {
    setRecent((r) => r.filter((v) => v.path !== path));
    await api.removeRecentVault(path).catch(() => {});
  };

  // Don't list the currently-open vault among the "other" recent vaults.
  const others = recent.filter((v) => v.path !== vaultPath);

  return (
    <>
      <SettingsSection title={t("vault.current.title")}>
        <SettingRow
          label={t("vault.current.label")}
          description={vaultPath ?? t("vault.current.none")}
          control={
            <button
              onClick={() => void pickAndSwitch()}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:opacity-90"
            >
              <FolderInput size={14} />
              {t("vault.switch")}
            </button>
          }
        />
      </SettingsSection>

      <SettingsSection title={t("vault.recent.title")} description={t("vault.switchDesc")}>
        {others.length === 0 ? (
          <p className="py-2 text-xs text-fg-faint">{t("vault.recent.empty")}</p>
        ) : (
          others.map((v) => {
            const gone = missing.has(v.path);
            return (
              <div
                key={v.path}
                className="flex items-center justify-between gap-2 border-b border-border/60 py-2 last:border-0"
              >
                <button
                  onClick={() => switchTo(v.path)}
                  disabled={gone}
                  title={v.path}
                  className="flex min-w-0 flex-1 flex-col items-start text-left disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="truncate text-sm text-fg">{vaultName(v.path)}</span>
                  <span className="w-full truncate text-xs text-fg-subtle">{v.path}</span>
                </button>
                {gone && (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-danger">
                    <FolderX size={13} />
                    {t("vault.recent.missing")}
                  </span>
                )}
                <button
                  onClick={() => void removeRecent(v.path)}
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
                >
                  {t("common:remove")}
                </button>
              </div>
            );
          })
        )}
      </SettingsSection>
    </>
  );
}
