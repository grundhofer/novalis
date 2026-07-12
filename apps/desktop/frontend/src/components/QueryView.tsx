import { useEffect, useMemo, useState } from "react";

import { Bookmark, ChevronLeft, ChevronRight, Play, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { PropertyValue, QueryResult, QueryViewKind, SavedQuery, Task } from "../ipc/api";
import { api, NovalisError } from "../ipc/api";
import { displayText, noteTitleFromPath } from "../lib/taskDisplay";
import { useSettings } from "../stores/settingsStore";
import { useUi } from "../stores/uiStore";
import { DueBadge, PriorityBadge, TagChip } from "./TaskBadges";

/** The kanban columns query results are bucketed into (a task's `@status`, with
 *  a catch-all "" column for un-statused tasks). Deliberately static: the query
 *  view is a read-only lens, not the editable task board. */
const KANBAN_COLUMN_IDS = ["", "todo", "in-progress", "review", "done"] as const;

/** Render a typed frontmatter property value as a compact cell string. */
function propText(value: PropertyValue | undefined): string {
  if (!value) return "";
  switch (value.kind) {
    case "text":
      return value.value;
    case "number":
      return value.value === null ? "" : String(value.value);
    case "checkbox":
      return value.value ? "✓" : "✗";
    case "list":
      return value.value.join(", ");
  }
}

export function QueryView() {
  const { t } = useTranslation("common");
  const [input, setInput] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [view, setView] = useState<QueryViewKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const saved = useSettings((s) => s.prefs?.savedQueries ?? []);
  const setSavedQueries = useSettings((s) => s.setSavedQueries);

  const run = async (q: string) => {
    const query = q.trim();
    setRunning(true);
    setError(null);
    try {
      const r = await api.runQuery(query);
      setResult(r);
      setView(null); // adopt the query's suggested view
    } catch (e) {
      setResult(null);
      setError(e instanceof NovalisError ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const saveCurrent = () => {
    const query = input.trim();
    if (!query) return;
    const name = window.prompt(t("query.namePrompt"))?.trim();
    if (!name) return;
    const next: SavedQuery[] = [...saved.filter((s) => s.name !== name), { name, query }];
    next.sort((a, b) => a.name.localeCompare(b.name));
    setSavedQueries(next);
  };

  const loadSaved = (q: SavedQuery) => {
    setInput(q.query);
    void run(q.query);
  };

  const deleteSaved = (name: string) => setSavedQueries(saved.filter((s) => s.name !== name));

  const effectiveView: QueryViewKind = view ?? result?.view ?? "table";
  const hasTasks = (result?.tasks.length ?? 0) > 0;
  const hasDates = result?.hasDates ?? false;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-col gap-2 border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void run(input);
            }}
            spellCheck={false}
            placeholder={t("query.placeholder")}
            className="min-w-0 flex-1 rounded-md bg-surface px-3 py-1.5 font-mono text-sm text-fg outline-none ring-1 ring-border placeholder:text-fg-faint focus:ring-accent/50"
          />
          <button
            onClick={() => void run(input)}
            disabled={running}
            className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Play size={13} />
            {t("query.run")}
          </button>
          <button
            onClick={saveCurrent}
            title={t("query.save")}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-sm text-fg-muted ring-1 ring-border transition-colors hover:bg-hover hover:text-fg"
          >
            <Bookmark size={13} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-fg-faint">{t("query.hint")}</span>
        </div>
        {saved.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {saved.map((q) => (
              <span
                key={q.name}
                className="group flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-fg-muted ring-1 ring-border"
              >
                <button onClick={() => loadSaved(q)} className="hover:text-fg" title={q.query}>
                  {q.name}
                </button>
                <button
                  onClick={() => deleteSaved(q.name)}
                  title={t("query.deleteSaved")}
                  className="text-fg-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
      </header>

      {result && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-1.5">
          <ViewTab active={effectiveView === "table"} onClick={() => setView("table")}>
            {t("query.view.table")}
          </ViewTab>
          <ViewTab
            active={effectiveView === "kanban"}
            disabled={!hasTasks}
            onClick={() => setView("kanban")}
          >
            {t("query.view.kanban")}
          </ViewTab>
          <ViewTab
            active={effectiveView === "calendar"}
            disabled={!hasDates}
            onClick={() => setView("calendar")}
          >
            {t("query.view.calendar")}
          </ViewTab>
          <span className="ml-auto text-xs text-fg-subtle">
            {t("query.results", { n: result.notes.length })}
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="p-4 text-sm text-danger">{error}</div>
        ) : !result ? (
          <div className="flex h-full items-center justify-center text-sm text-fg-faint">
            {t("query.prompt")}
          </div>
        ) : effectiveView === "kanban" ? (
          <KanbanResult tasks={result.tasks} />
        ) : effectiveView === "calendar" ? (
          <CalendarResult result={result} />
        ) : (
          <TableResult result={result} />
        )}
      </div>
    </section>
  );
}

function ViewTab({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
        active ? "bg-active text-fg" : "text-fg-muted hover:text-fg"
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function TableResult({ result }: { result: QueryResult }) {
  const { t } = useTranslation("common");
  const openNoteFrom = useUi((s) => s.openNoteFrom);
  if (result.notes.length === 0) {
    return <Empty>{t("query.empty")}</Empty>;
  }
  return (
    <table className="w-full border-collapse text-sm">
      <thead className="sticky top-0 bg-surface text-left text-xs text-fg-subtle">
        <tr className="border-b border-border">
          <th className="px-4 py-2 font-medium">{t("query.columns.title")}</th>
          <th className="px-4 py-2 font-medium">{t("query.columns.folder")}</th>
          {result.propertyKeys.map((k) => (
            <th key={k} className="px-4 py-2 font-medium">
              {k}
            </th>
          ))}
          <th className="px-4 py-2 font-medium">{t("query.columns.modified")}</th>
        </tr>
      </thead>
      <tbody>
        {result.notes.map((n) => {
          const byKey = new Map(n.properties.map((p) => [p.key, p.value]));
          return (
            <tr
              key={n.path}
              onClick={() => openNoteFrom(n.path, "query")}
              className="cursor-pointer border-b border-border/60 hover:bg-hover"
            >
              <td className="max-w-xs truncate px-4 py-1.5 text-fg" title={n.path}>
                {n.title}
                {n.tags.length > 0 && (
                  <span className="ml-2 inline-flex gap-1 align-middle">
                    {n.tags.slice(0, 3).map((tag) => (
                      <TagChip key={tag} tag={tag} />
                    ))}
                  </span>
                )}
              </td>
              <td className="max-w-[10rem] truncate px-4 py-1.5 text-fg-subtle">{n.folder}</td>
              {result.propertyKeys.map((k) => (
                <td key={k} className="max-w-[12rem] truncate px-4 py-1.5 text-fg-muted">
                  {propText(byKey.get(k))}
                </td>
              ))}
              <td className="whitespace-nowrap px-4 py-1.5 text-xs text-fg-faint">
                {n.modified.slice(0, 10)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function KanbanResult({ tasks }: { tasks: Task[] }) {
  const { t } = useTranslation("common");
  const openNoteFrom = useUi((s) => s.openNoteFrom);
  const colLabels: Record<string, string> = {
    "": t("query.kanban.none"),
    todo: t("query.kanban.todo"),
    "in-progress": t("query.kanban.inProgress"),
    review: t("query.kanban.review"),
    done: t("query.kanban.done"),
  };
  const columnFor = (task: Task) =>
    task.status && (KANBAN_COLUMN_IDS as readonly string[]).includes(task.status)
      ? task.status
      : "";
  if (tasks.length === 0) return <Empty>{t("query.noTasks")}</Empty>;
  return (
    <div className="flex h-full gap-3 overflow-x-auto p-3">
      {KANBAN_COLUMN_IDS.map((colId) => {
        const colTasks = tasks.filter((task) => columnFor(task) === colId);
        return (
          <div key={colId} className="flex w-64 shrink-0 flex-col rounded-lg bg-surface/50">
            <div className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
              {colLabels[colId]} <span className="text-fg-faint">{colTasks.length}</span>
            </div>
            <div className="flex flex-col gap-2 overflow-y-auto p-2">
              {colTasks.map((task) => (
                <div
                  key={task.id}
                  onClick={() => openNoteFrom(task.sourceNote, "query")}
                  title={task.sourceNote}
                  className="cursor-pointer rounded-md border border-border bg-surface p-2 text-sm text-fg transition-colors hover:border-border-strong"
                >
                  <div className="mb-0.5 truncate text-xs text-fg-subtle">
                    {task.noteTitle || noteTitleFromPath(task.sourceNote)}
                  </div>
                  <div className={task.completed ? "text-fg-faint line-through" : undefined}>
                    {displayText(task.text)}
                  </div>
                  {(task.priority || task.dueDate || task.tags.length > 0) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {task.priority && <PriorityBadge priority={task.priority} />}
                      {task.dueDate && <DueBadge due={task.dueDate} completed={task.completed} />}
                      {task.tags.map((tag) => (
                        <TagChip key={tag} tag={tag} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A local YYYY-MM-DD for a Date (avoids the UTC shift of toISOString). */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function CalendarResult({ result }: { result: QueryResult }) {
  const { t } = useTranslation("common");
  const openNoteFrom = useUi((s) => s.openNoteFrom);
  const dated = useMemo(
    () => result.notes.filter((n) => n.date && n.date.length >= 10),
    [result.notes],
  );
  // Anchor the grid on the first dated note's month (fall back to today).
  const [anchor, setAnchor] = useState(() => {
    const first = dated.find((n) => n.date);
    const base = first?.date ? new Date(`${first.date.slice(0, 10)}T00:00:00`) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const byDay = useMemo(() => {
    const map = new Map<string, typeof dated>();
    for (const n of dated) {
      const key = n.date!.slice(0, 10);
      const arr = map.get(key) ?? [];
      arr.push(n);
      map.set(key, arr);
    }
    return map;
  }, [dated]);

  // Re-anchor on the first dated note whenever a new query changes the set (but
  // not while the user pages months — `dated` is stable across that).
  useEffect(() => {
    const first = dated.find((n) => n.date);
    const base = first?.date ? new Date(`${first.date.slice(0, 10)}T00:00:00`) : new Date();
    setAnchor(new Date(base.getFullYear(), base.getMonth(), 1));
  }, [dated]);

  if (dated.length === 0) return <Empty>{t("query.noDates")}</Empty>;

  // Six-week grid starting on the Monday on/before the 1st.
  const first = new Date(anchor);
  const offset = (first.getDay() + 6) % 7; // Monday=0
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  const monthLabel = anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-2 flex items-center gap-2">
        <button
          onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))}
          className="rounded px-2 py-1 text-fg-muted hover:bg-hover"
          aria-label={t("query.prevMonth")}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-medium text-fg">{monthLabel}</span>
        <button
          onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))}
          className="rounded px-2 py-1 text-fg-muted hover:bg-hover"
          aria-label={t("query.nextMonth")}
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-px overflow-y-auto rounded-md bg-border">
        {days.map((d) => {
          const key = isoDay(d);
          const inMonth = d.getMonth() === anchor.getMonth();
          const notes = byDay.get(key) ?? [];
          return (
            <div
              key={key}
              className={`min-h-[4rem] p-1 ${inMonth ? "bg-surface" : "bg-surface-2/40"}`}
            >
              <div className={`text-xs ${inMonth ? "text-fg-subtle" : "text-fg-faint"}`}>
                {d.getDate()}
              </div>
              <div className="mt-0.5 flex flex-col gap-0.5">
                {notes.map((n) => (
                  <button
                    key={n.path}
                    onClick={() => openNoteFrom(n.path, "query")}
                    title={n.path}
                    className="truncate rounded bg-accent/15 px-1 py-0.5 text-left text-xs text-accent hover:bg-accent/25"
                  >
                    {n.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-fg-faint">{children}</div>
  );
}
