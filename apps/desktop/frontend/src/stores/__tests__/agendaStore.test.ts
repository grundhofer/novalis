// agendaStore.load's monotonic staleness token: rapid day steps fire
// overlapping fetches, and a slow earlier day's response must not overwrite a
// newer one. reset() (vault switch) bumps the same token so an in-flight load
// from the PREVIOUS vault can never land in the new one. Also covers the
// overdue split (only populated when the focus day IS today, tasks only).
// The ipc module is mocked, so no Tauri runtime is needed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getAgenda: vi.fn() }));

vi.mock("../../ipc/api", () => ({ api: { getAgenda: mocks.getAgenda } }));

import type { AgendaItem } from "../../ipc/api";
import { addDays, isoDay, useAgenda } from "../agendaStore";

function item(kind: string, title: string): AgendaItem {
  return { kind, title, start: "2026-01-05", allDay: true, source: "vault", refId: title, notePath: null };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mocks.getAgenda.mockReset();
  useAgenda.setState({ focus: isoDay(new Date()), items: [], overdue: [], loading: false });
});

describe("agendaStore.load", () => {
  it("drops a stale response that resolves after a newer load (last call wins)", async () => {
    // Non-today focus days, so each load issues exactly one fetch.
    const first = deferred<AgendaItem[]>();
    const second = deferred<AgendaItem[]>();
    mocks.getAgenda.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const load1 = useAgenda.getState().load("2000-01-05");
    const load2 = useAgenda.getState().load("2000-01-06");

    second.resolve([item("event", "newer")]);
    await load2;
    expect(useAgenda.getState().items.map((i) => i.title)).toEqual(["newer"]);
    expect(useAgenda.getState().focus).toBe("2000-01-06");

    first.resolve([item("event", "stale")]);
    await load1;
    expect(useAgenda.getState().items.map((i) => i.title)).toEqual(["newer"]);
    expect(useAgenda.getState().loading).toBe(false);
  });

  it("reset bumps the token so an in-flight load from the previous vault is dropped", async () => {
    const inflight = deferred<AgendaItem[]>();
    mocks.getAgenda.mockReturnValueOnce(inflight.promise);

    const load = useAgenda.getState().load("2000-01-05");
    useAgenda.getState().reset(); // vault switch while the fetch is in flight

    inflight.resolve([item("event", "old-vault")]);
    await load;

    expect(useAgenda.getState().items).toEqual([]);
    expect(useAgenda.getState().focus).toBe(isoDay(new Date()));
    expect(useAgenda.getState().loading).toBe(false);
  });

  it("populates overdue (tasks only) when the focus day is today", async () => {
    const today = isoDay(new Date());
    mocks.getAgenda.mockImplementation((start: string) =>
      start === "0001-01-01"
        ? Promise.resolve([item("task", "late task"), item("event", "past event")])
        : Promise.resolve([item("task", "today task")]),
    );

    await useAgenda.getState().load(today);

    expect(mocks.getAgenda).toHaveBeenCalledWith(today, today);
    expect(mocks.getAgenda).toHaveBeenCalledWith("0001-01-01", addDays(today, -1));
    expect(useAgenda.getState().items.map((i) => i.title)).toEqual(["today task"]);
    // Past EVENTS are not "overdue" — only open tasks carry over.
    expect(useAgenda.getState().overdue.map((i) => i.title)).toEqual(["late task"]);
  });

  it("leaves overdue empty (single fetch) for a non-today focus", async () => {
    mocks.getAgenda.mockResolvedValue([item("event", "someday")]);

    await useAgenda.getState().load("2000-01-05");

    expect(mocks.getAgenda).toHaveBeenCalledTimes(1);
    expect(useAgenda.getState().overdue).toEqual([]);
  });

  it("clears items and stops loading when the fetch fails", async () => {
    useAgenda.setState({ items: [item("event", "old")], overdue: [item("task", "old")] });
    mocks.getAgenda.mockRejectedValue(new Error("engine gone"));

    await useAgenda.getState().load("2000-01-05");

    expect(useAgenda.getState().items).toEqual([]);
    expect(useAgenda.getState().overdue).toEqual([]);
    expect(useAgenda.getState().loading).toBe(false);
  });
});
