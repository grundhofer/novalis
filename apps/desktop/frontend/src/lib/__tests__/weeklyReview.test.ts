import { describe, expect, it } from "vitest";

import { extractJsonObject, localWeekRange, parseWeeklyReview } from "../weeklyReview";

describe("localWeekRange", () => {
  it("spans Monday 00:00 to the next Monday 00:00, local time", () => {
    // A Wednesday (2026-07-08). The week's Monday is 2026-07-06.
    const { start, end } = localWeekRange(new Date(2026, 6, 8, 15, 30));
    // Offset-carrying RFC 3339, never a `Z` UTC marker.
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00[+-]\d{2}:\d{2}$/);
    expect(end).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00[+-]\d{2}:\d{2}$/);
    // Parsed back, start is a Monday and the window is exactly 7 days.
    const s = new Date(start);
    const e = new Date(end);
    expect(s.getDay()).toBe(1); // Monday
    expect(e.getDay()).toBe(1); // next Monday
    expect((e.getTime() - s.getTime()) / 86_400_000).toBe(7);
    expect(start.startsWith("2026-07-06")).toBe(true);
    expect(end.startsWith("2026-07-13")).toBe(true);
  });

  it("treats Sunday as the last day of the current week, not the first", () => {
    // Sunday 2026-07-12 still belongs to the week starting Monday 2026-07-06.
    const { start } = localWeekRange(new Date(2026, 6, 12, 9, 0));
    expect(start.startsWith("2026-07-06")).toBe(true);
  });
});

describe("extractJsonObject", () => {
  it("parses a bare object", () => {
    expect(extractJsonObject('{"narrative":"hi","carryovers":[]}')).toEqual({
      narrative: "hi",
      carryovers: [],
    });
  });

  it("tolerates a ```json fence and surrounding prose", () => {
    const raw = 'Sure:\n```json\n{"narrative":"x","carryovers":[]}\n```\ndone';
    expect(extractJsonObject(raw)).toEqual({ narrative: "x", carryovers: [] });
  });

  it("returns null for non-object / array / malformed output", () => {
    expect(extractJsonObject("nope")).toBeNull();
    expect(extractJsonObject("[1,2,3]")).toBeNull();
    expect(extractJsonObject("{broken")).toBeNull();
  });
});

describe("parseWeeklyReview", () => {
  it("extracts the narrative and validated carry-overs", () => {
    const raw = JSON.stringify({
      narrative: "  Solid week.  ",
      carryovers: [
        { text: "Reschedule vendor call", due: "2026-07-15", priority: "high" },
        { text: "Bad date task", due: "15/07/2026" }, // invalid date → dropped field
      ],
    });
    const r = parseWeeklyReview(raw, "# Note\n");
    expect(r.narrative).toBe("Solid week.");
    expect(r.carryovers).toHaveLength(2);
    expect(r.carryovers[0]).toMatchObject({ text: "Reschedule vendor call", due: "2026-07-15" });
    // The malformed date is dropped, not emitted.
    expect(r.carryovers[1].due).toBeUndefined();
  });

  it("dedupes carry-overs against existing note task lines and within the batch", () => {
    const body = "## Actions\n- [ ] Reschedule vendor call @due(2026-07-15)\n";
    const raw = JSON.stringify({
      narrative: "n",
      carryovers: [
        { text: "Reschedule vendor call" }, // already in the note → dropped
        { text: "Email the team" },
        { text: "email the team" }, // dup within batch (case-insensitive) → dropped
      ],
    });
    const r = parseWeeklyReview(raw, body);
    expect(r.carryovers.map((c) => c.text)).toEqual(["Email the team"]);
  });

  it("never returns garbage on malformed model output", () => {
    expect(parseWeeklyReview("sorry, no JSON here", "")).toEqual({
      narrative: "",
      carryovers: [],
    });
  });

  it("tolerates a missing carryovers array", () => {
    const r = parseWeeklyReview('{"narrative":"just prose"}', "");
    expect(r.narrative).toBe("just prose");
    expect(r.carryovers).toEqual([]);
  });
});
