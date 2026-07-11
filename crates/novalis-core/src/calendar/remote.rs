//! Pure mappers from provider event JSON (Google Calendar, Microsoft Graph)
//! into [`CalendarEvent`]. The shell fetches the JSON (server-side expands
//! recurrences over the query window), so cached remote events are concrete
//! occurrences with no RRULE.

use serde_json::Value;

use crate::models::CalendarEvent;

/// Collect attendee display names from a provider event's `attendees` array,
/// via `pick` (which maps one attendee object to a name). Skips empties.
fn attendees_from(it: &Value, pick: impl Fn(&Value) -> Option<String>) -> Vec<String> {
    it.get("attendees")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(&pick)
                .filter(|s| !s.trim().is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Normalize a provider datetime to our format: `YYYY-MM-DDTHH:MM` (timed) or
/// `YYYY-MM-DD` (date-only). Drops any timezone offset / sub-second part.
fn norm_dt(s: &str) -> String {
    if s.len() >= 16 && s.as_bytes().get(10) == Some(&b'T') {
        s[..16].to_string()
    } else {
        s.get(..10).unwrap_or(s).to_string()
    }
}

/// Parse a Google Calendar `events.list` response (`{ items: [...] }`).
/// Fetched with `singleEvents=true`, so items are concrete occurrences.
pub fn parse_google_events(json: &Value, source_id: &str) -> Vec<CalendarEvent> {
    let mut out = Vec::new();
    let Some(items) = json.get("items").and_then(|v| v.as_array()) else {
        return out;
    };
    for it in items {
        let Some(id) = it
            .get("id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let start_obj = it.get("start");
        let (start, all_day) = match start_obj {
            Some(s) if s.get("dateTime").and_then(|v| v.as_str()).is_some() => {
                (norm_dt(s["dateTime"].as_str().unwrap()), false)
            }
            Some(s) if s.get("date").and_then(|v| v.as_str()).is_some() => {
                (s["date"].as_str().unwrap().to_string(), true)
            }
            _ => continue,
        };
        let end = it.get("end").and_then(|e| {
            e.get("dateTime")
                .and_then(|v| v.as_str())
                .map(norm_dt)
                .or_else(|| e.get("date").and_then(|v| v.as_str()).map(String::from))
        });
        // Prefer the human `displayName`, fall back to the email address.
        let attendees = attendees_from(it, |a| {
            a.get("displayName")
                .and_then(|v| v.as_str())
                .or_else(|| a.get("email").and_then(|v| v.as_str()))
                .map(String::from)
        });
        out.push(CalendarEvent {
            id: format!("{source_id}:{id}"),
            source_id: source_id.to_string(),
            title: it
                .get("summary")
                .and_then(|v| v.as_str())
                .unwrap_or("(no title)")
                .to_string(),
            start,
            end,
            all_day,
            rrule: None,
            location: it
                .get("location")
                .and_then(|v| v.as_str())
                .map(String::from),
            note_path: None,
            attendees,
        });
    }
    out
}

/// Parse a Microsoft Graph `calendarView` response (`{ value: [...] }`).
/// `calendarView` expands recurrences server-side over the window.
pub fn parse_ms_events(json: &Value, source_id: &str) -> Vec<CalendarEvent> {
    let mut out = Vec::new();
    let Some(items) = json.get("value").and_then(|v| v.as_array()) else {
        return out;
    };
    for it in items {
        let Some(id) = it
            .get("id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let all_day = it
            .get("isAllDay")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let Some(start_raw) = it
            .get("start")
            .and_then(|s| s.get("dateTime"))
            .and_then(|v| v.as_str())
        else {
            continue;
        };
        let start = if all_day {
            start_raw.get(..10).unwrap_or(start_raw).to_string()
        } else {
            norm_dt(start_raw)
        };
        let end = it
            .get("end")
            .and_then(|e| e.get("dateTime"))
            .and_then(|v| v.as_str())
            .map(|s| {
                if all_day {
                    s.get(..10).unwrap_or(s).to_string()
                } else {
                    norm_dt(s)
                }
            });

        // MS Graph nests the name/email under `emailAddress`.
        let attendees = attendees_from(it, |a| {
            let email = a.get("emailAddress");
            email
                .and_then(|e| e.get("name"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .or_else(|| {
                    email
                        .and_then(|e| e.get("address"))
                        .and_then(|v| v.as_str())
                })
                .map(String::from)
        });
        out.push(CalendarEvent {
            id: format!("{source_id}:{id}"),
            source_id: source_id.to_string(),
            title: it
                .get("subject")
                .and_then(|v| v.as_str())
                .unwrap_or("(no title)")
                .to_string(),
            start,
            end,
            all_day,
            rrule: None,
            location: it
                .get("location")
                .and_then(|l| l.get("displayName"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(String::from),
            note_path: None,
            attendees,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_google_timed_and_all_day() {
        let json = serde_json::json!({
            "items": [
                { "id": "a", "summary": "Standup",
                  "start": { "dateTime": "2026-06-02T09:00:00+02:00" },
                  "end": { "dateTime": "2026-06-02T09:15:00+02:00" },
                  "attendees": [
                      { "displayName": "Ada Lovelace", "email": "ada@example.com" },
                      { "email": "grace@example.com" },
                      { "displayName": "", "email": "" }
                  ] },
                { "id": "b", "summary": "Holiday",
                  "start": { "date": "2026-07-04" }, "end": { "date": "2026-07-05" } }
            ]
        });
        let events = parse_google_events(&json, "google");
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].id, "google:a");
        assert_eq!(events[0].start, "2026-06-02T09:00");
        assert!(!events[0].all_day);
        // Display name preferred, email fallback, empties dropped.
        assert_eq!(
            events[0].attendees,
            vec!["Ada Lovelace", "grace@example.com"]
        );
        assert_eq!(events[1].start, "2026-07-04");
        assert!(events[1].all_day);
        assert!(events[1].attendees.is_empty());
    }

    #[test]
    fn maps_ms_graph_event() {
        let json = serde_json::json!({
            "value": [
                { "id": "x", "subject": "Review", "isAllDay": false,
                  "start": { "dateTime": "2026-06-02T14:00:00.0000000", "timeZone": "UTC" },
                  "end": { "dateTime": "2026-06-02T15:00:00.0000000", "timeZone": "UTC" },
                  "location": { "displayName": "Room 4" },
                  "attendees": [
                      { "type": "required",
                        "emailAddress": { "name": "Grace Hopper", "address": "grace@example.com" } },
                      { "type": "optional",
                        "emailAddress": { "address": "alan@example.com" } }
                  ] }
            ]
        });
        let events = parse_ms_events(&json, "outlook");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].start, "2026-06-02T14:00");
        assert_eq!(events[0].location.as_deref(), Some("Room 4"));
        assert_eq!(events[0].id, "outlook:x");
        // Name preferred, address fallback.
        assert_eq!(
            events[0].attendees,
            vec!["Grace Hopper", "alan@example.com"]
        );
    }
}
