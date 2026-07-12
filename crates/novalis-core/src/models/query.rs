use serde::{Deserialize, Serialize};
use specta::Type;

use crate::models::{NotePropertyEntry, Task};

/// Which result view the query engine suggests (or the query explicitly asked
/// for). The frontend can override, but this is the sensible default: a query
/// touching tasks defaults to `Kanban`, one whose notes carry dates can offer
/// `Calendar`, everything else renders as a `Table`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum QueryViewKind {
    Table,
    Kanban,
    Calendar,
}

/// One matched note in a query result. Carries the metadata a table view needs
/// plus the typed frontmatter properties (so property columns render without a
/// second round-trip) and a best-guess `date` for calendar placement.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct QueryNoteRow {
    pub path: String,
    pub title: String,
    pub folder: String,
    pub modified: String,
    pub created: String,
    pub tags: Vec<String>,
    /// Typed frontmatter properties, in stored order — the extra table columns.
    pub properties: Vec<NotePropertyEntry>,
    /// The note's date for the calendar view (`date`/`due`/`start` frontmatter,
    /// whichever resolves first), or `None` when the note isn't dated.
    pub date: Option<String>,
}

/// The result of running a query: matched notes, the tasks belonging to those
/// notes (populated only when the query touches tasks), the suggested view, and
/// the union of property keys present across the rows (the table's dynamic
/// columns, in first-seen order).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub notes: Vec<QueryNoteRow>,
    pub tasks: Vec<Task>,
    pub view: QueryViewKind,
    pub property_keys: Vec<String>,
    /// True when at least one matched note is dated — lets the UI offer the
    /// calendar view even for a query that didn't explicitly request it.
    pub has_dates: bool,
}

/// A user-named saved query, persisted as a preference (JSON), never a DB row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedQuery {
    pub name: String,
    /// The raw DSL string, re-parsed on run (the source of truth, not the AST).
    pub query: String,
}
