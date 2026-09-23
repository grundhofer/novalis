const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A day as `YYYY-MM-DD` in local time, never `toISOString()`: that is UTC,
 * and a note written at 23:30 belongs to that day.
 */
export function localIsoDay(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Local `YYYY-MM-DD HH:MM` (ADR-0026): the ISO form only, so a stamp sorts
 * and matches the journal's file names; no seconds, no zone, no locale.
 */
export function localIsoMinute(now = new Date()): string {
  return `${localIsoDay(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
