//! Calendar events index. Own events are parsed from note frontmatter
//! (`type: event`); remote events are cached here too. Recurring events are
//! expanded over a query window via the `rrule` crate.

use chrono::TimeZone;
use rusqlite::{params, Connection};

use crate::error::CoreResult;
use crate::models::CalendarEvent;

/// Build a [`CalendarEvent`] from a note's frontmatter `extra`, if it declares
/// `type: event`.
pub fn event_from_note(
    extra: &serde_json::Value,
    title: &str,
    note_path: &str,
) -> Option<CalendarEvent> {
    if extra.get("type").and_then(|v| v.as_str()) != Some("event") {
        return None;
    }
    let get = |k: &str| extra.get(k).and_then(|v| v.as_str());
    let all_day = extra
        .get("allDay")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let base = get("date").or_else(|| get("startDate"))?;

    let start = match (all_day, get("startTime")) {
        (false, Some(t)) => format!("{base}T{t}"),
        _ => base.to_string(),
    };
    let end = match (all_day, get("endTime"), get("endDate")) {
        (false, Some(t), _) => Some(format!("{base}T{t}")),
        (_, _, Some(d)) => Some(d.to_string()),
        _ => None,
    };

    Some(CalendarEvent {
        id: format!("local:{note_path}"),
        source_id: "local".to_string(),
        title: title.to_string(),
        start,
        end,
        all_day,
        rrule: get("rrule").map(String::from),
        location: get("location").map(String::from),
        note_path: Some(note_path.to_string()),
    })
}

/// Replace the indexed event for a note (own events: at most one per note).
pub fn index_event(
    db: &Connection,
    event: Option<&CalendarEvent>,
    note_path: &str,
) -> CoreResult<()> {
    db.execute(
        "DELETE FROM events WHERE note_path = ?1",
        params![note_path],
    )?;
    if let Some(e) = event {
        upsert(db, e)?;
    }
    Ok(())
}

/// Insert or replace a single event by id (used for cached remote events).
pub fn upsert(db: &Connection, e: &CalendarEvent) -> CoreResult<()> {
    db.execute(
        "INSERT INTO events (id, source_id, title, start, end_at, all_day, rrule, location, note_path)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
            source_id=excluded.source_id, title=excluded.title, start=excluded.start,
            end_at=excluded.end_at, all_day=excluded.all_day, rrule=excluded.rrule,
            location=excluded.location, note_path=excluded.note_path",
        params![
            e.id,
            e.source_id,
            e.title,
            e.start,
            e.end,
            e.all_day as i32,
            e.rrule,
            e.location,
            e.note_path,
        ],
    )?;
    Ok(())
}

/// Remove all cached events for a source (used when refreshing remote sources).
pub fn clear_source(db: &Connection, source_id: &str) -> CoreResult<()> {
    db.execute(
        "DELETE FROM events WHERE source_id = ?1",
        params![source_id],
    )?;
    Ok(())
}

fn row_to_event(row: &rusqlite::Row) -> rusqlite::Result<CalendarEvent> {
    Ok(CalendarEvent {
        id: row.get(0)?,
        source_id: row.get(1)?,
        title: row.get(2)?,
        start: row.get(3)?,
        end: row.get(4)?,
        all_day: row.get::<_, i32>(5)? != 0,
        rrule: row.get(6)?,
        location: row.get(7)?,
        note_path: row.get(8)?,
    })
}

/// All stored base events (recurring events stored once, un-expanded).
pub fn all_events(db: &Connection) -> CoreResult<Vec<CalendarEvent>> {
    let mut stmt = db.prepare(
        "SELECT id, source_id, title, start, end_at, all_day, rrule, location, note_path FROM events",
    )?;
    let events = stmt
        .query_map([], row_to_event)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(events)
}

/// Events occurring within `[range_start, range_end]` (inclusive, `YYYY-MM-DD`),
/// with recurring events expanded into individual occurrences, sorted by start.
pub fn query_events(
    db: &Connection,
    range_start: &str,
    range_end: &str,
) -> CoreResult<Vec<CalendarEvent>> {
    let mut out = Vec::new();
    for event in all_events(db)? {
        out.extend(expand(&event, range_start, range_end));
    }
    out.sort_by(|a, b| a.start.cmp(&b.start));
    Ok(out)
}

fn date_part(s: &str) -> &str {
    s.get(..10).unwrap_or(s)
}

/// Expand an event into the occurrences that fall within the range.
fn expand(event: &CalendarEvent, range_start: &str, range_end: &str) -> Vec<CalendarEvent> {
    let Some(rrule) = event.rrule.as_deref() else {
        let d = date_part(&event.start);
        return if d >= range_start && d <= range_end {
            vec![event.clone()]
        } else {
            Vec::new()
        };
    };

    let Some(dtstart) = ical_dtstart(&event.start, event.all_day) else {
        return Vec::new();
    };
    let set: rrule::RRuleSet = match format!("DTSTART:{dtstart}\nRRULE:{rrule}").parse() {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let (Some(after), Some(before)) = (bound(range_start, false), bound(range_end, true)) else {
        return Vec::new();
    };

    set.after(after)
        .before(before)
        .all(366)
        .dates
        .iter()
        .map(|dt| {
            let mut inst = event.clone();
            inst.start = if event.all_day {
                dt.format("%Y-%m-%d").to_string()
            } else {
                dt.format("%Y-%m-%dT%H:%M").to_string()
            };
            inst.id = format!("{}@{}", event.id, dt.format("%Y%m%d"));
            inst.rrule = None;
            inst
        })
        .collect()
}

fn parse_ymd(s: &str) -> Option<(i32, u32, u32)> {
    let mut it = s.get(..10)?.split('-');
    let y = it.next()?.parse().ok()?;
    let m = it.next()?.parse().ok()?;
    let d = it.next()?.parse().ok()?;
    Some((y, m, d))
}

fn bound(date: &str, end_of_day: bool) -> Option<chrono::DateTime<rrule::Tz>> {
    let (y, m, d) = parse_ymd(date)?;
    let (hh, mm, ss) = if end_of_day { (23, 59, 59) } else { (0, 0, 0) };
    rrule::Tz::UTC
        .with_ymd_and_hms(y, m, d, hh, mm, ss)
        .single()
}

/// Build an iCal UTC DTSTART (`YYYYMMDDTHHMMSSZ`) from our start string. Times
/// are treated as UTC for recurrence expansion (timezone handling is a later
/// refinement).
fn ical_dtstart(start: &str, all_day: bool) -> Option<String> {
    let (y, m, d) = parse_ymd(start)?;
    let (hh, mm) = if !all_day && start.len() >= 16 {
        let mut t = start[11..16].split(':');
        (
            t.next()?.parse::<u32>().ok()?,
            t.next()?.parse::<u32>().ok()?,
        )
    } else {
        (0, 0)
    };
    Some(format!("{y:04}{m:02}{d:02}T{hh:02}{mm:02}00Z"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::schema;

    fn db() -> Connection {
        let dir = std::env::temp_dir().join(format!("novalis-ev-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        schema::open_db(&dir.join("notes.db")).unwrap()
    }

    #[test]
    fn parses_timed_event_frontmatter() {
        let fm = serde_json::json!({
            "type": "event", "date": "2026-06-02", "startTime": "14:00", "endTime": "15:00"
        });
        let e = event_from_note(&fm, "Sprint review", "Events/sprint.md").unwrap();
        assert_eq!(e.start, "2026-06-02T14:00");
        assert_eq!(e.end.as_deref(), Some("2026-06-02T15:00"));
        assert!(!e.all_day);
    }

    #[test]
    fn ignores_non_event_notes() {
        let fm = serde_json::json!({ "title": "x" });
        assert!(event_from_note(&fm, "x", "x.md").is_none());
    }

    #[test]
    fn weekly_recurrence_expands_within_window() {
        let conn = db();
        upsert(
            &conn,
            &CalendarEvent {
                id: "local:standup.md".into(),
                source_id: "local".into(),
                title: "Standup".into(),
                start: "2026-06-01T09:00".into(),
                end: None,
                all_day: false,
                rrule: Some("FREQ=WEEKLY;BYDAY=MO".into()),
                location: None,
                note_path: Some("standup.md".into()),
            },
        )
        .unwrap();

        // June 2026: Mondays are 1, 8, 15, 22, 29.
        let hits = query_events(&conn, "2026-06-01", "2026-06-30").unwrap();
        assert_eq!(hits.len(), 5);
        assert_eq!(hits[0].start, "2026-06-01T09:00");
        assert!(hits.iter().all(|h| h.rrule.is_none()));
    }

    #[test]
    fn non_recurring_event_filtered_by_range() {
        let conn = db();
        upsert(
            &conn,
            &CalendarEvent {
                id: "local:once.md".into(),
                source_id: "local".into(),
                title: "Once".into(),
                start: "2026-07-04".into(),
                end: None,
                all_day: true,
                rrule: None,
                location: None,
                note_path: Some("once.md".into()),
            },
        )
        .unwrap();
        assert_eq!(
            query_events(&conn, "2026-07-01", "2026-07-31")
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            query_events(&conn, "2026-06-01", "2026-06-30")
                .unwrap()
                .len(),
            0
        );
    }
}
