# 26. Journal navigation: previous / next day, ⌘J, insert date and time

Date: 2026-09-23

## Status

Accepted. Amends ADR-0012 (which shipped Today's Note with "no new chord,
no new menu item"). Adds one chord (`Cmd+J`), one menu item (Go ▸ Today's
Note), three palette commands and four catalog strings. No IPC command, no
setting, no dependency.

## Context

`docs/research/2026-09-20-feature-gaps.md` found the journal reachable only
through the Today row (hidden with the sidebar) and the palette, with no way
to step to yesterday and no way to stamp an entry with the time. The owner
answered the feature-gap question on 2026-09-20 (`docs/DECISIONS.md`,
"Answered 2026-09-20"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

which says yes, each with its own ADR in the pull request that builds it,
to `journal-prev-next-day`, `journal-today-menu-chord` and
`journal-insert-datetime` (rows A19, B16 and B32 of that report). This ADR
covers those three; the CLI twin `cli-agents-journal-command` has its own.

## Decision

- **Previous Day / Next Day** (`journal.previousDay`, `journal.nextDay`):
  palette commands only — no chord, no menu item, no glyphs on the Today
  row. They step to the neighbour among the day notes that exist
  (`journal/YYYY-MM-DD.md`, from the listed files; gaps are skipped), seen
  from the active tab's day, or from today when the active tab is not a day
  note. Going forward never skips today: past the last earlier day lies
  today, created exactly like the Today row. Past the first day or past
  today nothing happens, silently.
- **Go ▸ Today's Note, `Cmd+J`**: the existing `file.todayNote`, now also
  in the Go menu under Command Palette with the chord (global scope).
  `Cmd+J` was free: neither CodeMirror's default keymap nor the app binds
  it, and Sublime's Join Lines is not in novalis. The menu item and the
  chord come together: a chord alone would be invisible, a menu item alone
  would not serve a note opened many times a day.
- **Insert Date and Time** (`editor.insertDateTime`): a palette command,
  no chord, no Edit menu item. It inserts local `YYYY-MM-DD HH:MM` at every
  cursor, replacing a selection — the ISO form only, so a stamp sorts and
  matches the journal's file names; no format option, no locale, no
  setting. From the preview it returns to the editor like every other
  editor command.

## Consequences

- `docs/KEYMAP.md` and `lib/keymap.ts` gain the `Cmd+J` row (the parity
  test compares them); `MENU_KEYS` gains `menu.go.todayNote`, so the i18n
  test covers it.
- The local-date helper moved to `lib/localTime.ts` so the editor chunk and
  the command registry share it; `toISOString()` (UTC) stays banned for
  dates a user sees.
- Not built: a calendar, a day picker, per-day glyphs, a date format
  option, templates. Each would need its own yes.
