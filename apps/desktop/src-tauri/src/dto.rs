//! The IPC data shapes.
//!
//! Deliberately *not* the core types: `novalis_core` stays free of `specta`,
//! and the wire shape is allowed to differ from the core shape (usize becomes
//! u32, `Position` becomes a tagged enum, board and card are flattened into one
//! document). Every struct here is `camelCase` on the wire, which is what
//! `bindings.ts` and the UI stores expect.

use novalis_core::boards::{Board, BoardRef, Card, Column};
use novalis_core::search::{SearchHit, SearchQuery, SearchReport};
use novalis_core::settings::{Appearance, EditorSettings, Language, Settings};
use novalis_core::vault::cloud::VaultKind;
use novalis_core::vault::fs::{DirEntry, EntryKind, FileContent, FileStat, Precondition};
use serde::{Deserialize, Serialize};
use specta::Type;

/// Files at or above this size open without Markdown decorations or
/// highlighting (PLAN.md §4.2).
pub const PLAIN_MODE_BYTES: u64 = 5 * 1024 * 1024;
/// Files at or above this size additionally raise a warning banner.
pub const HUGE_FILE_BYTES: u64 = 50 * 1024 * 1024;

// ---------------------------------------------------------------- settings

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum LanguageDto {
    System,
    De,
    En,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum AppearanceDto {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EditorSettingsDto {
    pub font_size: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    pub version: u32,
    pub language: LanguageDto,
    pub appearance: AppearanceDto,
    pub editor: EditorSettingsDto,
    pub spellcheck: bool,
    pub last_vault: Option<String>,
}

/// A partial settings update. Absent fields stay as they are; there are only
/// the four settings of PLAN.md §4.1 plus the `lastVault` state key, which the
/// shell writes itself when a vault opens.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatchDto {
    pub language: Option<LanguageDto>,
    pub appearance: Option<AppearanceDto>,
    pub font_size: Option<u32>,
    pub spellcheck: Option<bool>,
}

impl From<&Settings> for SettingsDto {
    fn from(s: &Settings) -> Self {
        SettingsDto {
            version: s.version,
            language: match s.language {
                Language::System => LanguageDto::System,
                Language::De => LanguageDto::De,
                Language::En => LanguageDto::En,
            },
            appearance: match s.appearance {
                Appearance::System => AppearanceDto::System,
                Appearance::Light => AppearanceDto::Light,
                Appearance::Dark => AppearanceDto::Dark,
            },
            editor: EditorSettingsDto {
                font_size: s.editor.font_size,
            },
            spellcheck: s.spellcheck,
            last_vault: s.last_vault.clone(),
        }
    }
}

impl SettingsPatchDto {
    /// Apply the patch in place. Font size is clamped to a sane range: the
    /// only way to change it is `Cmd+=` / `Cmd+-` / `Cmd+0`, and a stored 0 or
    /// 400 would be unreadable with no preferences window to fix it in.
    pub fn apply(&self, settings: &mut Settings) {
        if let Some(language) = self.language {
            settings.language = match language {
                LanguageDto::System => Language::System,
                LanguageDto::De => Language::De,
                LanguageDto::En => Language::En,
            };
        }
        if let Some(appearance) = self.appearance {
            settings.appearance = match appearance {
                AppearanceDto::System => Appearance::System,
                AppearanceDto::Light => Appearance::Light,
                AppearanceDto::Dark => Appearance::Dark,
            };
        }
        if let Some(size) = self.font_size {
            settings.editor = EditorSettings {
                font_size: size.clamp(9, 32),
            };
        }
        if let Some(spellcheck) = self.spellcheck {
            settings.spellcheck = spellcheck;
        }
    }
}

// ---------------------------------------------------------------- window state

/// Everything that is persisted but is not a setting (PLAN.md §4.1): it lives
/// in `<app-data>/state.json`, is disposable, and never appears in
/// `docs/SETTINGS.md`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct UiStateDto {
    pub open_tabs: Vec<String>,
    pub active_tab: Option<String>,
    pub sidebar_visible: bool,
    pub sidebar_width: u32,
    pub board_visible: bool,
    pub active_board: Option<String>,
}

impl Default for UiStateDto {
    fn default() -> Self {
        UiStateDto {
            open_tabs: Vec::new(),
            active_tab: None,
            sidebar_visible: true,
            sidebar_width: 256,
            board_visible: false,
            active_board: None,
        }
    }
}

// ---------------------------------------------------------------- vault + tree

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum VaultKindDto {
    FileProvider,
    Mirrored,
    Local,
}

impl From<VaultKind> for VaultKindDto {
    fn from(kind: VaultKind) -> Self {
        match kind {
            VaultKind::FileProvider => VaultKindDto::FileProvider,
            VaultKind::Mirrored => VaultKindDto::Mirrored,
            VaultKind::Local => VaultKindDto::Local,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultDto {
    /// Absolute path, for the window title and the status bar only.
    pub root: String,
    /// Last path component, the name shown in the sidebar head.
    pub name: String,
    pub kind: VaultKindDto,
    pub boards: Vec<BoardRefDto>,
}

/// One tree row. `path` is vault-relative and NFC; the root itself is `""`.
///
/// `size` and `mtimeNs` are decimal strings, not numbers. A nanosecond
/// timestamp is ~1.7e18 and a JS `number` is exact only to 2^53, and
/// `specta-typescript` refuses to emit `u64`/`i64` at all. Strings round-trip
/// exactly, which is what the save precondition depends on; the UI converts
/// them once, for display.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EntryDto {
    pub path: String,
    pub name: String,
    pub dir: bool,
    pub size: String,
    pub mtime_ns: String,
    pub cloud_only: bool,
    /// Set when this directory holds a valid `board.json` (PLAN.md §5.5).
    pub board_slug: Option<String>,
}

impl EntryDto {
    pub fn from_dir_entry(folder: &str, entry: &DirEntry, board_slug: Option<String>) -> Self {
        let path = if folder.is_empty() {
            entry.name.clone()
        } else {
            format!("{folder}/{}", entry.name)
        };
        EntryDto {
            path,
            name: entry.name.clone(),
            dir: entry.kind == EntryKind::Dir,
            size: entry.size.to_string(),
            mtime_ns: entry.mtime_ns.to_string(),
            cloud_only: entry.cloud_only,
            board_slug,
        }
    }

    /// A row for a path the shell just created or re-stat'ed.
    pub fn from_stat(rel: String, stat: &FileStat, board_slug: Option<String>) -> Self {
        EntryDto {
            name: novalis_core::vault::path::file_name_of(&rel).to_string(),
            path: rel,
            dir: stat.kind == EntryKind::Dir,
            size: stat.size.to_string(),
            mtime_ns: stat.mtime_ns.to_string(),
            cloud_only: stat.cloud_only,
            board_slug,
        }
    }
}

// ---------------------------------------------------------------- files

/// The save precondition. Opaque to the UI: it is captured on open, handed
/// back on save, and compared here. `mtimeNs` and `size` are decimal strings
/// for the reason given on [`EntryDto`] — a lossy round-trip would turn every
/// save into a false conflict.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PreconditionDto {
    pub mtime_ns: String,
    pub size: String,
    pub hash: String,
}

impl From<Precondition> for PreconditionDto {
    fn from(p: Precondition) -> Self {
        PreconditionDto {
            mtime_ns: p.mtime_ns.to_string(),
            size: p.size.to_string(),
            hash: p.hash,
        }
    }
}

impl PreconditionDto {
    /// Parse back into the core type. A precondition the UI mangled would
    /// silently disarm the conflict check, so a bad value is an error rather
    /// than a default.
    pub fn to_core(&self) -> Result<Precondition, crate::error::IpcError> {
        let bad = |what: &str| crate::error::IpcError::bad_request(format!("precondition {what}"));
        Ok(Precondition {
            mtime_ns: self.mtime_ns.parse().map_err(|_| bad("mtimeNs"))?,
            size: self.size.parse().map_err(|_| bad("size"))?,
            hash: self.hash.clone(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileDto {
    pub path: String,
    pub text: String,
    pub precondition: PreconditionDto,
    /// False for a file that is not valid UTF-8: it opened read-only and its
    /// text is lossy (PLAN.md §7.3).
    pub utf8: bool,
    /// At or above 5 MB: no Markdown decorations, no highlighting.
    pub plain_mode: bool,
    /// At or above 50 MB: additionally warn.
    pub huge: bool,
}

impl FileDto {
    pub fn new(path: String, content: FileContent) -> Self {
        let size = content.size;
        FileDto {
            path,
            precondition: content.precondition().into(),
            text: content.text,
            utf8: content.utf8,
            plain_mode: size >= PLAIN_MODE_BYTES,
            huge: size >= HUGE_FILE_BYTES,
        }
    }
}

/// What `rename` did, including the link rewrite it triggered (PLAN.md §5.3
/// step 2: the UI re-applies such a diff to a dirty buffer instead of raising
/// the banner).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RenameResultDto {
    pub path: String,
    pub rewritten: Vec<String>,
    pub cards_updated: u32,
    pub conflicts: Vec<String>,
    pub cloud_only_skipped: Vec<String>,
}

// ---------------------------------------------------------------- cache

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TagCountDto {
    pub tag: String,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TagListDto {
    pub tags: Vec<TagCountDto>,
    /// False while the first scan is still running, or if it failed. An empty
    /// list then means "not known yet", not "none".
    pub indexed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkDto {
    pub path: String,
    pub title: String,
    /// The line the link sits on, 1-based.
    pub line: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BacklinksDto {
    pub notes: Vec<BacklinkDto>,
    /// See [`TagListDto::indexed`].
    pub indexed: bool,
}

// ---------------------------------------------------------------- search

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SearchQueryDto {
    pub query: String,
    pub regex: bool,
    pub case_sensitive: bool,
    pub folder: Option<String>,
    /// Only notes carrying this tag. Needs the cache; ignored while it is
    /// still indexing.
    pub tag: Option<String>,
    pub limit: Option<u32>,
    pub all_files: bool,
}

impl From<&SearchQueryDto> for SearchQuery {
    fn from(q: &SearchQueryDto) -> Self {
        SearchQuery {
            query: q.query.clone(),
            regex: q.regex,
            case_sensitive: q.case_sensitive,
            folder: q.folder.clone(),
            tag: q.tag.clone(),
            limit: q.limit.map(|n| n as usize),
            snippets: true,
            all_files: q.all_files,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SearchHitDto {
    pub path: String,
    pub line: u32,
    pub snippet: String,
}

impl From<SearchHit> for SearchHitDto {
    fn from(hit: SearchHit) -> Self {
        SearchHitDto {
            path: hit.path,
            line: hit.line as u32,
            snippet: hit.snippet,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SearchReportDto {
    pub scanned: u32,
    pub cloud_only_skipped: u32,
    pub not_utf8_skipped: u32,
    pub matches: u32,
    pub truncated: bool,
    /// True when a newer search superseded this one before it finished.
    pub cancelled: bool,
}

impl SearchReportDto {
    pub fn new(report: SearchReport, cancelled: bool) -> Self {
        SearchReportDto {
            scanned: report.scanned as u32,
            cloud_only_skipped: report.cloud_only_skipped as u32,
            not_utf8_skipped: report.not_utf8_skipped as u32,
            matches: report.matches as u32,
            truncated: report.truncated,
            cancelled,
        }
    }
}

/// One message on the search [`tauri::ipc::Channel`]. Hits stream in batches so
/// a 10k-note vault does not post 10k messages at the UI thread.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SearchEventDto {
    Hits { hits: Vec<SearchHitDto> },
    Done { report: SearchReportDto },
}

// ---------------------------------------------------------------- boards

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BoardRefDto {
    pub slug: String,
    pub name: String,
}

impl From<&BoardRef> for BoardRefDto {
    fn from(r: &BoardRef) -> Self {
        BoardRefDto {
            slug: r.slug.clone(),
            name: r.name.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDto {
    pub id: String,
    pub name: String,
}

impl From<&Column> for ColumnDto {
    fn from(c: &Column) -> Self {
        ColumnDto {
            id: c.id.clone(),
            name: c.name.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CardDto {
    pub id: String,
    pub title: String,
    pub column: String,
    pub order: String,
    pub notes: Vec<String>,
    pub created: String,
    pub updated: String,
}

impl From<&Card> for CardDto {
    fn from(card: &Card) -> Self {
        CardDto {
            id: card.id.clone(),
            title: card.title.clone(),
            column: card.column.clone(),
            order: card.order.clone(),
            notes: card.notes.clone(),
            created: card.created.clone(),
            updated: card.updated.clone(),
        }
    }
}

/// A board with its cards, in one read. Tombstoned cards are not sent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BoardDto {
    pub slug: String,
    pub name: String,
    pub columns: Vec<ColumnDto>,
    pub cards: Vec<CardDto>,
    /// Card files that are online only and were therefore never read.
    pub cloud_only: Vec<String>,
    /// Cards whose `column` is not in `columns` any more; the UI shows them in
    /// the first column with a marker (`board.columnMissing`).
    pub orphan_cards: Vec<String>,
}

impl BoardDto {
    pub fn new(slug: String, board: &Board, cards: Vec<CardDto>, cloud_only: Vec<String>) -> Self {
        let columns: Vec<ColumnDto> = board.columns.iter().map(ColumnDto::from).collect();
        let orphan_cards = cards
            .iter()
            .filter(|c| !columns.iter().any(|col| col.id == c.column))
            .map(|c| c.id.clone())
            .collect();
        BoardDto {
            slug,
            name: board.name.clone(),
            columns,
            cards,
            cloud_only,
            orphan_cards,
        }
    }
}

/// Where a card goes inside its column.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PositionDto {
    First,
    Last,
    After { id: String },
}

/// The one write the board pane makes. Field-level and replayable, so a
/// conflicting board never raises a banner (PLAN.md §5.3 step 5).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum CardOpDto {
    Add {
        title: String,
        column: Option<String>,
        notes: Vec<String>,
        position: PositionDto,
    },
    Retitle {
        id: String,
        title: String,
    },
    Move {
        id: String,
        column: Option<String>,
        position: PositionDto,
    },
    LinkNote {
        id: String,
        path: String,
    },
    UnlinkNote {
        id: String,
        path: String,
    },
    Remove {
        id: String,
    },
}

// ---------------------------------------------------------------- bootstrap

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapDto {
    pub settings: SettingsDto,
    pub vault: Option<VaultDto>,
    /// The vault root's children. Sub-folders are fetched lazily by `list_dir`,
    /// so the first paint never waits for a full walk (PLAN.md §2.3 rule 1).
    pub tree: Vec<EntryDto>,
    pub last_open: UiStateDto,
    /// The resolved UI language (`de` or `en`) — `language: system` is
    /// resolved here so the UI and the native menu agree.
    pub locale: String,
}

/// The result of opening a different vault: the same two fields `bootstrap`
/// carries for one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultOpenDto {
    pub vault: VaultDto,
    pub tree: Vec<EntryDto>,
}
