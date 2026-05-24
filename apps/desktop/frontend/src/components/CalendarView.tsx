import { useEffect, useState } from "react";

import { api, type CalendarEvent, type EventDraft } from "../ipc/api";
import { isoDate, monthGrid, useCalendar } from "../stores/calendarStore";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const freqToRrule = (f: string) =>
  f === "none" ? undefined : `FREQ=${f.toUpperCase()}`;
const rruleToFreq = (r?: string | null) => {
  if (!r) return "none";
  const m = r.match(/FREQ=(\w+)/i);
  return m ? m[1].toLowerCase() : "none";
};

export function CalendarView() {
  const month = useCalendar((s) => s.month);
  const events = useCalendar((s) => s.events);
  const [editing, setEditing] = useState<EventDraft | null>(null);

  useEffect(() => {
    void useCalendar.getState().load();
  }, []);

  const grid = monthGrid(month);
  const todayIso = isoDate(new Date());
  const monthLabel = month.toLocaleString(undefined, { month: "long", year: "numeric" });

  const eventsOn = (iso: string) => events.filter((e) => e.start.slice(0, 10) === iso);

  const newOn = (iso: string) =>
    setEditing({ title: "", date: iso, allDay: false, startTime: "09:00", endTime: "10:00" });

  const edit = (e: CalendarEvent) =>
    setEditing({
      title: e.title,
      date: e.start.slice(0, 10),
      allDay: e.allDay,
      startTime: !e.allDay && e.start.length >= 16 ? e.start.slice(11, 16) : undefined,
      endTime: e.end && !e.allDay && e.end.length >= 16 ? e.end.slice(11, 16) : undefined,
      rrule: e.rrule ?? undefined,
      location: e.location ?? undefined,
      notePath: e.notePath ?? undefined,
    });

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-neutral-800 px-4 py-2">
        <div className="flex items-center gap-2">
          <button onClick={() => useCalendar.getState().prev()} className="rounded px-2 py-1 text-neutral-400 hover:bg-white/5">
            ‹
          </button>
          <span className="min-w-40 text-center text-sm font-medium text-neutral-100">{monthLabel}</span>
          <button onClick={() => useCalendar.getState().next()} className="rounded px-2 py-1 text-neutral-400 hover:bg-white/5">
            ›
          </button>
          <button onClick={() => useCalendar.getState().today()} className="ml-1 rounded px-2 py-1 text-xs text-neutral-400 hover:bg-white/5">
            Today
          </button>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <button onClick={() => void api.importIcs().then(() => useCalendar.getState().load())} className="rounded px-2 py-1 text-neutral-400 hover:bg-white/5">
            Import .ics
          </button>
          <button
            onClick={() => {
              const g = monthGrid(month);
              void api.exportIcs(isoDate(g[0]), isoDate(g[g.length - 1]));
            }}
            className="rounded px-2 py-1 text-neutral-400 hover:bg-white/5"
          >
            Export .ics
          </button>
          <button onClick={() => newOn(todayIso)} className="rounded-md bg-indigo-500 px-3 py-1 font-medium text-white hover:bg-indigo-400">
            New event
          </button>
        </div>
      </header>

      <div className="grid grid-cols-7 border-b border-neutral-800 text-xs text-neutral-500">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-1 text-center">
            {d}
          </div>
        ))}
      </div>

      <div className="grid flex-1 grid-cols-7 grid-rows-6">
        {grid.map((day) => {
          const iso = isoDate(day);
          const inMonth = day.getMonth() === month.getMonth();
          const isToday = iso === todayIso;
          return (
            <div
              key={iso}
              onClick={() => newOn(iso)}
              className={`min-h-0 cursor-pointer overflow-hidden border-b border-r border-neutral-800/60 p-1 ${
                inMonth ? "" : "bg-neutral-950/60 text-neutral-700"
              }`}
            >
              <div className={`mb-0.5 text-right text-xs ${isToday ? "font-bold text-indigo-300" : "text-neutral-500"}`}>
                {day.getDate()}
              </div>
              <div className="space-y-0.5">
                {eventsOn(iso).slice(0, 4).map((e) => (
                  <button
                    key={e.id}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      edit(e);
                    }}
                    className={`block w-full truncate rounded px-1 py-0.5 text-left text-[11px] ${
                      e.sourceId === "local"
                        ? "bg-indigo-500/25 text-indigo-100"
                        : "bg-teal-500/20 text-teal-100"
                    }`}
                    title={e.title}
                  >
                    {!e.allDay && e.start.length >= 16 ? `${e.start.slice(11, 16)} ` : ""}
                    {e.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <EventModal
          draft={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void useCalendar.getState().load();
          }}
        />
      )}
    </section>
  );
}

function EventModal({
  draft,
  onClose,
  onSaved,
}: {
  draft: EventDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [d, setD] = useState<EventDraft>(draft);
  const [freq, setFreq] = useState(rruleToFreq(draft.rrule));
  const editing = Boolean(draft.notePath);

  const save = async () => {
    if (!d.title.trim()) return;
    const payload: EventDraft = { ...d, rrule: freqToRrule(freq) };
    try {
      if (editing) await api.updateEvent(payload);
      else await api.createEvent(payload);
      onSaved();
    } catch {
      /* ignore */
    }
  };

  const remove = async () => {
    if (!d.notePath) return;
    try {
      await api.deleteEvent(d.notePath);
      onSaved();
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border border-neutral-700 bg-neutral-900 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-sm font-semibold text-neutral-100">{editing ? "Edit event" : "New event"}</h2>
        <div className="space-y-2">
          <input
            autoFocus
            value={d.title}
            onChange={(e) => setD({ ...d, title: e.target.value })}
            placeholder="Event title"
            className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600"
          />
          <input
            type="date"
            value={d.date}
            onChange={(e) => setD({ ...d, date: e.target.value })}
            className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100"
          />
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input type="checkbox" checked={d.allDay} onChange={(e) => setD({ ...d, allDay: e.target.checked })} className="accent-indigo-500" />
            All day
          </label>
          {!d.allDay && (
            <div className="flex gap-2">
              <input
                type="time"
                value={d.startTime ?? ""}
                onChange={(e) => setD({ ...d, startTime: e.target.value })}
                className="flex-1 rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100"
              />
              <input
                type="time"
                value={d.endTime ?? ""}
                onChange={(e) => setD({ ...d, endTime: e.target.value })}
                className="flex-1 rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100"
              />
            </div>
          )}
          <div className="flex gap-2">
            <select value={freq} onChange={(e) => setFreq(e.target.value)} className="rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100">
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            <input
              value={d.location ?? ""}
              onChange={(e) => setD({ ...d, location: e.target.value })}
              placeholder="Location"
              className="flex-1 rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600"
            />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between">
          {editing ? (
            <button onClick={() => void remove()} className="text-xs text-red-400 hover:text-red-300">
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200">
              Cancel
            </button>
            <button onClick={() => void save()} className="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400">
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
