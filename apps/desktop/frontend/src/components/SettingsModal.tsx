import { useEffect, useState } from "react";

import { api, type CalendarSourceConfig, type NoteTemplate, type PluginInfo } from "../ipc/api";
import { usePlugins } from "../stores/pluginStore";
import { useTasks } from "../stores/taskStore";

interface Col {
  id: string;
  title: string;
}

const DEFAULT_COLS: Col[] = [
  { id: "backlog", title: "Backlog" },
  { id: "todo", title: "To Do" },
  { id: "in-progress", title: "In Progress" },
  { id: "review", title: "Review" },
  { id: "done", title: "Done" },
];

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [strategy, setStrategy] = useState("inbox");
  const [inboxPath, setInboxPath] = useState("_Inbox.md");
  const [defaultMode, setDefaultMode] = useState("list");
  const [columns, setColumns] = useState<Col[]>(DEFAULT_COLS);
  const [templates, setTemplates] = useState<NoteTemplate[]>([]);
  const [tplName, setTplName] = useState("");
  const [tplContent, setTplContent] = useState("");
  const [sources, setSources] = useState<CalendarSourceConfig[]>([]);
  const [srcName, setSrcName] = useState("");
  const [srcUrl, setSrcUrl] = useState("");
  const [calMsg, setCalMsg] = useState<string | null>(null);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSaved(false);
    void api
      .getPreferences()
      .then((p) => {
        const tv = p.taskView;
        setStrategy(tv?.taskCreation?.strategy ?? "inbox");
        setInboxPath(tv?.taskCreation?.inboxPath ?? "_Inbox.md");
        setDefaultMode(tv?.defaultMode ?? "list");
        const cols = (tv?.kanbanColumns ?? [])
          .map((c) => ({ id: c.id ?? "", title: c.title ?? "" }))
          .filter((c) => c.id !== "");
        setColumns(cols.length > 0 ? cols : DEFAULT_COLS);
      })
      .catch(() => {});
    void api.listTemplates().then(setTemplates).catch(() => {});
    void api.listCalendarSources().then(setSources).catch(() => {});
    void api.listPlugins().then(setPlugins).catch(() => {});
  }, [open]);

  const reloadSources = () => void api.listCalendarSources().then(setSources).catch(() => {});

  const togglePlugin = async (id: string, enabled: boolean) => {
    try {
      await api.setPluginEnabled(id, enabled);
      await usePlugins.getState().reload();
      setPlugins(await api.listPlugins());
    } catch {
      /* ignore */
    }
  };

  if (!open) return null;

  const save = async () => {
    try {
      // Read-modify-write: preserve `fileTree` (folder colors / manual order /
      // sort), which the sidebar owns — writing the whole Preferences blob would
      // otherwise wipe it.
      const cur = await api.getPreferences();
      await api.setPreferences({
        ...cur,
        taskView: { defaultMode, kanbanColumns: columns, taskCreation: { strategy, inboxPath } },
        fileTree: cur.fileTree,
      });
      setSaved(true);
      void useTasks.getState().load();
    } catch {
      /* ignore */
    }
  };

  const createTpl = async () => {
    if (!tplName.trim()) return;
    try {
      await api.createTemplate(tplName.trim(), tplContent);
      setTplName("");
      setTplContent("");
      setTemplates(await api.listTemplates());
    } catch {
      /* ignore */
    }
  };

  const deleteTpl = async (id: string) => {
    try {
      await api.deleteTemplate(id);
      setTemplates(await api.listTemplates());
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-16"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-100">Settings</h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200">
            ✕
          </button>
        </div>

        <Section title="Task creation">
          <Row label="Strategy">
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              className="rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
            >
              <option value="inbox">Inbox note</option>
              <option value="daily">Daily note</option>
              <option value="active-note">Active note</option>
            </select>
          </Row>
          <Row label="Inbox path">
            <input
              value={inboxPath}
              onChange={(e) => setInboxPath(e.target.value)}
              className="w-48 rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
            />
          </Row>
          <Row label="Default task view">
            <select
              value={defaultMode}
              onChange={(e) => setDefaultMode(e.target.value)}
              className="rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
            >
              <option value="list">List</option>
              <option value="kanban">Kanban</option>
              <option value="agenda">Agenda</option>
            </select>
          </Row>
        </Section>

        <Section title="Kanban columns">
          <div className="space-y-1">
            {columns.map((col, i) => (
              <div key={col.id} className="flex items-center gap-2">
                <input
                  value={col.title}
                  onChange={(e) =>
                    setColumns((c) => c.map((x, idx) => (idx === i ? { ...x, title: e.target.value } : x)))
                  }
                  className="flex-1 rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
                />
                <button
                  onClick={() => setColumns((c) => c.filter((_, idx) => idx !== i))}
                  className="text-neutral-500 hover:text-red-300"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={() => setColumns((c) => [...c, { id: `col-${Date.now()}`, title: "New Column" }])}
              className="mt-1 text-xs text-indigo-400 hover:text-indigo-300"
            >
              + Add column
            </button>
          </div>
        </Section>

        <Section title="Templates">
          <div className="space-y-1">
            {templates.length === 0 && <p className="text-xs text-neutral-600">No templates yet.</p>}
            {templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-neutral-200">{t.name}</span>
                <button
                  onClick={() => void deleteTpl(t.id)}
                  className="text-neutral-500 hover:text-red-300"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-2 rounded-lg bg-neutral-950/50 p-2">
            <input
              value={tplName}
              onChange={(e) => setTplName(e.target.value)}
              placeholder="Template name"
              className="w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-600"
            />
            <textarea
              value={tplContent}
              onChange={(e) => setTplContent(e.target.value)}
              placeholder="Template content (markdown)…"
              rows={3}
              className="w-full rounded bg-neutral-800 px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600"
            />
            <button
              onClick={() => void createTpl()}
              className="rounded-md bg-indigo-500/90 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-400"
            >
              Add template
            </button>
          </div>
        </Section>

        <Section title="Calendars">
          <div className="mb-2 flex gap-2">
            {(["google", "outlook"] as const).map((p) => (
              <button
                key={p}
                onClick={() => {
                  setCalMsg(null);
                  void api
                    .oauthBegin(p)
                    .then(() => api.refreshCalendarSource(p))
                    .then(reloadSources)
                    .catch((e) => setCalMsg(String(e)));
                }}
                className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs capitalize text-neutral-200 hover:bg-white/5"
              >
                Connect {p}
              </button>
            ))}
          </div>
          {calMsg && <p className="mb-2 text-xs text-red-400">{calMsg}</p>}
          <p className="mb-2 text-[11px] text-neutral-600">
            Read-only. You can also subscribe to any ICS URL (incl. Google/Outlook secret iCal
            links) below.
          </p>
          <div className="space-y-1">
            {sources.length === 0 && (
              <p className="text-xs text-neutral-600">No calendar subscriptions.</p>
            )}
            {sources.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-neutral-200" title={s.url ?? ""}>
                  {s.name}
                </span>
                <div className="flex shrink-0 gap-2 text-xs">
                  <button
                    onClick={() => void api.refreshCalendarSource(s.id).then(reloadSources)}
                    className="text-indigo-400 hover:text-indigo-300"
                  >
                    Refresh
                  </button>
                  <button
                    onClick={() =>
                      void (s.kind === "google" || s.kind === "outlook"
                        ? api.oauthDisconnect(s.id)
                        : api.removeCalendarSource(s.id)
                      ).then(reloadSources)
                    }
                    className="text-neutral-500 hover:text-red-300"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-2 rounded-lg bg-neutral-950/50 p-2">
            <input
              value={srcName}
              onChange={(e) => setSrcName(e.target.value)}
              placeholder="Calendar name"
              className="w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-600"
            />
            <input
              value={srcUrl}
              onChange={(e) => setSrcUrl(e.target.value)}
              placeholder="ICS URL (e.g. Google/Outlook secret iCal address)"
              className="w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-600"
            />
            <button
              onClick={() => {
                if (!srcName.trim() || !srcUrl.trim()) return;
                const id = `ics-${Date.now()}`;
                void api
                  .addCalendarSource({
                    id,
                    kind: "icsUrl",
                    name: srcName.trim(),
                    url: srcUrl.trim(),
                    enabled: true,
                  })
                  .then(() => api.refreshCalendarSource(id))
                  .then(() => {
                    setSrcName("");
                    setSrcUrl("");
                    reloadSources();
                  })
                  .catch(() => {});
              }}
              className="rounded-md bg-indigo-500/90 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-400"
            >
              Subscribe
            </button>
          </div>
        </Section>

        <Section title="Plugins">
          {plugins.length === 0 ? (
            <p className="text-xs text-neutral-600">
              No plugins installed. Drop a plugin folder into <code>.novalis/plugins/</code> in
              your vault (see PLUGINS.md), then reopen Settings.
            </p>
          ) : (
            <div className="space-y-1.5">
              {plugins.map((p) => (
                <div key={p.manifest.id} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm text-neutral-200">{p.manifest.name}</div>
                    <div className="truncate text-xs text-neutral-600">
                      {p.manifest.description || p.manifest.id}
                      {(p.manifest.capabilities ?? []).length > 0 &&
                        ` · ${(p.manifest.capabilities ?? []).join(", ")}`}
                    </div>
                  </div>
                  <label className="flex shrink-0 items-center gap-1 text-xs text-neutral-400">
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={(e) => void togglePlugin(p.manifest.id, e.target.checked)}
                      className="accent-indigo-500"
                    />
                    {p.enabled ? "On" : "Off"}
                  </label>
                </div>
              ))}
            </div>
          )}
        </Section>

        <div className="mt-5 flex items-center justify-end gap-3">
          {saved && <span className="text-xs text-green-400">Saved</span>}
          <button
            onClick={() => void save()}
            className="rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-400"
          >
            Save preferences
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <span className="text-sm text-neutral-300">{label}</span>
      {children}
    </div>
  );
}
