# 14. Typed file extensions in New Note

Date: 2026-09-14

## Status

Accepted.

## Context

The editor opens the file types of PLAN.md §7.3 — `.txt`, `.json`, `.yaml`,
`.rs` and the rest of tiers A–C — but the app could only create notes. The
New Note dialog appended `.md` to whatever was typed, so `config.json`
became `config.json.md`, and there was no other way to create a file from
inside the app. The owner noticed on 2026-09-14 that they could create
neither Markdown files nor the other supported formats and asked for the
function to exist.

Asked "Andere Dateiformate anlegen" with a new menu item and a new IPC
command as the alternatives, they chose the dialog.

## Decision

`create_note` keeps the extension the user typed when it is one of the
§7.3 tiers A–C (`notes.txt`, `config.json`, `main.rs`), compared
case-insensitively. Any other extension, or none, gets `.md` appended:
`v1.2` becomes `v1.2.md`, as before. The same guards apply as for a note
— nothing hidden, nothing outside the vault, never over an existing file —
minus the `.md` requirement.

No new menu item, IPC command or chord: File ▸ New Note, `Cmd+N`, the
palette entry and the sidebar button (ADR-0012) all reach the same dialog.
The CLI `new` stays notes-only; an agent that needs another file type has
the shell.

The owner's words, 2026-09-14:

> aktuell kann ich keine neuen markdown files oder andere unterstützte
> formate erstellen. diese funktion sollte bestehen.

and, asked "Andere Dateiformate anlegen":

> Dialog Neue Notiz erkennt §7.3-Endungen (Recommended)

whose option text was "Tippst du notizen.txt oder config.json, bleibt die
Endung; ohne Endung wird .md ergänzt. Kein neuer Menüpunkt, kein neuer
IPC-Befehl. CLI new bleibt .md-only."

## Consequences

- PLAN.md §7.3 says after its table that the New Note dialog creates these
  types by typed extension.
- The list of creatable extensions lives in the shell next to
  `create_note` and mirrors §7.3. Adding a file type to §7.3 means adding it
  there too; the two are not tied by a test.
- A file created this way is an ordinary file in the vault: the tree shows
  it, the editor opens it with the §7.3 grammar, the note cache ignores it
  as it ignores every file that is not `.md` — `.markdown` included, which
  §7.3 opens with the Markdown grammar but which has never been a note.
- What this does not add: a file-type picker, a "New File" item, creation
  of types the editor cannot open, `novalis new` for non-notes.
