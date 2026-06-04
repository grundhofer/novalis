import { useEffect, useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import { api } from "../ipc/api";
import { fuzzyRank } from "../lib/fuzzy";
import { type ActionId, formatChord } from "../lib/keybindings";
import { useKeymap } from "../stores/keymapStore";
import { usePlugins } from "../stores/pluginStore";
import { useUi } from "../stores/uiStore";
import { useVault } from "../stores/vaultStore";

interface Command {
  id: string;
  title: string;
  /** Right-aligned hint: a formatted shortcut, the built-in badge, or plugin id. */
  badge: string;
  run: () => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(["vault", "common", "today"]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const pluginCommands = usePlugins((s) => s.commands);
  const keymap = useKeymap((s) => s.keymap);
  const inputRef = useRef<HTMLInputElement>(null);

  const openTodaysNote = () => {
    const d = new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
    const path = `journal/${iso.slice(0, 4)}/${iso}.md`;
    void (async () => {
      try {
        await api.createNote(path, { content: "" });
      } catch {
        /* already exists */
      }
      await useVault.getState().refreshTree();
      useUi.getState().openNoteFrom(path, "today");
    })();
  };

  const builtin = (id: string, title: string, action: ActionId | null, run: () => void): Command => ({
    id: `builtin:${id}`,
    title,
    badge: action ? formatChord(keymap[action]) : t("cmdCore"),
    run,
  });

  const viewTitle: Record<"notes" | "today" | "tasks" | "calendar", string> = {
    notes: t("common:views.notes"),
    today: t("common:views.today"),
    tasks: t("common:views.tasks"),
    calendar: t("common:views.calendar"),
  };

  const builtins: Command[] = [
    builtin("view-notes", viewTitle.notes, "view-notes", () => useUi.getState().setView("notes")),
    builtin("view-today", viewTitle.today, "view-today", () => useUi.getState().setView("today")),
    builtin("view-tasks", viewTitle.tasks, "view-tasks", () => useUi.getState().setView("tasks")),
    builtin("view-calendar", viewTitle.calendar, "view-calendar", () =>
      useUi.getState().setView("calendar"),
    ),
    builtin("new-note", t("cmdNewNote"), "new-note", () =>
      void useVault.getState().newNote(useVault.getState().selectedFolder ?? ""),
    ),
    builtin("today-note", t("today:openTodaysNote"), null, openTodaysNote),
    builtin("reindex", t("cmdReindex"), null, () => void api.reindexVault()),
  ];

  const pluginCmds: Command[] = pluginCommands.map((c) => ({
    id: c.id,
    title: c.title,
    badge: c.pluginId,
    run: c.run,
  }));

  const filtered = fuzzyRank([...builtins, ...pluginCmds], query.trim(), (c) => c.title);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const run = (c: Command) => {
    c.run();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      const c = filtered[selected];
      if (c) run(c);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-overlay pt-28"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border-strong bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          placeholder={t("cmdPlaceholder")}
          className="w-full bg-transparent px-4 py-3 text-fg outline-none placeholder:text-fg-faint"
          onKeyDown={onKeyDown}
        />
        <ul className="max-h-80 overflow-y-auto border-t border-border">
          {filtered.length === 0 && (
            <li className="px-4 py-3 text-sm text-fg-faint">{t("cmdEmpty")}</li>
          )}
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button
                onMouseMove={() => setSelected(i)}
                onClick={() => run(c)}
                className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left ${
                  i === selected ? "bg-active" : "hover:bg-hover"
                }`}
              >
                <span className="text-sm text-fg">{c.title}</span>
                <span className="text-[10px] uppercase tracking-wide text-fg-faint">{c.badge}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
