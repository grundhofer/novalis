import { describe, expect, it } from "vitest";

import type { BoardViewDto, CardDto } from "../ipc/client";
import { cardOrder, cardPasses, filterCount, spanStart } from "./boardView";

const plain: BoardViewDto = {
  collapsed: false,
  hiddenColumns: [],
  changedWithin: null,
  sort: null,
  sortReversed: false,
  labelTones: {},
};

const card = (id: string, title: string, order: string, updated: string, created = updated, description: string | null = null) =>
  ({
    id,
    title,
    column: "todo",
    order,
    notes: [],
    updated,
    created,
    description,
    descriptionHtml: null,
    labels: [],
    due: null,
    priority: null,
    assignee: null,
  }) as CardDto;

// ADR-0054: which cards a column shows, and in which order.
describe("the board's filter", () => {
  const now = new Date(2026, 10, 15, 14, 0, 0);

  it("finds the search in the title or the description, without case", () => {
    const spec = card("1", "Write the Spec", "a0", "2026-11-01T00:00:00Z", undefined, "für die Kacheln");
    expect(cardPasses(spec, "", plain, now)).toBe(true);
    expect(cardPasses(spec, "  spec ", plain, now)).toBe(true);
    expect(cardPasses(spec, "KACHELN", plain, now)).toBe(true);
    expect(cardPasses(spec, "zoom", plain, now)).toBe(false);
  });

  it("lets through only cards changed within the span", () => {
    const today = card("1", "a", "a0", new Date(2026, 10, 15, 0, 30).toISOString());
    const yesterday = card("2", "b", "a0", new Date(2026, 10, 14, 23, 30).toISOString());
    const old = card("3", "c", "a0", new Date(2026, 8, 1).toISOString());
    const within = (span: BoardViewDto["changedWithin"]) =>
      [today, yesterday, old].filter((c) => cardPasses(c, "", { ...plain, changedWithin: span }, now)).map((c) => c.id);
    expect(within("today")).toEqual(["1"]);
    expect(within("7d")).toEqual(["1", "2"]);
    expect(within("90d")).toEqual(["1", "2", "3"]);
    expect(spanStart("today", now)).toBe(new Date(2026, 10, 15).getTime());
  });

  it("counts the search, hidden columns and a span as one filter each", () => {
    expect(filterCount("", plain)).toBe(0);
    expect(filterCount(" x ", { ...plain, hiddenColumns: ["a", "b"], changedWithin: "30d" })).toBe(3);
    // The order is no filter.
    expect(filterCount("", { ...plain, sort: "title" })).toBe(0);
  });
});

describe("the board's card order", () => {
  const a = card("A", "Beta", "a2", "2026-11-03T00:00:00Z", "2026-10-01T00:00:00Z");
  const b = card("B", "alpha", "a0", "2026-11-01T00:00:00Z", "2026-10-03T00:00:00Z");
  const c = card("C", "Gamma", "a1", "2026-11-02T00:00:00Z", "2026-10-02T00:00:00Z");
  const ids = (view: BoardViewDto) => [a, b, c].sort(cardOrder(view)).map((x) => x.id);

  it("is the manual order without a sort", () => {
    expect(ids(plain)).toEqual(["B", "C", "A"]);
  });

  it("sorts by title A to Z, by last change and by creation newest first, each turned round on request", () => {
    expect(ids({ ...plain, sort: "title" })).toEqual(["B", "A", "C"]);
    expect(ids({ ...plain, sort: "title", sortReversed: true })).toEqual(["C", "A", "B"]);
    expect(ids({ ...plain, sort: "updated" })).toEqual(["A", "C", "B"]);
    expect(ids({ ...plain, sort: "created" })).toEqual(["B", "C", "A"]);
    expect(ids({ ...plain, sort: "created", sortReversed: true })).toEqual(["A", "C", "B"]);
  });

  it("orders numbers in a title by their value", () => {
    const two = card("2", "Aufgabe 2", "a0", "2026-11-01T00:00:00Z");
    const ten = card("10", "Aufgabe 10", "a1", "2026-11-01T00:00:00Z");
    expect([ten, two].sort(cardOrder({ ...plain, sort: "title" })).map((z) => z.id)).toEqual(["2", "10"]);
  });

  it("keeps the manual order between equals", () => {
    const x = card("X", "Same", "a5", "2026-11-01T00:00:00Z");
    const y = card("Y", "Same", "a1", "2026-11-01T00:00:00Z");
    expect([x, y].sort(cardOrder({ ...plain, sort: "title" })).map((z) => z.id)).toEqual(["Y", "X"]);
  });
});
