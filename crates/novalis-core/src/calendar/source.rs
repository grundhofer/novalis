//! Calendar sources: subscriptions to external calendars. The config (ICS-URL
//! subscriptions, connected accounts) is stored per-vault in
//! `.novalis/calendar.json`; remote events are cached in the index under the
//! source id. ICS bytes are fetched by the shell (network stays out of core);
//! core parses/builds the iCalendar payloads.

use std::path::{Path, PathBuf};

use icalendar::Component;

use crate::error::{CoreError, CoreResult};
use crate::models::{CalendarEvent, CalendarSourceConfig};

const SOURCES_FILE: &str = "calendar.json";

fn sources_path(vault: &Path) -> PathBuf {
    vault
        .join(crate::vault::config::CONFIG_DIR)
        .join(SOURCES_FILE)
}

/// Configured calendar sources for the vault.
pub fn list_sources(vault: &Path) -> Vec<CalendarSourceConfig> {
    match std::fs::read_to_string(sources_path(vault)) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn write_sources(vault: &Path, sources: &[CalendarSourceConfig]) -> CoreResult<()> {
    let path = sources_path(vault);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json =
        serde_json::to_string_pretty(sources).map_err(|e| CoreError::Serde(e.to_string()))?;
    std::fs::write(path, json)?;
    Ok(())
}

/// Add (or replace, by id) a calendar source.
pub fn add_source(vault: &Path, cfg: CalendarSourceConfig) -> CoreResult<()> {
    let mut sources = list_sources(vault);
    sources.retain(|s| s.id != cfg.id);
    sources.push(cfg);
    write_sources(vault, &sources)
}

/// Remove a calendar source by id.
pub fn remove_source(vault: &Path, id: &str) -> CoreResult<()> {
    let mut sources = list_sources(vault);
    sources.retain(|s| s.id != id);
    write_sources(vault, &sources)
}

/// Parse iCalendar bytes into events tagged with `source_id`.
pub fn import_ics(bytes: &[u8], source_id: &str) -> CoreResult<Vec<CalendarEvent>> {
    let text = String::from_utf8_lossy(bytes);
    let calendar: icalendar::Calendar = text
        .parse()
        .map_err(|_| CoreError::BadRequest("Invalid .ics data".to_string()))?;

    let mut out = Vec::new();
    for component in &calendar.components {
        let icalendar::CalendarComponent::Event(ev) = component else {
            continue;
        };
        let Some(dtstart) = ev.property_value("DTSTART") else {
            continue;
        };
        let (start, all_day) = parse_ical_dt(dtstart);
        let title = ev
            .property_value("SUMMARY")
            .unwrap_or("Untitled")
            .to_string();
        let end = ev.property_value("DTEND").map(|d| parse_ical_dt(d).0);
        let rrule = ev.property_value("RRULE").map(String::from);
        let location = ev.property_value("LOCATION").map(String::from);
        let uid = ev.property_value("UID").unwrap_or(&start).to_string();

        out.push(CalendarEvent {
            id: format!("{source_id}:{uid}"),
            source_id: source_id.to_string(),
            title,
            start,
            end,
            all_day,
            rrule,
            location,
            note_path: None,
        });
    }
    Ok(out)
}

/// Serialize events to an iCalendar (`.ics`) document.
pub fn export_ics(events: &[CalendarEvent]) -> String {
    let mut s =
        String::from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Novalis//Calendar//EN\r\n");
    for e in events {
        s.push_str("BEGIN:VEVENT\r\n");
        s.push_str(&format!("UID:{}\r\n", e.id));
        s.push_str(&format!("SUMMARY:{}\r\n", escape(&e.title)));
        s.push_str(&format!("DTSTART{}\r\n", ics_dt(&e.start, e.all_day)));
        if let Some(end) = &e.end {
            s.push_str(&format!("DTEND{}\r\n", ics_dt(end, e.all_day)));
        }
        if let Some(r) = &e.rrule {
            s.push_str(&format!("RRULE:{r}\r\n"));
        }
        if let Some(l) = &e.location {
            s.push_str(&format!("LOCATION:{}\r\n", escape(l)));
        }
        s.push_str("END:VEVENT\r\n");
    }
    s.push_str("END:VCALENDAR\r\n");
    s
}

/// Parse an iCal datetime ("20260602", "20260602T140000Z", …) into our format
/// (`YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`) plus an all-day flag.
fn parse_ical_dt(raw: &str) -> (String, bool) {
    // Drop any "TZID=...:" prefix the property value may carry.
    let v = raw.rsplit(':').next().unwrap_or(raw).trim();
    let digits: String = v.chars().take_while(|c| *c != 'Z').collect();
    if digits.len() == 8 && digits.chars().all(|c| c.is_ascii_digit()) {
        (
            format!("{}-{}-{}", &digits[0..4], &digits[4..6], &digits[6..8]),
            true,
        )
    } else if digits.len() >= 13 && digits.as_bytes()[8] == b'T' {
        let date = format!("{}-{}-{}", &digits[0..4], &digits[4..6], &digits[6..8]);
        let time = format!("{}:{}", &digits[9..11], &digits[11..13]);
        (format!("{date}T{time}"), false)
    } else {
        (v.to_string(), false)
    }
}

fn ics_dt(s: &str, all_day: bool) -> String {
    let date = s.get(..10).unwrap_or(s).replace('-', "");
    if all_day || s.len() < 16 {
        format!(";VALUE=DATE:{date}")
    } else {
        let time = s[11..16].replace(':', "");
        format!(":{date}T{time}00")
    }
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace(',', "\\,")
        .replace(';', "\\;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ics_export_import_roundtrip() {
        let events = vec![CalendarEvent {
            id: "local:x.md".into(),
            source_id: "local".into(),
            title: "Launch".into(),
            start: "2026-06-02T14:00".into(),
            end: Some("2026-06-02T15:00".into()),
            all_day: false,
            rrule: None,
            location: Some("Room 4".into()),
            note_path: None,
        }];
        let ics = export_ics(&events);
        assert!(ics.contains("SUMMARY:Launch"));
        assert!(ics.contains("DTSTART:20260602T140000"));

        let parsed = import_ics(ics.as_bytes(), "sub1").unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].title, "Launch");
        assert_eq!(parsed[0].start, "2026-06-02T14:00");
        assert!(parsed[0].id.starts_with("sub1:"));
    }

    #[test]
    fn parses_all_day_date() {
        let (start, all_day) = parse_ical_dt("20260704");
        assert_eq!(start, "2026-07-04");
        assert!(all_day);
    }
}
