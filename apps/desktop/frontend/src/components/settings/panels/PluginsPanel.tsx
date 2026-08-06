import { useEffect, useState } from "react";

import { Trans, useTranslation } from "react-i18next";

import { api, type PluginInfo } from "../../../ipc/api";
import { PLUGIN_API_VERSION } from "../../../ipc/bindings";
import { isFeatureOn } from "../../../lib/features";
import { apiVersionOf, usePlugins } from "../../../stores/pluginStore";
import { SettingsSection, Switch } from "../../ui";
import { PluginConsentDialog } from "./PluginConsentDialog";

/** Capabilities the plugin asks for but has not been granted. Non-empty means
 *  its manifest changed after the user consented (plugin folders live in the
 *  vault, so a sync can rewrite one) — those calls are refused until the user
 *  looks at the diff. */
function ungranted(p: PluginInfo): string[] {
  const granted = p.grantedCapabilities ?? [];
  return (p.manifest.capabilities ?? []).filter((c) => !granted.includes(c));
}

export function PluginsPanel() {
  const { t } = useTranslation("settings");
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [consent, setConsent] = useState<PluginInfo | null>(null);

  /** One line of vault access per plugin, phrased so the four cases stay
   *  distinguishable (granted vs. merely requested, some vs. none). */
  const accessLine = (p: PluginInfo): string => {
    const caps = p.enabled ? (p.grantedCapabilities ?? []) : (p.manifest.capabilities ?? []);
    if (caps.length === 0) return p.enabled ? t("plugins.grantedNone") : t("plugins.requestsNone");
    return p.enabled
      ? t("plugins.granted", { caps: caps.join(", ") })
      : t("plugins.requests", { caps: caps.join(", ") });
  };

  const reload = () => void api.listPlugins().then(setPlugins).catch(() => {});
  useEffect(() => {
    reload();
  }, []);

  const apply = async (id: string, enabled: boolean, granted: string[]) => {
    try {
      await api.setPluginEnabled(id, enabled, granted);
      // Managing plugins works while the feature is off, but only reload
      // workers when it is on — the backend hard-rejects source reads
      // otherwise, which would toast a "load failed" per enabled plugin.
      if (isFeatureOn("plugins")) await usePlugins.getState().reload();
      else usePlugins.getState().unload();
      setPlugins(await api.listPlugins());
    } catch {
      /* ignore */
    }
  };

  return (
    <SettingsSection title={t("plugins.section")}>
      {plugins.length === 0 ? (
        <p className="text-xs text-fg-faint">
          <Trans i18nKey="plugins.empty" ns="settings">
            No plugins installed. Drop a plugin folder into{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5">.novalis/plugins/</code> in your vault
            (see PLUGINS.md), then reopen Settings.
          </Trans>
        </p>
      ) : (
        <div className="space-y-3">
          {plugins.map((p) => {
            const pending = p.enabled ? ungranted(p) : [];
            const declared = apiVersionOf(p);
            return (
              <div key={p.manifest.id} className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm text-fg">{p.manifest.name}</div>
                  <div className="truncate text-xs text-fg-subtle">
                    {p.manifest.description || p.manifest.id}
                  </div>
                  {/* An enabled plugin's line shows what it *has* (the grant),
                      a disabled one what it *wants* (the manifest) — never the
                      manifest as if it were access the plugin already holds. */}
                  <div className="text-xs text-fg-faint">{accessLine(p)}</div>
                  {declared !== PLUGIN_API_VERSION && (
                    <div className="text-xs text-danger">
                      {t("plugins.incompatible", { declared, current: PLUGIN_API_VERSION })}
                    </div>
                  )}
                  {pending.length > 0 && (
                    <button
                      onClick={() => setConsent(p)}
                      className="mt-1 rounded-md bg-accent/15 px-2 py-0.5 text-xs text-accent transition-colors hover:bg-accent/25"
                    >
                      {t("plugins.review", { caps: pending.join(", ") })}
                    </button>
                  )}
                </div>
                <Switch
                  checked={p.enabled}
                  // Enabling is the consent point: it runs the plugin's code and
                  // is the only moment a capability can be granted. Disabling
                  // needs no dialog and drops the grants.
                  onChange={(v) => (v ? setConsent(p) : void apply(p.manifest.id, false, []))}
                  aria-label={t("plugins.enableAria", { name: p.manifest.name })}
                />
              </div>
            );
          })}
        </div>
      )}

      {consent && (
        <PluginConsentDialog
          plugin={consent}
          onCancel={() => setConsent(null)}
          onConfirm={(granted) => {
            const id = consent.manifest.id;
            setConsent(null);
            void apply(id, true, granted);
          }}
        />
      )}
    </SettingsSection>
  );
}
