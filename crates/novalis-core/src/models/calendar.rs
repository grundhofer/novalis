use serde::{Deserialize, Serialize};
use specta::Type;

/// A calendar event — either an own event (backed by a markdown note in the
/// vault) or a cached event from a remote source. Times are strings:
/// `YYYY-MM-DD` for all-day, or `YYYY-MM-DDTHH:MM` for timed.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    /// `"local"` for vault events, otherwise the calendar source id.
    pub source_id: String,
    pub title: String,
    pub start: String,
    pub end: Option<String>,
    pub all_day: bool,
    /// RFC 5545 RRULE string (without the `RRULE:` prefix), if recurring.
    pub rrule: Option<String>,
    pub location: Option<String>,
    /// Vault-relative note path for own events.
    pub note_path: Option<String>,
}

/// Request to create/update an own event (written to a markdown note).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EventInput {
    pub title: String,
    /// `YYYY-MM-DD`.
    pub date: String,
    pub all_day: bool,
    /// `HH:MM` when not all-day.
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub rrule: Option<String>,
    pub location: Option<String>,
    /// Existing note path when updating; `None` to create a new event note.
    pub note_path: Option<String>,
}

/// A configured calendar source (subscription). `kind` is `"icsUrl"`,
/// `"google"`, or `"outlook"`. Remote events are cached locally under its id.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CalendarSourceConfig {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub url: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

/// A unified agenda entry merging tasks and calendar events.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgendaItem {
    /// `"task"` or `"event"`.
    pub kind: String,
    pub title: String,
    /// `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`.
    pub start: String,
    pub all_day: bool,
    pub source: String,
    /// Task id or event id.
    pub ref_id: String,
    /// Source note path, if any.
    pub note_path: Option<String>,
}
