# 27. `novalis journal`: the day note from the command line

Date: 2026-09-23

## Status

Accepted. Adds one CLI command to PLAN.md §9.2. No IPC, no setting, no
dependency, no outbound connection; the core gains two date helpers and no
string.

## Context

The app has had Today's Note since ADR-0012 — `journal/YYYY-MM-DD.md`,
local date, created empty. An agent had to do it in two steps
(`new … --exist-ok`, then `edit --append`) and compute the date itself,
which is the UTC day after 22:00 in Europe: the exact trap
`lib/commands.ts` warns about. The owner answered the feature-gap question
on 2026-09-20 (`docs/DECISIONS.md`, "Answered 2026-09-20"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

which says yes, with its own ADR, to `cli-agents-journal-command` (row B28
of `docs/research/2026-09-20-feature-gaps.md`).

## Decision

- **`novalis journal [--date YYYY-MM-DD|today|yesterday] [--append
  <text|->] [--materialize]`.** The date defaults to today in local time
  (`util::local_iso_day`, from the core's `localtime_r` clock); `--date`
  must be exactly a real `YYYY-MM-DD` day (`util::is_iso_day`), else exit 2.
- A missing day note is created empty, folder included, exactly like the
  app's Today row; an existing one is left alone. `--append` then adds at
  the end the way `edit --append` does, in the same call; a value starting
  with `-` is text, since a journal line usually is a list item.
  A create that loses a race with the app falls through to the existing
  note.
- Output `{path, stem, linkTarget, existing, sha256}` plus `appended: true`
  and `dryRun: true` when they apply; `sha256` is the note's hash after the
  call. It is a mutation (`--no-index` refused, `--dry-run` honoured).
- The folder stays hard-coded (`journal`) in both the UI and the CLI; there
  is no shared constant, because the UI mirrors it by hand either way.
- **Not built:** listing days (`--since`), templates, a folder flag, a
  `--prepend`. Each would need its own yes.

## Consequences

- PLAN.md §9.2 has the row; `SKILL.md`, `reference.md` and `examples.md`
  tell agents to use it instead of computing the date.
- Three golden cases (new note with an append, existing note, malformed
  date) pin `--date`, since goldens must not depend on the day they run.
- Contract after 1.0: fields may be added, never renamed (PLAN.md §9).
