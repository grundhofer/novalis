import { useEffect, useState } from "react";

import { RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { api, type CalendarSourceConfig } from "../../../ipc/api";
import { displayError } from "../../../lib/errors";
import { useFeature } from "../../../lib/features";
import { useSettings } from "../../../stores/settingsStore";
import { NumberField, SegmentedControl, SettingRow, SettingsSection, TextField } from "../../ui";
import { PanelLoading } from "./PanelLoading";

// Provider ids are logic keys, not UI strings — the visible label comes from
// `calendar.connectProvider`. Hoisted so the JSX carries no literal.
const PROVIDERS = ["google", "outlook"] as const;

export function CalendarPanel() {
  const { t } = useTranslation(["settings", "common"]);
  const prefs = useSettings((s) => s.prefs);
  const [sources, setSources] = useState<CalendarSourceConfig[]>([]);
  const [srcName, setSrcName] = useState("");
  const [srcUrl, setSrcUrl] = useState("");
  const [calMsg, setCalMsg] = useState<string | null>(null);
  // Which providers can be connected at all. An installed app has no
  // environment variables, so without a stored client id "Connect" is a button
  // whose only outcome is a red line — it should not be offered.
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [clientIds, setClientIds] = useState<Record<string, string>>({});
  // Feature-off hides only the "add" affordances (connect buttons / subscribe
  // form); already-configured sources stay listed so refresh/remove keep
  // working — removal is the cleanup path even with the feature off.
  const calendarSyncOn = useFeature("calendarSync");
  const icsSubscriptionsOn = useFeature("icsSubscriptions");

  const reload = () => void api.listCalendarSources().then(setSources).catch(() => {});
  const reloadOauth = () => {
    for (const p of PROVIDERS) {
      void api.oauthConfigured(p).then((ok) => setConfigured((c) => ({ ...c, [p]: ok })));
      void api.oauthClientId(p).then((id) => setClientIds((c) => ({ ...c, [p]: id ?? "" })));
    }
  };
  useEffect(() => {
    reload();
    reloadOauth();
  }, []);

  if (!prefs) return <PanelLoading />;

  const settings = useSettings.getState();
  const c = prefs.calendar ?? {};

  const connect = (p: "google" | "outlook") => {
    setCalMsg(null);
    void api
      .oauthBegin(p)
      .then(() => api.refreshCalendarSource(p))
      .then(reload)
      .catch((e) => setCalMsg(displayError(e)));
  };

  const saveClientId = (p: string) => {
    setCalMsg(null);
    void api
      .oauthSetClientId(p, clientIds[p] ?? "")
      .then(reloadOauth)
      .catch((e) => setCalMsg(displayError(e)));
  };

  const subscribe = () => {
    if (!srcName.trim() || !srcUrl.trim()) return;
    const id = `ics-${Date.now()}`;
    void api
      .addCalendarSource({ id, kind: "icsUrl", name: srcName.trim(), url: srcUrl.trim(), enabled: true })
      .then(() => api.refreshCalendarSource(id))
      .then(() => {
        setSrcName("");
        setSrcUrl("");
        reload();
      })
      .catch(() => {});
  };

  return (
    <>
      <SettingsSection title={t("calendar.sectionDisplay")}>
        <SettingRow
          label={t("calendar.weekStart.label")}
          description={t("calendar.weekStart.desc")}
          control={
            <SegmentedControl
              value={c.weekStart ?? "monday"}
              onChange={(v) => settings.setCalendar({ weekStart: v })}
              options={[
                { value: "monday", label: t("calendar.weekStart.monday") },
                { value: "sunday", label: t("calendar.weekStart.sunday") },
              ]}
            />
          }
        />
        <SettingRow
          label={t("calendar.duration.label")}
          description={t("calendar.duration.desc")}
          control={
            <NumberField
              value={c.defaultEventMinutes ?? 60}
              min={15}
              max={480}
              step={15}
              suffix="min"
              onChange={(n) => settings.setCalendar({ defaultEventMinutes: n })}
            />
          }
        />
        <SettingRow
          label={t("calendar.timeFormat.label")}
          description={t("calendar.timeFormat.desc")}
          control={
            <SegmentedControl
              value={c.timeFormat ?? "24h"}
              onChange={(v) => settings.setCalendar({ timeFormat: v })}
              options={[
                { value: "24h", label: t("calendar.timeFormat.h24") },
                { value: "12h", label: t("calendar.timeFormat.h12") },
              ]}
            />
          }
        />
        <SettingRow
          label={t("calendar.eventLead.label")}
          description={t("calendar.eventLead.desc")}
          control={
            <SegmentedControl
              value={String(c.eventNotifyLeadMinutes ?? 10)}
              onChange={(v) => settings.setCalendar({ eventNotifyLeadMinutes: Number(v) })}
              options={[
                { value: "0", label: t("calendar.eventLead.atStart") },
                { value: "5", label: t("calendar.eventLead.min", { minutes: 5 }) },
                { value: "10", label: t("calendar.eventLead.min", { minutes: 10 }) },
                { value: "15", label: t("calendar.eventLead.min", { minutes: 15 }) },
              ]}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        title={t("calendar.sectionCalendars")}
        description={t("calendar.calendarsDesc")}
      >
        {calendarSyncOn && (
          <div className="mb-3 space-y-2">
            {PROVIDERS.map((p) => (
              <div key={p} className="flex items-center gap-2">
                {configured[p] ? (
                  <button
                    onClick={() => connect(p)}
                    className="rounded-lg border border-border-strong px-2.5 py-1 text-xs capitalize text-fg-muted transition-colors hover:bg-hover"
                  >
                    {t("calendar.connectProvider", { provider: p })}
                  </button>
                ) : (
                  <>
                    <input
                      value={clientIds[p] ?? ""}
                      onChange={(e) => setClientIds((c) => ({ ...c, [p]: e.target.value }))}
                      placeholder={t("calendar.clientIdPlaceholder", { provider: p })}
                      aria-label={t("calendar.clientIdLabel", { provider: p })}
                      className="min-w-0 flex-1 rounded-lg border border-border-strong bg-surface px-2 py-1 text-xs"
                    />
                    <button
                      onClick={() => saveClientId(p)}
                      disabled={!(clientIds[p] ?? "").trim()}
                      className="rounded-lg border border-border-strong px-2.5 py-1 text-xs text-fg-muted transition-colors hover:bg-hover disabled:opacity-50"
                    >
                      {t("common:save")}
                    </button>
                  </>
                )}
              </div>
            ))}
            {PROVIDERS.some((p) => !configured[p]) && (
              <p className="text-xs text-fg-faint">{t("calendar.clientIdHelp")}</p>
            )}
          </div>
        )}
        {calMsg && <p className="mb-2 text-xs text-danger">{calMsg}</p>}
        <div className="space-y-1">
          {sources.length === 0 && (
            <p className="text-xs text-fg-faint">{t("calendar.empty")}</p>
          )}
          {sources.map((src) => (
            <div key={src.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-fg-muted" title={src.url ?? ""}>
                {src.name}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => void api.refreshCalendarSource(src.id).then(reload)}
                  aria-label={t("common:refresh")}
                  className="rounded-md p-1.5 text-fg-subtle transition-colors hover:bg-hover hover:text-accent"
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  onClick={() =>
                    void (src.kind === "google" || src.kind === "outlook"
                      ? api.oauthDisconnect(src.id)
                      : api.removeCalendarSource(src.id)
                    ).then(reload)
                  }
                  aria-label={t("common:remove")}
                  className="rounded-md p-1.5 text-fg-subtle transition-colors hover:bg-hover hover:text-danger"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
        {icsSubscriptionsOn && (
          <div className="mt-3 space-y-2 rounded-xl bg-app/50 p-3">
            <TextField
              value={srcName}
              onChange={(e) => setSrcName(e.target.value)}
              placeholder={t("calendar.namePlaceholder")}
              className="w-full"
            />
            <TextField
              value={srcUrl}
              onChange={(e) => setSrcUrl(e.target.value)}
              placeholder={t("calendar.urlPlaceholder")}
              className="w-full"
            />
            <button
              onClick={subscribe}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-opacity hover:opacity-90"
            >
              {t("calendar.subscribe")}
            </button>
          </div>
        )}
      </SettingsSection>
    </>
  );
}
