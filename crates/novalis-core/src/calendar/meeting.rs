//! Materialize a meeting note from a calendar event (feature W1.3). Deterministic
//! and idempotent: appends one dated, backlinked entry to the day's journal note
//! and one dated backlink per attendee note, so a recurring 1:1 accumulates a
//! linked history without ever duplicating an entry. No AI.

use std::collections::HashSet;
use std::path::Path;

use rusqlite::Connection;

use crate::change;
use crate::error::{CoreError, CoreResult};
use crate::models::{CalendarEvent, MeetingNoteResult};
use crate::notes;
use crate::vault::fs as vault_fs;

/// The date portion (`YYYY-MM-DD`) of a `YYYY-MM-DD[THH:MM]` string.
fn date_part(s: &str) -> &str {
    s.get(..10).unwrap_or(s)
}

/// The day's journal note, matching the "daily" task-capture convention
/// (`journal/YYYY/YYYY-MM-DD.md`; see [`crate::models::TaskCreationPrefs::resolve`]).
fn journal_path(date: &str) -> String {
    let year = date.get(..4).unwrap_or(date);
    format!("journal/{year}/{date}.md")
}

/// Stable idempotency marker for one meeting occurrence: the event's identity
/// (its note path for own events, else its id) plus the date. Distinct
/// occurrences of a recurring event differ by date, so each appends once.
fn occurrence_marker(event: &CalendarEvent, date: &str) -> String {
    let key = event.note_path.as_deref().unwrap_or(event.id.as_str());
    format!("<!-- novalis:meeting {key} {date} -->")
}

/// Deterministic, collision-aware attendee list: collapse internal whitespace,
/// drop blanks, then keep the first spelling of each name (case-insensitive) in
/// input order — so `"Ada"` and `"ada"` collapse to one note/backlink.
fn dedupe_attendees(attendees: &[String]) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    for raw in attendees {
        let name = raw.split_whitespace().collect::<Vec<_>>().join(" ");
        if name.is_empty() {
            continue;
        }
        if seen.insert(name.to_lowercase()) {
            out.push(name);
        }
    }
    out
}

/// Append `line` to the note at `path` (creating it if missing) unless the note
/// already contains `marker`. Reindexes after a write. Returns whether it wrote.
fn append_once(
    db: &Connection,
    vault: &Path,
    path: &str,
    marker: &str,
    line: &str,
) -> CoreResult<bool> {
    let abs = vault_fs::vault_rel(vault, path)?;
    if abs.exists() && std::fs::read_to_string(&abs)?.contains(marker) {
        return Ok(false);
    }
    vault_fs::append_line(vault, path, line)?;
    change::reindex_path(db, vault, path)?;
    Ok(true)
}

/// Materialize a meeting note from `event`. Uses `event.start`'s date as the
/// occurrence date (callers pass the occurrence they acted on). For each
/// attendee it resolves-or-creates a note (idempotent by title) and appends a
/// dated backlink to the meeting; it then appends a dated, backlinked entry to
/// the day's journal note referencing the event and its attendees. Re-running
/// with the same event+date is a no-op (nothing duplicated).
pub fn add_meeting_note(
    db: &Connection,
    vault: &Path,
    event: &CalendarEvent,
) -> CoreResult<MeetingNoteResult> {
    let title = event.title.trim();
    if title.is_empty() {
        return Err(CoreError::BadRequest(
            "event title must not be empty".to_string(),
        ));
    }
    let date = date_part(&event.start).to_string();
    if date.len() != 10 {
        return Err(CoreError::BadRequest(format!(
            "event has no valid date: {:?}",
            event.start
        )));
    }
    let marker = occurrence_marker(event, &date);
    let attendees = dedupe_attendees(&event.attendees);

    // 1. Ensure a note per attendee, each gaining a dated backlink to the
    //    meeting. `[[title]]` resolves back to the event note by its title.
    let mut attendee_notes = Vec::with_capacity(attendees.len());
    let mut attendee_links = Vec::with_capacity(attendees.len());
    for name in &attendees {
        let path = notes::resolve_or_create_wiki_link(db, vault, name)?;
        let line = format!("- {date} — [[{title}]] {marker}");
        append_once(db, vault, &path, &marker, &line)?;
        attendee_links.push(format!("[[{name}]]"));
        attendee_notes.push(path);
    }

    // 2. Append the dated, backlinked entry to the day's journal note.
    let journal = journal_path(&date);
    let entry = if attendee_links.is_empty() {
        format!("- [[{title}]] {marker}")
    } else {
        format!("- [[{title}]] — {} {marker}", attendee_links.join(", "))
    };
    append_once(db, vault, &journal, &marker, &entry)?;

    Ok(MeetingNoteResult {
        journal_path: journal,
        attendee_notes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::schema;
    use crate::models::EventInput;

    struct Ctx {
        _tmp: tempfile::TempDir,
        vault: std::path::PathBuf,
        db: Connection,
    }

    fn ctx() -> Ctx {
        let base = tempfile::tempdir().unwrap();
        let vault = base.path().join("vault");
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::create_dir_all(base.path().join("data/db")).unwrap();
        let db = schema::open_db(&base.path().join("data/db/notes.db")).unwrap();
        Ctx {
            _tmp: base,
            vault,
            db,
        }
    }

    /// Create an own event note with attendees, then read it back (so attendees
    /// come off the frontmatter, exactly as the command does).
    fn seed_event(c: &Ctx, date: &str, attendees: &[&str]) -> CalendarEvent {
        crate::calendar::create_event(
            &c.db,
            &c.vault,
            EventInput {
                title: "Weekly 1:1".into(),
                date: date.into(),
                all_day: false,
                start_time: Some("09:00".into()),
                end_time: Some("09:30".into()),
                rrule: None,
                location: None,
                note_path: None,
                attendees: attendees.iter().map(|s| s.to_string()).collect(),
            },
        )
        .unwrap();
        crate::calendar::read_event(&c.vault, "Calendar/Weekly 1-1.md").unwrap()
    }

    fn read(c: &Ctx, path: &str) -> String {
        std::fs::read_to_string(c.vault.join(path)).unwrap()
    }

    #[test]
    fn creates_journal_entry_and_attendee_backlinks() {
        let c = ctx();
        let event = seed_event(&c, "2026-07-11", &["Ada Lovelace", "Grace Hopper"]);

        let res = add_meeting_note(&c.db, &c.vault, &event).unwrap();
        assert_eq!(res.journal_path, "journal/2026/2026-07-11.md");
        assert_eq!(res.attendee_notes.len(), 2);

        // Attendee notes were created at the vault root.
        assert!(c.vault.join("Ada Lovelace.md").exists());
        assert!(c.vault.join("Grace Hopper.md").exists());

        // The journal entry references the event and both attendees.
        let journal = read(&c, "journal/2026/2026-07-11.md");
        assert!(journal.contains("[[Weekly 1:1]]"), "journal:\n{journal}");
        assert!(journal.contains("[[Ada Lovelace]]"));
        assert!(journal.contains("[[Grace Hopper]]"));

        // Each attendee note gained a dated backlink to the meeting.
        let ada = read(&c, "Ada Lovelace.md");
        assert!(ada.contains("2026-07-11"), "ada:\n{ada}");
        assert!(ada.contains("[[Weekly 1:1]]"));
    }

    #[test]
    fn is_idempotent_when_run_twice() {
        let c = ctx();
        let event = seed_event(&c, "2026-07-11", &["Ada Lovelace"]);

        let first = add_meeting_note(&c.db, &c.vault, &event).unwrap();
        let journal_after_first = read(&c, &first.journal_path);
        let ada_after_first = read(&c, "Ada Lovelace.md");

        // Re-running materialization must NOT duplicate anything.
        let second = add_meeting_note(&c.db, &c.vault, &event).unwrap();
        assert_eq!(first.journal_path, second.journal_path);
        assert_eq!(first.attendee_notes, second.attendee_notes);

        // No duplicate attendee note was minted.
        assert!(!c.vault.join("Ada Lovelace 2.md").exists());

        // Byte-for-byte identical journal + attendee notes after the second run.
        assert_eq!(read(&c, &first.journal_path), journal_after_first);
        assert_eq!(read(&c, "Ada Lovelace.md"), ada_after_first);

        // Exactly one occurrence marker in each.
        let marker = occurrence_marker(&event, "2026-07-11");
        assert_eq!(journal_after_first.matches(&marker).count(), 1);
        assert_eq!(ada_after_first.matches(&marker).count(), 1);
    }

    #[test]
    fn dedupes_attendees_case_insensitively() {
        let c = ctx();
        let event = seed_event(&c, "2026-07-11", &["Ada Lovelace", "ada lovelace", "  "]);
        let res = add_meeting_note(&c.db, &c.vault, &event).unwrap();
        // "Ada Lovelace" / "ada lovelace" collapse to one; blanks are dropped.
        assert_eq!(res.attendee_notes.len(), 1);
        assert_eq!(res.attendee_notes[0], "Ada Lovelace.md");
    }

    #[test]
    fn later_occurrence_appends_a_new_dated_entry() {
        let c = ctx();
        // Same event note, a second occurrence on a later date (as the command
        // supplies when the user acts on a recurring instance).
        let mut event = seed_event(&c, "2026-07-11", &["Ada Lovelace"]);
        add_meeting_note(&c.db, &c.vault, &event).unwrap();
        event.start = "2026-07-18".into();
        add_meeting_note(&c.db, &c.vault, &event).unwrap();

        // The 1:1 accumulates: two dated lines in the attendee note, one per week.
        let ada = read(&c, "Ada Lovelace.md");
        assert!(ada.contains("2026-07-11"), "ada:\n{ada}");
        assert!(ada.contains("2026-07-18"), "ada:\n{ada}");
        assert_eq!(ada.matches("[[Weekly 1:1]]").count(), 2);

        // And two separate journal notes exist.
        assert!(c.vault.join("journal/2026/2026-07-11.md").exists());
        assert!(c.vault.join("journal/2026/2026-07-18.md").exists());
    }

    #[test]
    fn empty_title_is_rejected() {
        let c = ctx();
        let event = CalendarEvent {
            id: "local:x".into(),
            source_id: "local".into(),
            title: "   ".into(),
            start: "2026-07-11".into(),
            end: None,
            all_day: true,
            rrule: None,
            location: None,
            note_path: None,
            attendees: Vec::new(),
        };
        assert!(add_meeting_note(&c.db, &c.vault, &event).is_err());
    }
}
