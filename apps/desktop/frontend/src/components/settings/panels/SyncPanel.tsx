import { useCallback, useEffect, useState } from "react";

import { GitCommitHorizontal, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { api, type GitStatus } from "../../../ipc/api";
import { resolveGitPrefs, useSettings } from "../../../stores/settingsStore";
import { NumberField, SettingRow, SettingsSection, Switch, TextField } from "../../ui";
import { PanelLoading } from "./PanelLoading";

/** Git sync settings (P1: local auto-commit — no remotes yet). */
export function SyncPanel() {
  const { t, i18n } = useTranslation("settings");
  const prefs = useSettings((s) => s.prefs);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.gitStatus());
    } catch {
      // noVault — the repository section just shows the uninitialized state.
      setStatus(null);
    }
  }, []);

  // Initial fetch + poll while the panel is open: the background
  // auto-committer (and the user's own edits) move the dirty count and the
  // last commit underneath us.
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!prefs) return <PanelLoading />;

  const settings = useSettings.getState();
  const git = resolveGitPrefs(prefs.git);

  const commitNow = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Flush the debounced settings persist first: the backend reads the
      // author from config.json, and a just-typed identity would otherwise
      // miss the (permanent) baseline commit.
      await useSettings.getState().flush();
      setStatus(await api.gitCommitNow());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (enabled: boolean) => {
    settings.setGit({ enabled });
    // Enabling creates the repository and a baseline commit right away, so
    // the user sees a working state instead of waiting for the first interval.
    if (enabled) void commitNow();
  };

  const last = status?.lastCommit ?? null;

  return (
    <>
      <SettingsSection title={t("sync.git.title")} description={t("sync.git.desc")}>
        <SettingRow
          label={t("sync.enabled.label")}
          description={t("sync.enabled.desc")}
          control={
            <Switch checked={git.enabled} onChange={toggle} aria-label={t("sync.enabled.label")} />
          }
        />
        <SettingRow
          label={t("sync.authorName.label")}
          description={t("sync.authorName.desc")}
          control={
            <TextField
              value={git.authorName}
              onChange={(e) => settings.setGit({ authorName: e.target.value })}
              className="w-48"
            />
          }
        />
        <SettingRow
          label={t("sync.authorEmail.label")}
          description={t("sync.authorEmail.desc")}
          control={
            <TextField
              value={git.authorEmail}
              onChange={(e) => settings.setGit({ authorEmail: e.target.value })}
              className="w-48"
            />
          }
        />
        <SettingRow
          label={t("sync.interval.label")}
          description={t("sync.interval.desc")}
          control={
            <NumberField
              value={git.autoCommitSecs}
              min={30}
              max={3600}
              step={30}
              suffix="s"
              onChange={(n) => settings.setGit({ autoCommitSecs: n })}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title={t("sync.repo.title")}>
        {status?.initialized ? (
          <>
            <SettingRow
              label={t("sync.repo.lastCommit")}
              description={
                last
                  ? `${last.message} · ${last.id.slice(0, 7)} · ${new Date(last.time).toLocaleString(i18n.language)}`
                  : t("sync.repo.noCommits")
              }
              control={<CommitNowButton busy={busy} onClick={() => void commitNow()} label={t("sync.repo.commitNow")} />}
            />
            <SettingRow
              label={t("sync.repo.pending")}
              description={
                status.branch
                  ? t("sync.repo.onBranch", { branch: status.branch })
                  : undefined
              }
              control={
                <span className="text-sm text-fg-muted">
                  {t("sync.repo.pendingCount", { n: status.dirty })}
                </span>
              }
            />
          </>
        ) : (
          <SettingRow
            label={t("sync.repo.uninitialized")}
            description={t("sync.repo.uninitializedDesc")}
            control={<CommitNowButton busy={busy} onClick={() => void commitNow()} label={t("sync.repo.commitNow")} />}
          />
        )}
        {error && <p className="pt-2 text-xs text-danger">{t("sync.repo.commitFailed", { message: error })}</p>}
      </SettingsSection>
    </>
  );
}

function CommitNowButton({
  busy,
  onClick,
  label,
}: {
  busy: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <GitCommitHorizontal size={14} />}
      {label}
    </button>
  );
}
