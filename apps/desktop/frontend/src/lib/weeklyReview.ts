// Pure helpers for the AI weekly review (components/ai/WeeklyReviewCard.tsx):
// compute the local week window the deterministic digest covers, and parse the
// `weekly-review` action's JSON defensively into a narrative + carry-over tasks.
//
// Carry-overs reuse the SAME validation, dedupe, and line-building as the
// meeting-note task extraction (lib/taskExtract.ts) so accepted items round-trip
// through the Rust task index identically to Bet 4's extracted tasks.

import {
  coerceTask,
  existingTaskTexts,
  normalizeTaskText,
  type ProposedTask,
} from "./taskExtract";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format a local `Date` as RFC 3339 carrying the machine's UTC offset, e.g.
 *  `2026-06-29T00:00:00+02:00`. Carrying the offset (not `Z`) lets the backend
 *  recover the user's local calendar dates from the instant — required by the
 *  `review_digest` window contract (crate::review). */
export function toLocalRfc3339(d: Date): string {
  const off = -d.getTimezoneOffset(); // minutes east of UTC (DST-aware for `d`)
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** The current ISO week — **Monday 00:00 local** up to **next Monday 00:00
 *  local** — as the `[start, end)` bounds `review_digest` expects: `start`
 *  inclusive, `end` exclusive, both offset-carrying RFC 3339 in local time.
 *  Constructing the bounds through the local `Date` constructor keeps them
 *  correct across month/year rollover and DST transitions. */
export function localWeekRange(now: Date = new Date()): { start: string; end: string } {
  const day = now.getDay(); // 0=Sun .. 6=Sat
  const sinceMonday = (day + 6) % 7; // days back to this week's Monday
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - sinceMonday,
    0,
    0,
    0,
    0,
  );
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7, 0, 0, 0, 0);
  return { start: toLocalRfc3339(start), end: toLocalRfc3339(end) };
}

export interface WeeklyReviewResult {
  /** Short plain-text summary of the week (empty when the model returned none). */
  narrative: string;
  /** Proposed new/rescheduled tasks, validated + deduped against the note. */
  carryovers: ProposedTask[];
}

/** Pull the first JSON object out of a model response, tolerating code fences
 *  or stray prose around it. Returns null when nothing object-shaped is found. */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(s.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Parse the `weekly-review` action output defensively: a narrative string plus
 *  carry-over proposals, deduped against the note's existing task lines and
 *  within the batch (identical rules to `parseExtractedTasks`). Malformed input
 *  yields an empty narrative and no carry-overs — never garbage. */
export function parseWeeklyReview(raw: string, body: string): WeeklyReviewResult {
  const obj = extractJsonObject(raw);
  if (!obj) return { narrative: "", carryovers: [] };
  const narrative = typeof obj.narrative === "string" ? obj.narrative.trim() : "";
  const arr = Array.isArray(obj.carryovers) ? obj.carryovers : [];
  const existing = existingTaskTexts(body);
  const seen = new Set<string>();
  const carryovers: ProposedTask[] = [];
  for (const item of arr) {
    const p = coerceTask(item);
    if (!p) continue;
    const norm = normalizeTaskText(p.text);
    if (existing.has(norm) || seen.has(norm)) continue;
    seen.add(norm);
    carryovers.push(p);
  }
  return { narrative, carryovers };
}
