//! The weekly-review digest: a deterministic, no-AI assembly of the week's
//! completed / slipped / upcoming tasks, edited notes, and calendar agenda into
//! a [`ReviewDigest`] (structured, for the UI + the AI layer) plus a canonical
//! markdown section ready to drop into a note.
//!
//! ## Time-window contract (timezone-safe by design)
//!
//! `review_digest` takes its bounds as **RFC 3339 datetime strings carrying the
//! user's local UTC offset** — `range_start` is the inclusive start instant and
//! `range_end` is the *exclusive* end instant (the start of the day after the
//! window). Carrying the offset lets `.date_naive()` recover the user's local
//! calendar dates, so two different granularities stay correct:
//!
//! - **Notes** are bucketed by *instant*: a note's `modified` timestamp (a UTC
//!   RFC 3339 string) is compared against `[range_start, range_end)` as absolute
//!   time. A note edited at 23:30 local on the last day — whose UTC calendar
//!   date is the *next* day — is still counted, and one edited at 00:30 local on
//!   a day whose UTC date is the *previous* day is counted too. Naive
//!   date-string slicing would misfile both; instant comparison does not.
//! - **Tasks and the agenda** are bucketed by *local date*: the window's local
//!   date bounds are derived from the offset-carrying instants and compared
//!   against the `YYYY-MM-DD` `@due`/`@start` dates.
//!
//! ## Bucket definitions (and an honest limitation)
//!
//! The vault task format has **no completion timestamp** — a checked box records
//! *that* a task is done, never *when*. So "completed this week" is necessarily a
//! proxy: a task is counted as completed-this-week when it is `completed` **and**
//! its effective date (its `@due`, else its `@start`) falls inside the window.
//! Consequences, documented rather than hidden: a completed task with no
//! due/start date cannot be dated and never appears; and a task due last week but
//! only checked off this week is filed under *last* week's window. This is the
//! best available signal without inventing a `completed_at` field.
//!
//! - **completed** — `completed`, effective date (due ?? start) in the window.
//! - **overdue** — open, `@due` strictly *before* the window start (slipped in
//!   from an earlier week and still not done).
//! - **due_this_week** — open, `@due` inside the window.
//! - **notes_touched** — note_meta rows whose `modified` instant is in the
//!   window (see the instant rule above).
//! - **agenda** — [`crate::calendar::get_agenda`] over the window's local dates
//!   (scheduled tasks + calendar events, as the calendar view shows them).

use chrono::{DateTime, Duration, FixedOffset, NaiveDate};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{CoreError, CoreResult};
use crate::models::{AgendaItem, NoteSummary, Task, TaskQuery};

/// The assembled weekly-review digest. `range_start`/`range_end` are the
/// *inclusive* local dates of the window (for display); `markdown` is the
/// ready-to-insert section rendered from the buckets.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDigest {
    /// Inclusive window start, local date `YYYY-MM-DD`.
    pub range_start: String,
    /// Inclusive window end, local date `YYYY-MM-DD`.
    pub range_end: String,
    /// Tasks completed with an effective date in the window (see module docs).
    pub completed: Vec<Task>,
    /// Open tasks whose `@due` is before the window start (slipped).
    pub overdue: Vec<Task>,
    /// Open tasks whose `@due` is within the window.
    pub due_this_week: Vec<Task>,
    /// Notes whose `modified` instant falls within the window.
    pub notes_touched: Vec<NoteSummary>,
    /// Scheduled tasks + calendar events over the window.
    pub agenda: Vec<AgendaItem>,
    /// Canonical markdown section, ready to insert into a note.
    pub markdown: String,
}

/// Parse an offset-carrying RFC 3339 window bound.
fn parse_bound(s: &str) -> CoreResult<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(s.trim())
        .map_err(|e| CoreError::BadRequest(format!("invalid review range bound '{s}': {e}")))
}

/// Parse an optional `YYYY-MM-DD` task date, ignoring anything malformed.
fn parse_date(s: &Option<String>) -> Option<NaiveDate> {
    s.as_deref()
        .and_then(|d| NaiveDate::parse_from_str(d.trim(), "%Y-%m-%d").ok())
}

/// Assemble the deterministic review digest for `[range_start, range_end)`,
/// where the bounds are offset-carrying RFC 3339 instants (see module docs).
pub fn review_digest(
    db: &Connection,
    range_start: &str,
    range_end: &str,
) -> CoreResult<ReviewDigest> {
    let lo = parse_bound(range_start)?;
    let hi = parse_bound(range_end)?;
    if hi <= lo {
        return Err(CoreError::BadRequest(
            "review range end must be after its start".into(),
        ));
    }

    // Local calendar-date bounds for the date-keyed buckets. `hi` is exclusive,
    // so the last *included* local date is the date of the instant one tick
    // before it — robust whether or not `hi` sits exactly on local midnight.
    let date_lo = lo.date_naive();
    let date_hi = (hi - Duration::nanoseconds(1)).date_naive();

    // One pass over every task, split into the three buckets.
    let mut completed = Vec::new();
    let mut overdue = Vec::new();
    let mut due_this_week = Vec::new();
    for t in crate::tasks::index::query_tasks(db, &TaskQuery::default())? {
        let due = parse_date(&t.due_date);
        if t.completed {
            // Effective date = due, else start; undated completed tasks can't be
            // placed in a week (no completion timestamp exists) and are dropped.
            if let Some(d) = due.or_else(|| parse_date(&t.start_date)) {
                if d >= date_lo && d <= date_hi {
                    completed.push(t);
                }
            }
        } else if let Some(d) = due {
            if d < date_lo {
                overdue.push(t);
            } else if d <= date_hi {
                due_this_week.push(t);
            }
            // `d > date_hi` → scheduled beyond the window; not part of the review.
        }
    }

    // Notes: instant-precise bucketing (the timezone-safe half). A note whose
    // `modified` is empty or not RFC 3339 (hand-authored) can't be dated → skip.
    let mut notes_touched: Vec<NoteSummary> = crate::index::list_summaries(db)?
        .into_iter()
        .filter(|s| {
            DateTime::parse_from_rfc3339(s.modified.trim())
                .map(|m| m >= lo && m < hi)
                .unwrap_or(false)
        })
        .collect();
    notes_touched.sort_by(|a, b| b.modified.cmp(&a.modified));

    // Agenda over the window's local dates (get_agenda compares YYYY-MM-DD
    // strings inclusively on both ends).
    let agenda = crate::calendar::get_agenda(db, &date_lo.to_string(), &date_hi.to_string())?;

    let mut digest = ReviewDigest {
        range_start: date_lo.to_string(),
        range_end: date_hi.to_string(),
        completed,
        overdue,
        due_this_week,
        notes_touched,
        agenda,
        markdown: String::new(),
    };
    digest.markdown = render_markdown(&digest);
    Ok(digest)
}

/// A task's summary bullet. Rendered as a *plain* list item (never a `- [ ]`
/// checkbox) so the inserted digest is a read-only summary and never re-indexes
/// as a fresh duplicate task. The stored `text` already carries its `@`
/// annotations, which stay for context.
fn task_bullet(t: &Task) -> String {
    let text = t.text.trim();
    if t.note_title.trim().is_empty() {
        format!("- {text}")
    } else {
        format!("- {text} — {}", t.note_title.trim())
    }
}

/// Render the canonical `## Weekly Review (…)` markdown section from a digest.
/// Empty buckets are omitted; a fully empty window renders a single note line.
/// Structural headings are English by design, matching the app's other
/// machine-inserted markdown (e.g. Bet 4's hardcoded `## Actions`).
pub fn render_markdown(d: &ReviewDigest) -> String {
    let mut out = format!("## Weekly Review ({} – {})\n", d.range_start, d.range_end);
    let mut any = false;

    let mut task_section = |title: &str, tasks: &[Task]| {
        if tasks.is_empty() {
            return;
        }
        any = true;
        out.push_str(&format!("\n### {title} ({})\n", tasks.len()));
        for t in tasks {
            out.push_str(&task_bullet(t));
            out.push('\n');
        }
    };
    task_section("Completed", &d.completed);
    task_section("Overdue", &d.overdue);
    task_section("Due this week", &d.due_this_week);

    if !d.notes_touched.is_empty() {
        any = true;
        out.push_str(&format!("\n### Notes edited ({})\n", d.notes_touched.len()));
        for n in &d.notes_touched {
            let title = if n.title.trim().is_empty() {
                n.path.as_str()
            } else {
                n.title.trim()
            };
            out.push_str(&format!("- [[{title}]]\n"));
        }
    }

    if !d.agenda.is_empty() {
        any = true;
        out.push_str(&format!("\n### Agenda ({})\n", d.agenda.len()));
        for a in &d.agenda {
            out.push_str(&format!("- {} · {}\n", a.start, a.title.trim()));
        }
    }

    if !any {
        out.push_str("\n_No activity in this period._\n");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::schema;

    fn ctx() -> (std::path::PathBuf, Connection) {
        let base = std::env::temp_dir().join(format!("novalis-review-{}", uuid::Uuid::new_v4()));
        let vault = base.join("vault");
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::create_dir_all(base.join("data/db")).unwrap();
        let db = schema::open_db(&base.join("data/db/notes.db")).unwrap();
        (vault, db)
    }

    fn write_and_index(vault: &std::path::Path, db: &Connection, rel: &str, content: &str) {
        let abs = vault.join(rel);
        if let Some(p) = abs.parent() {
            std::fs::create_dir_all(p).unwrap();
        }
        std::fs::write(&abs, content).unwrap();
        crate::change::reindex_path(db, vault, rel).unwrap();
    }

    // A Central-European week: Mon 2026-06-29 .. Sun 2026-07-05 inclusive.
    // Exclusive end = next Monday local midnight.
    const LO: &str = "2026-06-29T00:00:00+02:00";
    const HI: &str = "2026-07-06T00:00:00+02:00";

    #[test]
    fn task_buckets_split_at_the_inclusive_date_boundaries() {
        let (vault, db) = ctx();
        // Tasks live in a note with NO `modified` frontmatter so they don't also
        // land in the notes-touched bucket and confuse this test.
        write_and_index(
            &vault,
            &db,
            "Tasks.md",
            concat!(
                "- [ ] Slipped @due(2026-06-28)\n", // before window → overdue
                "- [ ] Starts Monday @due(2026-06-29)\n", // window start → due_this_week
                "- [ ] Ends Sunday @due(2026-07-05)\n", // window end   → due_this_week
                "- [ ] Next week @due(2026-07-06)\n", // after window → dropped
                "- [x] Shipped it @due(2026-07-01)\n", // in window    → completed
                "- [x] Old win @due(2026-06-20)\n", // before window→ not completed-this-week
                "- [ ] Someday\n",                  // no due date  → dropped
            ),
        );

        let d = review_digest(&db, LO, HI).unwrap();
        assert_eq!(d.range_start, "2026-06-29");
        assert_eq!(d.range_end, "2026-07-05");

        let texts = |v: &[Task]| v.iter().map(|t| t.text.clone()).collect::<Vec<_>>();
        assert!(texts(&d.overdue).iter().any(|t| t.starts_with("Slipped")));
        assert_eq!(d.overdue.len(), 1);

        let due: Vec<String> = texts(&d.due_this_week);
        assert!(due.iter().any(|t| t.starts_with("Starts Monday")));
        assert!(due.iter().any(|t| t.starts_with("Ends Sunday")));
        assert!(!due.iter().any(|t| t.starts_with("Next week")));
        assert_eq!(d.due_this_week.len(), 2);

        let done = texts(&d.completed);
        assert!(done.iter().any(|t| t.starts_with("Shipped it")));
        // The completed task dated before the window is NOT counted this week —
        // the documented no-completion-timestamp limitation.
        assert!(!done.iter().any(|t| t.starts_with("Old win")));
        assert_eq!(d.completed.len(), 1);
    }

    #[test]
    fn notes_touched_uses_instant_comparison_not_utc_date_slicing() {
        let (vault, db) = ctx();
        // `modified` just before window start in UTC, but INSIDE it locally.
        // 2026-06-28T23:00Z == 2026-06-29T01:00+02:00 (Monday, in window).
        // A naive `modified[..10]` == "2026-06-28" would wrongly exclude it.
        write_and_index(
            &vault,
            &db,
            "EarlyLocal.md",
            "---\ntitle: Early Local\nmodified: \"2026-06-28T23:00:00Z\"\n---\n\nbody\n",
        );
        // `modified` inside window in UTC but AFTER it locally (next day):
        // 2026-07-05T23:00Z == 2026-07-06T01:00+02:00 (past the exclusive end).
        // A naive slice "2026-07-05" <= end would wrongly include it.
        write_and_index(
            &vault,
            &db,
            "LateLocal.md",
            "---\ntitle: Late Local\nmodified: \"2026-07-05T23:00:00Z\"\n---\n\nbody\n",
        );
        // Plainly inside the window.
        write_and_index(
            &vault,
            &db,
            "MidWeek.md",
            "---\ntitle: Mid Week\nmodified: \"2026-07-01T12:00:00+02:00\"\n---\n\nbody\n",
        );

        let d = review_digest(&db, LO, HI).unwrap();
        let titles: Vec<&str> = d.notes_touched.iter().map(|n| n.title.as_str()).collect();
        assert!(
            titles.contains(&"Early Local"),
            "note inside window locally but before it in UTC must be included: {titles:?}"
        );
        assert!(
            titles.contains(&"Mid Week"),
            "mid-week note must be included: {titles:?}"
        );
        assert!(
            !titles.contains(&"Late Local"),
            "note past the exclusive end (local next day) must be excluded: {titles:?}"
        );
    }

    #[test]
    fn end_bound_is_exclusive() {
        let (vault, db) = ctx();
        // A note modified EXACTLY at the exclusive end instant must be excluded.
        write_and_index(
            &vault,
            &db,
            "OnTheBoundary.md",
            "---\ntitle: On Boundary\nmodified: \"2026-07-06T00:00:00+02:00\"\n---\n\nbody\n",
        );
        // A note modified EXACTLY at the inclusive start instant must be included.
        write_and_index(
            &vault,
            &db,
            "AtStart.md",
            "---\ntitle: At Start\nmodified: \"2026-06-29T00:00:00+02:00\"\n---\n\nbody\n",
        );

        let d = review_digest(&db, LO, HI).unwrap();
        let titles: Vec<&str> = d.notes_touched.iter().map(|n| n.title.as_str()).collect();
        assert!(
            titles.contains(&"At Start"),
            "start is inclusive: {titles:?}"
        );
        assert!(
            !titles.contains(&"On Boundary"),
            "end is exclusive: {titles:?}"
        );
    }

    #[test]
    fn agenda_includes_events_in_window() {
        let (vault, db) = ctx();
        crate::calendar::create_event(
            &db,
            &vault,
            crate::models::EventInput {
                title: "Sprint review".into(),
                date: "2026-07-02".into(),
                all_day: false,
                start_time: Some("14:00".into()),
                end_time: Some("15:00".into()),
                rrule: None,
                location: None,
                note_path: None,
            },
        )
        .unwrap();

        let d = review_digest(&db, LO, HI).unwrap();
        assert!(
            d.agenda.iter().any(|a| a.title == "Sprint review"),
            "in-window event must appear in the agenda"
        );
    }

    #[test]
    fn render_markdown_titles_omits_empty_and_never_emits_checkboxes() {
        let d = ReviewDigest {
            range_start: "2026-06-29".into(),
            range_end: "2026-07-05".into(),
            completed: vec![Task {
                id: "1".into(),
                text: "Shipped it @due(2026-07-01)".into(),
                completed: true,
                priority: None,
                due_date: Some("2026-07-01".into()),
                start_date: None,
                remind: None,
                status: None,
                source_note: "Tasks.md".into(),
                source_line: 1,
                tags: vec![],
                repeat: None,
                parent_id: None,
                note_title: "Tasks".into(),
                heading: None,
                project: None,
                epic: None,
            }],
            overdue: vec![],
            due_this_week: vec![],
            notes_touched: vec![],
            agenda: vec![],
            markdown: String::new(),
        };
        let md = render_markdown(&d);
        assert!(md.starts_with("## Weekly Review (2026-06-29 – 2026-07-05)"));
        assert!(md.contains("### Completed (1)"));
        assert!(md.contains("- Shipped it @due(2026-07-01) — Tasks"));
        // A summary bullet must NOT be a task checkbox (would re-index as a dupe).
        assert!(!md.contains("- [ ]") && !md.contains("- [x]"));
        // Empty buckets are omitted.
        assert!(!md.contains("### Overdue"));
        assert!(!md.contains("### Agenda"));
    }

    #[test]
    fn empty_window_renders_a_no_activity_note() {
        let (vault, db) = ctx();
        let _ = vault; // no data written
        let d = review_digest(&db, LO, HI).unwrap();
        assert!(d.markdown.contains("_No activity in this period._"));
    }

    #[test]
    fn rejects_inverted_and_malformed_bounds() {
        let (_vault, db) = ctx();
        assert!(review_digest(&db, HI, LO).is_err(), "end before start");
        assert!(review_digest(&db, "not-a-date", HI).is_err());
        assert!(
            review_digest(&db, LO, "2026-07-06").is_err(),
            "missing offset"
        );
    }
}
