import { create } from "zustand";

import { api, type AgendaItem } from "../ipc/api";

/** Local-date ISO (YYYY-MM-DD) — never UTC, so "today" matches the user's day. */
export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Shift an ISO date by whole days, staying in local time. */
export function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDay(new Date(y, m - 1, d + delta));
}

interface AgendaState {
  /** ISO date of the focused day. */
  focus: string;
  /** Events + tasks placed on the focus day (from get_agenda). */
  items: AgendaItem[];
  /** Open tasks dated before today — only populated when focus === today. */
  overdue: AgendaItem[];
  loading: boolean;
  load: (focus: string) => Promise<void>;
}

export const useAgenda = create<AgendaState>((set) => ({
  focus: isoDay(new Date()),
  items: [],
  overdue: [],
  loading: false,
  load: async (focus) => {
    set({ loading: true, focus });
    const today = isoDay(new Date());
    try {
      const items = await api.getAgenda(focus, focus);
      let overdue: AgendaItem[] = [];
      if (focus === today) {
        // Open tasks whose effective date is before today (events ignored).
        const past = await api.getAgenda("0001-01-01", addDays(focus, -1));
        overdue = past.filter((i) => i.kind === "task");
      }
      set({ items, overdue, loading: false });
    } catch {
      set({ items: [], overdue: [], loading: false });
    }
  },
}));
