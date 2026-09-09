//! Kanban boards (PLAN.md §8): `<vault>/boards/<slug>/board.json` plus one
//! `cards/<ULID>.json` per card. Pretty-printed with sorted keys and a
//! trailing newline; unknown keys round-trip through `extra`; atomic writes
//! under the read-time precondition with field-level replay; whole-card
//! last-writer-wins on `updated` with verbatim winner bytes and losers kept
//! under `conflicts/`; `deleted` tombstones purged after 30 days on the next
//! write of that board's card set.

pub mod order;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{CoreError, CoreResult};
use crate::util::{now_rfc3339_ms, parse_rfc3339_ms};
use crate::vault::cloud::conflict_copy_candidate;
use crate::vault::fs::{
    create_atomic, list_dir, read_bytes, rename_excl, trash, write_atomic, EntryKind, Precondition,
};
use crate::vault::path::{fold, is_hidden, nfc, normalize_rel};

/// The folder under the vault root that holds boards.
pub const BOARDS_DIR: &str = "boards";
/// `board.json` format stamp.
pub const BOARD_FORMAT: u32 = 1;
/// Tombstones older than this are dropped on the next card-set write.
pub const TOMBSTONE_MAX_AGE_MS: i64 = 30 * 24 * 3600 * 1000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Column {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Board {
    pub format: u32,
    pub name: String,
    pub columns: Vec<Column>,
    pub updated: String,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Card {
    pub id: String,
    pub title: String,
    pub column: String,
    pub order: String,
    #[serde(default)]
    pub notes: Vec<String>,
    pub created: String,
    pub updated: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl Card {
    pub fn is_deleted(&self) -> bool {
        self.deleted.is_some()
    }

    /// Milliseconds of `updated` (0 when unparsable).
    pub fn updated_ms(&self) -> i64 {
        parse_rfc3339_ms(&self.updated).unwrap_or(0)
    }
}

/// A board found under `boards/`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BoardRef {
    pub slug: String,
    pub name: String,
}

/// `board.json` with its read-time precondition and raw bytes.
#[derive(Debug, Clone)]
pub struct BoardDoc {
    pub board: Board,
    pub precondition: Precondition,
    pub bytes: Vec<u8>,
}

/// A card file with its read-time precondition.
#[derive(Debug, Clone)]
pub struct CardDoc {
    pub card: Card,
    pub precondition: Precondition,
    pub path: PathBuf,
}

/// Where to place a card within its column.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Position {
    First,
    Last,
    After(String),
}

/// A single replayable field change (§5.3 step 5).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CardChange {
    Title(String),
    Notes(Vec<String>),
    AddNote(String),
    RemoveNote(String),
    /// Move within or across columns; `None` keeps the current column.
    Move {
        column: Option<String>,
        position: Position,
    },
    Delete,
    Restore,
}

/// A new card.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewCard {
    pub title: String,
    /// Column id; the first column when `None`.
    pub column: Option<String>,
    pub notes: Vec<String>,
    pub position: Position,
}

/// Outcome of resolving same-card conflict copies (§8.4).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConflictReport {
    /// Card ids that had conflicting siblings and were resolved.
    pub resolved: Vec<String>,
    /// Sibling files with identical bytes, moved to the Trash.
    pub trashed_identical: Vec<String>,
    /// Loser files moved under `conflicts/`.
    pub losers: Vec<String>,
}

/// Serialize with sorted keys, pretty-printed, trailing newline.
pub fn to_json_bytes<T: Serialize>(value: &T) -> CoreResult<Vec<u8>> {
    // serde_json's Map is a BTreeMap without `preserve_order`, so going
    // through `Value` sorts every level.
    let v = serde_json::to_value(value)?;
    let mut s = serde_json::to_string_pretty(&v)?;
    s.push('\n');
    Ok(s.into_bytes())
}

/// A fresh ULID (48-bit timestamp + 80 random bits from `/dev/urandom`).
pub fn new_ulid() -> CoreResult<String> {
    use std::io::Read;
    let ms = crate::util::epoch_ms(std::time::SystemTime::now()) as u64;
    let mut buf = [0u8; 16];
    let mut f =
        std::fs::File::open("/dev/urandom").map_err(|e| CoreError::from_io("/dev/urandom", e))?;
    f.read_exact(&mut buf[6..])
        .map_err(|e| CoreError::from_io("/dev/urandom", e))?;
    let random = u128::from_be_bytes(buf) & ((1u128 << 80) - 1);
    Ok(ulid::Ulid::from_parts(ms, random).to_string())
}

/// Whether `s` is a well-formed ULID (26 Crockford base32 characters).
pub fn is_ulid(s: &str) -> bool {
    ulid::Ulid::from_string(s).is_ok()
}

fn validate_slug(slug: &str) -> CoreResult<String> {
    let s = normalize_rel(slug)?;
    if s.is_empty() || s.contains('/') || is_hidden(&s) {
        return Err(CoreError::InvalidPath {
            path: slug.to_string(),
            reason: crate::error::PathReason::Empty,
        });
    }
    Ok(s)
}

fn board_dir(vault: &Path, slug: &str) -> CoreResult<PathBuf> {
    Ok(vault.join(BOARDS_DIR).join(validate_slug(slug)?))
}

fn board_rel(slug: &str, name: &str) -> String {
    format!("{BOARDS_DIR}/{slug}/{name}")
}

fn parse_board(bytes: &[u8], path: &Path) -> CoreResult<Board> {
    let board: Board = serde_json::from_slice(bytes)
        .map_err(|e| CoreError::parse(Some(&path.to_string_lossy()), e.to_string()))?;
    if board.format != BOARD_FORMAT {
        return Err(CoreError::parse(
            Some(&path.to_string_lossy()),
            format!("unsupported board format {}", board.format),
        ));
    }
    Ok(board)
}

fn parse_card(bytes: &[u8], path: &Path) -> CoreResult<Card> {
    serde_json::from_slice(bytes)
        .map_err(|e| CoreError::parse(Some(&path.to_string_lossy()), e.to_string()))
}

/// Whether `dir` holds a valid `board.json`.
pub fn is_board_dir(dir: &Path) -> bool {
    let p = dir.join("board.json");
    read_bytes(&p)
        .ok()
        .and_then(|(b, _)| parse_board(&b, &p).ok())
        .is_some()
}

/// Every folder under `boards/` with a valid `board.json`, sorted by slug.
pub fn list_boards(vault: &Path) -> CoreResult<Vec<BoardRef>> {
    let dir = vault.join(BOARDS_DIR);
    let entries = match list_dir(&dir) {
        Ok(e) => e,
        Err(e) if e.is_not_found() => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut out = Vec::new();
    for e in entries {
        if e.kind != EntryKind::Dir || is_hidden(&e.name) {
            continue;
        }
        let p = dir.join(&e.name).join("board.json");
        if let Ok((bytes, _)) = read_bytes(&p) {
            if let Ok(board) = parse_board(&bytes, &p) {
                out.push(BoardRef {
                    slug: e.name.clone(),
                    name: board.name,
                });
            }
        }
    }
    Ok(out)
}

/// Read `board.json`.
pub fn read_board(vault: &Path, slug: &str) -> CoreResult<BoardDoc> {
    let p = board_dir(vault, slug)?.join("board.json");
    let (bytes, precondition) = read_bytes(&p)?;
    let board = parse_board(&bytes, &p)?;
    Ok(BoardDoc {
        board,
        precondition,
        bytes,
    })
}

/// Create a board folder with `board.json` (`AlreadyExists` when present).
pub fn create_board(
    vault: &Path,
    slug: &str,
    name: &str,
    columns: Vec<Column>,
) -> CoreResult<Board> {
    let dir = board_dir(vault, slug)?;
    let board = Board {
        format: BOARD_FORMAT,
        name: name.to_string(),
        columns,
        updated: now_rfc3339_ms(),
        extra: BTreeMap::new(),
    };
    std::fs::create_dir_all(dir.join("cards")).map_err(|e| CoreError::from_io(&dir, e))?;
    create_atomic(&dir.join("board.json"), &to_json_bytes(&board)?)?;
    Ok(board)
}

/// Write `board.json` under `expected`, bumping `updated`.
pub fn write_board(
    vault: &Path,
    slug: &str,
    board: &Board,
    expected: &Precondition,
) -> CoreResult<Precondition> {
    let p = board_dir(vault, slug)?.join("board.json");
    let mut b = board.clone();
    b.updated = now_rfc3339_ms();
    write_atomic(&p, &to_json_bytes(&b)?, Some(expected))
}

/// Replace the column list (re-read and replayed on a precondition conflict).
pub fn set_columns(vault: &Path, slug: &str, columns: Vec<Column>) -> CoreResult<Board> {
    for attempt in 0..3 {
        let doc = read_board(vault, slug)?;
        let mut board = doc.board;
        board.columns = columns.clone();
        board.updated = now_rfc3339_ms();
        let p = board_dir(vault, slug)?.join("board.json");
        match write_atomic(&p, &to_json_bytes(&board)?, Some(&doc.precondition)) {
            Ok(_) => return Ok(board),
            Err(CoreError::Conflict { .. }) if attempt < 2 => continue,
            Err(e) => return Err(e),
        }
    }
    Err(CoreError::internal("set_columns: replay exhausted"))
}

fn cards_dir(vault: &Path, slug: &str) -> CoreResult<PathBuf> {
    Ok(board_dir(vault, slug)?.join("cards"))
}

fn card_path(vault: &Path, slug: &str, id: &str) -> CoreResult<PathBuf> {
    if !is_ulid(id) {
        return Err(CoreError::NotFound {
            path: board_rel(slug, &format!("cards/{id}.json")),
        });
    }
    Ok(cards_dir(vault, slug)?.join(format!("{id}.json")))
}

/// All canonical card files (`cards/<ULID>.json`, tombstones included),
/// sorted by `(column, order, id)`. A card file that is cloud-only or does
/// not parse is an error; see [`list_cards_lenient`] for vault-wide passes.
pub fn list_cards(vault: &Path, slug: &str) -> CoreResult<Vec<CardDoc>> {
    Ok(collect_cards(vault, slug, false)?.0)
}

/// Like [`list_cards`] but tolerant, for vault-wide passes (relink, migrate)
/// that must not fail on one unreadable file: cloud-only card files are
/// returned as file names in the second tuple element and never read
/// (rule 7), and files that do not parse are skipped.
pub fn list_cards_lenient(vault: &Path, slug: &str) -> CoreResult<CardScan> {
    collect_cards(vault, slug, true)
}

/// Returns the readable cards, the card files that are online only, and the
/// card files that could not be used at all — a name that is not a bare ULID
/// (which is what a vendor conflict copy looks like) or a body that does not
/// parse. The third list exists because dropping those silently left the app
/// blind twice over: the card is missing from the board and nothing says why.
type CardScan = (Vec<CardDoc>, Vec<String>, Vec<String>);

fn collect_cards(vault: &Path, slug: &str, lenient: bool) -> CoreResult<CardScan> {
    let dir = cards_dir(vault, slug)?;
    let entries = match list_dir(&dir) {
        Ok(e) => e,
        Err(e) if e.is_not_found() => return Ok((Vec::new(), Vec::new(), Vec::new())),
        Err(e) => return Err(e),
    };
    let mut out = Vec::new();
    let mut cloud_only = Vec::new();
    let mut unreadable = Vec::new();
    for e in entries {
        if e.kind != EntryKind::File || is_hidden(&e.name) {
            continue;
        }
        let Some(stem) = e.name.strip_suffix(".json") else {
            continue;
        };
        if !is_ulid(stem) {
            // A vendor conflict copy lands here as `<ULID> (1).json` or
            // `<ULID> 2.json`. Dropping it silently made the app blind twice
            // over: the card is not on the board and nothing says why.
            // `resolve_card_conflicts` groups by the *parsed* id and can deal
            // with it, so report the name instead of swallowing it.
            unreadable.push(e.name.clone());
            continue;
        }
        if lenient && e.cloud_only {
            cloud_only.push(e.name.clone());
            continue;
        }
        let p = dir.join(&e.name);
        let (bytes, precondition) = match read_bytes(&p) {
            Ok(v) => v,
            Err(CoreError::CloudOnly { .. }) if lenient => {
                cloud_only.push(e.name.clone());
                continue;
            }
            Err(CoreError::NotFound { .. }) if lenient => continue,
            Err(e) => return Err(e),
        };
        let card = match parse_card(&bytes, &p) {
            Ok(c) => c,
            Err(_) if lenient => {
                unreadable.push(e.name.clone());
                continue;
            }
            Err(e) => return Err(e),
        };
        out.push(CardDoc {
            card,
            precondition,
            path: p,
        });
    }
    out.sort_by(|a, b| {
        (&a.card.column, &a.card.order, &a.card.id).cmp(&(
            &b.card.column,
            &b.card.order,
            &b.card.id,
        ))
    });
    Ok((out, cloud_only, unreadable))
}

/// Read one card.
pub fn read_card(vault: &Path, slug: &str, id: &str) -> CoreResult<CardDoc> {
    let p = card_path(vault, slug, id)?;
    let (bytes, precondition) = read_bytes(&p)?;
    let card = parse_card(&bytes, &p)?;
    Ok(CardDoc {
        card,
        precondition,
        path: p,
    })
}

/// Compute the order key for `position` inside `column`, ignoring `skip`.
fn order_for(
    cards: &[CardDoc],
    column: &str,
    position: &Position,
    skip: Option<&str>,
) -> CoreResult<String> {
    let mut live: Vec<&Card> = cards
        .iter()
        .map(|d| &d.card)
        .filter(|c| c.column == column && !c.is_deleted() && Some(c.id.as_str()) != skip)
        .collect();
    live.sort_by(|a, b| (&a.order, &a.id).cmp(&(&b.order, &b.id)));
    let bad = |e: order::OrderError| CoreError::parse(None, e.0);
    match position {
        Position::First => {
            order::key_between(None, live.first().map(|c| c.order.as_str())).map_err(bad)
        }
        Position::Last => {
            order::key_between(live.last().map(|c| c.order.as_str()), None).map_err(bad)
        }
        Position::After(id) => {
            let Some(i) = live.iter().position(|c| &c.id == id) else {
                return Err(CoreError::NotFound {
                    path: format!("cards/{id}.json"),
                });
            };
            let a = live[i].order.as_str();
            let b = live.get(i + 1).map(|c| c.order.as_str());
            if b.is_some_and(|b| b <= a) {
                // A tie from two devices choosing the same key: re-key after both.
                return order::key_between(b, live.get(i + 2).map(|c| c.order.as_str()))
                    .map_err(bad);
            }
            order::key_between(Some(a), b).map_err(bad)
        }
    }
}

/// Add a card. The column must exist (`NotFound` otherwise); the id is a
/// fresh ULID; the file is created with `RENAME_EXCL`.
pub fn add_card(vault: &Path, slug: &str, new: NewCard) -> CoreResult<Card> {
    let board = read_board(vault, slug)?.board;
    let column = match new.column {
        Some(c) => c,
        None => board
            .columns
            .first()
            .map(|c| c.id.clone())
            .ok_or_else(|| CoreError::NotFound {
                path: board_rel(slug, "board.json#columns"),
            })?,
    };
    if !board.columns.iter().any(|c| c.id == column) {
        return Err(CoreError::NotFound {
            path: board_rel(slug, &format!("board.json#columns/{column}")),
        });
    }
    let cards = list_cards(vault, slug)?;
    let order = order_for(&cards, &column, &new.position, None)?;
    let now = now_rfc3339_ms();
    let card = Card {
        id: new_ulid()?,
        title: new.title,
        column,
        order,
        notes: new.notes.into_iter().map(|n| nfc(&n)).collect(),
        created: now.clone(),
        updated: now,
        deleted: None,
        extra: BTreeMap::new(),
    };
    let p = card_path(vault, slug, &card.id)?;
    create_atomic(&p, &to_json_bytes(&card)?)?;
    purge_tombstones(vault, slug, &cards)?;
    Ok(card)
}

fn apply_change(card: &mut Card, change: &CardChange, cards: &[CardDoc]) -> CoreResult<()> {
    match change {
        CardChange::Title(t) => card.title = t.clone(),
        CardChange::Notes(n) => card.notes = n.iter().map(|x| nfc(x)).collect(),
        CardChange::AddNote(n) => {
            let n = nfc(n);
            if !card.notes.iter().any(|x| fold(x) == fold(&n)) {
                card.notes.push(n);
            }
        }
        CardChange::RemoveNote(n) => {
            let key = fold(n);
            card.notes.retain(|x| fold(x) != key);
        }
        CardChange::Move { column, position } => {
            let column = column.clone().unwrap_or_else(|| card.column.clone());
            card.order = order_for(cards, &column, position, Some(&card.id))?;
            card.column = column;
        }
        CardChange::Delete => card.deleted = Some(now_rfc3339_ms()),
        CardChange::Restore => card.deleted = None,
    }
    Ok(())
}

/// Apply one field-level change: read → apply → write under the read-time
/// precondition; on `Conflict` re-read and replay (up to three times).
/// `expected_updated` (CLI `--if-updated`) must equal the card's current
/// `updated` or the change is refused with `Conflict`. Bumps `updated`.
pub fn update_card(
    vault: &Path,
    slug: &str,
    id: &str,
    change: &CardChange,
    expected_updated: Option<&str>,
) -> CoreResult<Card> {
    for attempt in 0..3 {
        let doc = read_card(vault, slug, id)?;
        if let Some(exp) = expected_updated {
            if exp != doc.card.updated {
                return Err(CoreError::Conflict {
                    path: board_rel(slug, &format!("cards/{id}.json")),
                    expected: None,
                    actual: Some(doc.precondition),
                });
            }
        }
        let cards = if matches!(change, CardChange::Move { .. }) {
            list_cards(vault, slug)?
        } else {
            Vec::new()
        };
        if let CardChange::Move {
            column: Some(c), ..
        } = change
        {
            let board = read_board(vault, slug)?.board;
            if !board.columns.iter().any(|col| &col.id == c) {
                return Err(CoreError::NotFound {
                    path: board_rel(slug, &format!("board.json#columns/{c}")),
                });
            }
        }
        let mut card = doc.card;
        apply_change(&mut card, change, &cards)?;
        card.updated = now_rfc3339_ms();
        match write_atomic(&doc.path, &to_json_bytes(&card)?, Some(&doc.precondition)) {
            Ok(_) => {
                purge_tombstones(vault, slug, &cards)?;
                return Ok(card);
            }
            Err(CoreError::Conflict { .. }) if attempt < 2 => continue,
            Err(e) => return Err(e),
        }
    }
    Err(CoreError::internal("update_card: replay exhausted"))
}

/// Tombstone a card (`deleted` timestamp).
pub fn remove_card(vault: &Path, slug: &str, id: &str) -> CoreResult<Card> {
    update_card(vault, slug, id, &CardChange::Delete, None)
}

/// Drop tombstones older than 30 days. Called on every write of a board's
/// card set (no timer, no startup sweep). `known` may be a pre-read list.
pub fn purge_tombstones(vault: &Path, slug: &str, known: &[CardDoc]) -> CoreResult<Vec<String>> {
    let now = crate::util::epoch_ms(std::time::SystemTime::now());
    let owned;
    let cards: &[CardDoc] = if known.is_empty() {
        owned = list_cards(vault, slug)?;
        &owned
    } else {
        known
    };
    let mut purged = Vec::new();
    for d in cards {
        let Some(deleted) = &d.card.deleted else {
            continue;
        };
        let Some(ms) = parse_rfc3339_ms(deleted) else {
            continue;
        };
        if now - ms > TOMBSTONE_MAX_AGE_MS {
            match std::fs::remove_file(&d.path) {
                Ok(()) => purged.push(d.card.id.clone()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(CoreError::from_io(&d.path, e)),
            }
        }
    }
    Ok(purged)
}

/// Cards (across all boards) that reference `note_path` in `notes[]`.
pub fn cards_linking(vault: &Path, note_path: &str) -> CoreResult<Vec<(BoardRef, Card)>> {
    let key = fold(note_path);
    let mut out = Vec::new();
    for b in list_boards(vault)? {
        for d in list_cards(vault, &b.slug)? {
            if !d.card.is_deleted() && d.card.notes.iter().any(|n| fold(n) == key) {
                out.push((b.clone(), d.card));
            }
        }
    }
    Ok(out)
}

fn conflicts_name(id: &str, updated: &str) -> String {
    let stamp: String = updated
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    format!("{id}-{stamp}.json")
}

fn move_to_conflicts(board: &Path, file: &Path, id: &str, updated: &str) -> CoreResult<String> {
    let dir = board.join("conflicts");
    std::fs::create_dir_all(&dir).map_err(|e| CoreError::from_io(&dir, e))?;
    let base = conflicts_name(id, updated);
    let mut target = dir.join(&base);
    let mut n = 2;
    loop {
        match rename_excl(file, &target) {
            Ok(()) => {
                return Ok(format!(
                    "conflicts/{}",
                    target.file_name().unwrap().to_string_lossy()
                ))
            }
            Err(CoreError::AlreadyExists { .. }) if n < 100 => {
                target = dir.join(base.replace(".json", &format!("-{n}.json")));
                n += 1;
            }
            Err(e) => return Err(e),
        }
    }
}

/// Resolve same-card conflict copies in `cards/` (§8.4): any file whose
/// parsed `id` equals another file's id. Identical siblings are trashed;
/// otherwise the newest `updated` wins (tie: bytewise larger content), the
/// winner's bytes land verbatim at `cards/<id>.json` (`updated` untouched),
/// and losers move to `conflicts/<id>-<updated>.json` with `RENAME_EXCL`.
pub fn resolve_card_conflicts(vault: &Path, slug: &str) -> CoreResult<ConflictReport> {
    let board = board_dir(vault, slug)?;
    let dir = board.join("cards");
    let mut report = ConflictReport::default();
    let entries = match list_dir(&dir) {
        Ok(e) => e,
        Err(e) if e.is_not_found() => return Ok(report),
        Err(e) => return Err(e),
    };
    // id → (path, bytes, card)
    let mut groups: BTreeMap<String, Vec<(PathBuf, Vec<u8>, Card)>> = BTreeMap::new();
    for e in &entries {
        if e.kind != EntryKind::File || is_hidden(&e.name) || !e.name.ends_with(".json") {
            continue;
        }
        let p = dir.join(&e.name);
        let Ok((bytes, _)) = read_bytes(&p) else {
            continue;
        };
        let Ok(card) = parse_card(&bytes, &p) else {
            continue;
        };
        if !is_ulid(&card.id) {
            continue;
        }
        groups
            .entry(card.id.clone())
            .or_default()
            .push((p, bytes, card));
    }
    for (id, mut files) in groups {
        if files.len() < 2 {
            continue;
        }
        let canonical = dir.join(format!("{id}.json"));
        // Winner: max (updated_ms, bytes).
        files.sort_by(|a, b| (a.2.updated_ms(), &a.1).cmp(&(b.2.updated_ms(), &b.1)));
        let (win_path, win_bytes, _) = files.pop().unwrap();
        for (path, bytes, card) in files {
            if bytes == win_bytes {
                trash(&path)?;
                report.trashed_identical.push(rel_name(&path));
            } else {
                let moved = move_to_conflicts(&board, &path, &id, &card.updated)?;
                report.losers.push(moved);
            }
        }
        if win_path != canonical {
            rename_excl(&win_path, &canonical)?;
        }
        report.resolved.push(id);
    }
    Ok(report)
}

/// Resolve `board.json` conflict copies (`board-<host>.json`, `board (1).json`)
/// with the same rule; columns present in either version are unioned so no
/// card is orphaned (`updated` stays the winner's).
pub fn resolve_board_conflicts(vault: &Path, slug: &str) -> CoreResult<ConflictReport> {
    let board = board_dir(vault, slug)?;
    let mut report = ConflictReport::default();
    let entries = list_dir(&board)?;
    let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
    let mut candidates: Vec<(PathBuf, Vec<u8>, Board)> = Vec::new();
    for e in &entries {
        if e.kind != EntryKind::File || is_hidden(&e.name) || e.name == "board.json" {
            continue;
        }
        let Some((orig, _)) = conflict_copy_candidate(
            &e.name,
            |n| names.contains(&n),
            Some(&crate::util::hostname()),
        ) else {
            continue;
        };
        if orig != "board.json" {
            continue;
        }
        let p = board.join(&e.name);
        let Ok((bytes, _)) = read_bytes(&p) else {
            continue;
        };
        let Ok(b) = parse_board(&bytes, &p) else {
            continue;
        };
        candidates.push((p, bytes, b));
    }
    if candidates.is_empty() {
        return Ok(report);
    }
    let canonical = board.join("board.json");
    let (c_bytes, c_pre) = read_bytes(&canonical)?;
    let c_board = parse_board(&c_bytes, &canonical)?;
    candidates.push((canonical.clone(), c_bytes, c_board));
    let ms = |b: &Board| parse_rfc3339_ms(&b.updated).unwrap_or(0);
    candidates.sort_by(|a, b| (ms(&a.2), &a.1).cmp(&(ms(&b.2), &b.1)));
    let (win_path, win_bytes, mut winner) = candidates.pop().unwrap();
    let mut added = false;
    for (path, bytes, loser) in candidates {
        if bytes == win_bytes {
            if path != canonical {
                trash(&path)?;
                report.trashed_identical.push(rel_name(&path));
            }
            continue;
        }
        for col in loser.columns {
            if !winner.columns.iter().any(|c| c.id == col.id) {
                winner.columns.push(col);
                added = true;
            }
        }
        if path != canonical {
            let moved = move_to_conflicts(&board, &path, "board", &loser.updated)?;
            report.losers.push(moved);
        }
    }
    if win_path == canonical {
        if added {
            write_atomic(&canonical, &to_json_bytes(&winner)?, Some(&c_pre))?;
        }
    } else {
        // The canonical file is a loser: park it, then promote the winner.
        let c_board = parse_board(&read_bytes(&canonical)?.0, &canonical)?;
        let moved = move_to_conflicts(&board, &canonical, "board", &c_board.updated)?;
        report.losers.push(moved);
        if added {
            create_atomic(&canonical, &to_json_bytes(&winner)?)?;
            trash(&win_path)?;
        } else {
            rename_excl(&win_path, &canonical)?;
        }
    }
    report.resolved.push("board".to_string());
    Ok(report)
}

fn rel_name(p: &Path) -> String {
    p.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> tempfile::TempDir {
        let t = tempfile::tempdir().unwrap();
        create_board(
            t.path(),
            "atlas",
            "Atlas",
            vec![
                Column {
                    id: "todo".into(),
                    name: "To Do".into(),
                },
                Column {
                    id: "doing".into(),
                    name: "Doing".into(),
                },
                Column {
                    id: "done".into(),
                    name: "Done".into(),
                },
            ],
        )
        .unwrap();
        t
    }

    fn add(v: &Path, title: &str, column: Option<&str>, position: Position) -> Card {
        add_card(
            v,
            "atlas",
            NewCard {
                title: title.into(),
                column: column.map(str::to_string),
                notes: vec![],
                position,
            },
        )
        .unwrap()
    }

    #[test]
    fn board_json_is_sorted_pretty_with_trailing_newline_and_roundtrips_extra() {
        let t = vault();
        let raw = std::fs::read_to_string(t.path().join("boards/atlas/board.json")).unwrap();
        assert!(raw.ends_with("}\n"));
        // Two-space indent = a top-level key; nested column keys sit deeper.
        let keys: Vec<&str> = raw
            .lines()
            .filter_map(|l| l.strip_prefix("  \""))
            .map(|l| l.split('"').next().unwrap())
            .collect();
        assert_eq!(
            keys,
            vec!["columns", "format", "name", "updated"],
            "keys are sorted"
        );
        assert!(raw.contains("  \"name\": \"Atlas\""));
        // Unknown keys survive a read → write cycle.
        let with_extra = raw.replace(
            "\"format\": 1,",
            "\"format\": 1,\n  \"future\": {\"x\": [1, 2]},",
        );
        std::fs::write(t.path().join("boards/atlas/board.json"), &with_extra).unwrap();
        let doc = read_board(t.path(), "atlas").unwrap();
        assert_eq!(doc.board.extra.get("future").unwrap()["x"][1], 2);
        write_board(t.path(), "atlas", &doc.board, &doc.precondition).unwrap();
        let again = std::fs::read_to_string(t.path().join("boards/atlas/board.json")).unwrap();
        assert!(again.contains("\"future\""));
        assert_eq!(
            list_boards(t.path()).unwrap(),
            vec![BoardRef {
                slug: "atlas".into(),
                name: "Atlas".into()
            }]
        );
        assert!(matches!(
            create_board(t.path(), "atlas", "Dup", vec![]),
            Err(CoreError::AlreadyExists { .. })
        ));
    }

    #[test]
    fn a_board_is_a_folder_with_a_valid_board_json() {
        let t = vault();
        std::fs::create_dir_all(t.path().join("boards/notes-only")).unwrap();
        std::fs::write(t.path().join("boards/notes-only/x.md"), "# note").unwrap();
        std::fs::create_dir_all(t.path().join("boards/broken")).unwrap();
        std::fs::write(t.path().join("boards/broken/board.json"), "{not json").unwrap();
        std::fs::create_dir_all(t.path().join("boards/wrong-format")).unwrap();
        std::fs::write(
            t.path().join("boards/wrong-format/board.json"),
            r#"{"format":2,"name":"x","columns":[],"updated":""}"#,
        )
        .unwrap();
        let slugs: Vec<String> = list_boards(t.path())
            .unwrap()
            .into_iter()
            .map(|b| b.slug)
            .collect();
        assert_eq!(slugs, vec!["atlas"]);
        assert!(!is_board_dir(&t.path().join("boards/notes-only")));
        assert!(is_board_dir(&t.path().join("boards/atlas")));
        assert!(list_boards(tempfile::tempdir().unwrap().path())
            .unwrap()
            .is_empty());
    }

    #[test]
    fn cards_are_ulid_files_with_fractional_order() {
        let t = vault();
        let a = add(t.path(), "A", None, Position::Last);
        let b = add(t.path(), "B", None, Position::Last);
        let c = add(t.path(), "C", None, Position::First);
        let d = add(t.path(), "D", Some("todo"), Position::After(a.id.clone()));
        assert!(is_ulid(&a.id));
        assert_eq!(a.column, "todo");
        assert_eq!(a.order, "a0");
        assert_eq!(b.order, "a1");
        assert_eq!(c.order, "Zz");
        assert_eq!(d.order, "a0V");
        let raw =
            std::fs::read_to_string(t.path().join(format!("boards/atlas/cards/{}.json", a.id)))
                .unwrap();
        assert!(raw.starts_with("{\n  \"column\": \"todo\",\n  \"created\":"));
        assert!(raw.ends_with("}\n"));
        assert!(!raw.contains("deleted"));
        let titles: Vec<String> = list_cards(t.path(), "atlas")
            .unwrap()
            .into_iter()
            .map(|d| d.card.title)
            .collect();
        assert_eq!(titles, vec!["C", "A", "D", "B"]);
        assert!(matches!(
            add_card(
                t.path(),
                "atlas",
                NewCard {
                    title: "E".into(),
                    column: Some("nope".into()),
                    notes: vec![],
                    position: Position::Last
                }
            ),
            Err(CoreError::NotFound { .. })
        ));
    }

    #[test]
    fn update_card_applies_field_changes_and_replays_on_conflict() {
        let t = vault();
        let a = add(t.path(), "A", None, Position::Last);
        let b = add(t.path(), "B", None, Position::Last);
        let moved = update_card(
            t.path(),
            "atlas",
            &a.id,
            &CardChange::Move {
                column: Some("doing".into()),
                position: Position::Last,
            },
            None,
        )
        .unwrap();
        assert_eq!(moved.column, "doing");
        assert_eq!(moved.order, "a0");
        assert!(moved.updated >= a.updated);
        let titled = update_card(
            t.path(),
            "atlas",
            &b.id,
            &CardChange::Title("B2".into()),
            Some(&b.updated),
        )
        .unwrap();
        assert_eq!(titled.title, "B2");
        // Stale --if-updated is refused.
        assert!(matches!(
            update_card(
                t.path(),
                "atlas",
                &b.id,
                &CardChange::Title("B3".into()),
                Some(&b.updated)
            ),
            Err(CoreError::Conflict { .. })
        ));
        let noted = update_card(
            t.path(),
            "atlas",
            &b.id,
            &CardChange::AddNote("projects/Atlas Overview.md".into()),
            None,
        )
        .unwrap();
        assert_eq!(noted.notes, vec!["projects/Atlas Overview.md"]);
        let same = update_card(
            t.path(),
            "atlas",
            &b.id,
            &CardChange::AddNote("Projects/atlas overview.md".into()),
            None,
        )
        .unwrap();
        assert_eq!(same.notes.len(), 1);
        let linking = cards_linking(t.path(), "projects/atlas overview.md").unwrap();
        assert_eq!(linking.len(), 1);
        assert_eq!(linking[0].1.id, b.id);
        let removed = update_card(
            t.path(),
            "atlas",
            &b.id,
            &CardChange::RemoveNote("projects/Atlas Overview.md".into()),
            None,
        )
        .unwrap();
        assert!(removed.notes.is_empty());
        // Move after A in doing, then back to first in todo.
        let c = add(t.path(), "C", Some("doing"), Position::After(a.id.clone()));
        assert_eq!(c.order, "a1");
        let back = update_card(
            t.path(),
            "atlas",
            &c.id,
            &CardChange::Move {
                column: Some("todo".into()),
                position: Position::First,
            },
            None,
        )
        .unwrap();
        assert_eq!(back.column, "todo");
        assert_eq!(back.order, "a0", "first in todo, ahead of B's a1");
        assert!(matches!(
            update_card(
                t.path(),
                "atlas",
                &c.id,
                &CardChange::Move {
                    column: Some("missing".into()),
                    position: Position::First
                },
                None
            ),
            Err(CoreError::NotFound { .. })
        ));
        assert!(update_card(
            t.path(),
            "atlas",
            "not-a-ulid",
            &CardChange::Title("x".into()),
            None
        )
        .unwrap_err()
        .is_not_found());
    }

    #[test]
    fn tombstones_are_written_and_purged_after_30_days_on_next_write() {
        let t = vault();
        let a = add(t.path(), "A", None, Position::Last);
        let gone = remove_card(t.path(), "atlas", &a.id).unwrap();
        assert!(gone.is_deleted());
        let raw =
            std::fs::read_to_string(t.path().join(format!("boards/atlas/cards/{}.json", a.id)))
                .unwrap();
        assert!(raw.contains("\"deleted\": \""));
        // Age the tombstone past 30 days.
        let old = raw.replace(&gone.deleted.clone().unwrap(), "2020-01-01T00:00:00.000Z");
        std::fs::write(
            t.path().join(format!("boards/atlas/cards/{}.json", a.id)),
            old,
        )
        .unwrap();
        assert!(t
            .path()
            .join(format!("boards/atlas/cards/{}.json", a.id))
            .exists());
        add(t.path(), "B", None, Position::Last);
        assert!(
            !t.path()
                .join(format!("boards/atlas/cards/{}.json", a.id))
                .exists(),
            "purged on the next card-set write"
        );
        // A fresh tombstone survives.
        let b = list_cards(t.path(), "atlas").unwrap().remove(0).card;
        remove_card(t.path(), "atlas", &b.id).unwrap();
        add(t.path(), "C", None, Position::Last);
        assert!(t
            .path()
            .join(format!("boards/atlas/cards/{}.json", b.id))
            .exists());
        let restored = update_card(t.path(), "atlas", &b.id, &CardChange::Restore, None).unwrap();
        assert!(!restored.is_deleted());
    }

    #[test]
    fn same_card_conflict_copies_resolve_by_lww_with_verbatim_bytes() {
        let t = vault();
        let a = add(t.path(), "A", None, Position::Last);
        let cards = t.path().join("boards/atlas/cards");
        let canonical = cards.join(format!("{}.json", a.id));
        let original = std::fs::read(&canonical).unwrap();
        // A sibling from another device: newer `updated`, different title,
        // deliberately NOT pretty/sorted so verbatim bytes are observable.
        let newer = format!(
            "{{\"updated\":\"2099-01-01T00:00:00.000Z\",\"id\":\"{}\",\"title\":\"A from laptop\",\"column\":\"todo\",\"order\":\"a0\",\"notes\":[],\"created\":\"{}\"}}",
            a.id, a.created
        );
        std::fs::write(cards.join(format!("{}-MacBook-Pro.json", a.id)), &newer).unwrap();
        let report = resolve_card_conflicts(t.path(), "atlas").unwrap();
        assert_eq!(report.resolved, vec![a.id.clone()]);
        assert_eq!(report.losers.len(), 1);
        assert!(
            report.losers[0].starts_with(&format!("conflicts/{}-", a.id)),
            "{:?}",
            report.losers
        );
        assert!(report.trashed_identical.is_empty());
        assert_eq!(
            std::fs::read(&canonical).unwrap(),
            newer.as_bytes(),
            "winner bytes verbatim"
        );
        assert!(!cards.join(format!("{}-MacBook-Pro.json", a.id)).exists());
        let loser = std::fs::read(t.path().join("boards/atlas").join(&report.losers[0])).unwrap();
        assert_eq!(loser, original);
        // Idempotent: nothing left to resolve.
        assert_eq!(
            resolve_card_conflicts(t.path(), "atlas").unwrap(),
            ConflictReport::default()
        );
        let names: Vec<String> = list_dir(&cards)
            .unwrap()
            .into_iter()
            .map(|e| e.name)
            .collect();
        assert_eq!(names, vec![format!("{}.json", a.id)]);
    }

    #[test]
    fn lww_tie_breaks_bytewise_and_older_sibling_loses() {
        let t = vault();
        let a = add(t.path(), "A", None, Position::Last);
        let cards = t.path().join("boards/atlas/cards");
        let canonical = cards.join(format!("{}.json", a.id));
        let mine = std::fs::read(&canonical).unwrap();
        // Older sibling: canonical stays, sibling parked.
        let older = String::from_utf8(mine.clone())
            .unwrap()
            .replace(&a.updated, "2000-01-01T00:00:00.000Z")
            .replace("\"A\"", "\"Old\"");
        std::fs::write(cards.join(format!("{} (1).json", a.id)), &older).unwrap();
        let report = resolve_card_conflicts(t.path(), "atlas").unwrap();
        assert_eq!(std::fs::read(&canonical).unwrap(), mine);
        assert_eq!(report.losers.len(), 1);
        assert!(
            report.losers[0].contains("20000101T000000000Z"),
            "{:?}",
            report.losers
        );
        // Same updated, different bytes: the bytewise larger content wins.
        let tie = String::from_utf8(mine.clone())
            .unwrap()
            .replace("\"A\"", "\"Z-title\"");
        std::fs::write(cards.join(format!("{}-DESKTOP-1.json", a.id)), &tie).unwrap();
        resolve_card_conflicts(t.path(), "atlas").unwrap();
        assert_eq!(std::fs::read(&canonical).unwrap(), tie.as_bytes());
    }

    #[test]
    fn board_conflict_unions_columns() {
        let t = vault();
        let dir = t.path().join("boards/atlas");
        let canonical = std::fs::read_to_string(dir.join("board.json")).unwrap();
        let mine = read_board(t.path(), "atlas").unwrap().board;
        let mut theirs = mine.clone();
        theirs.columns = vec![
            Column {
                id: "todo".into(),
                name: "To Do".into(),
            },
            Column {
                id: "waiting".into(),
                name: "Waiting".into(),
            },
        ];
        theirs.updated = "2099-01-01T00:00:00.000Z".into();
        std::fs::write(
            dir.join("board-MacBook-Pro.json"),
            to_json_bytes(&theirs).unwrap(),
        )
        .unwrap();
        let report = resolve_board_conflicts(t.path(), "atlas").unwrap();
        assert_eq!(report.resolved, vec!["board"]);
        assert_eq!(report.losers.len(), 1);
        let merged = read_board(t.path(), "atlas").unwrap().board;
        let ids: Vec<&str> = merged.columns.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec!["todo", "waiting", "doing", "done"]);
        assert_eq!(
            merged.updated, "2099-01-01T00:00:00.000Z",
            "resolution never bumps updated"
        );
        assert!(!dir.join("board-MacBook-Pro.json").exists());
        let parked = std::fs::read_to_string(dir.join(&report.losers[0])).unwrap();
        assert_eq!(parked, canonical);
        assert_eq!(
            resolve_board_conflicts(t.path(), "atlas").unwrap(),
            ConflictReport::default()
        );
    }

    #[test]
    fn set_columns_replays_after_external_change() {
        let t = vault();
        let cols = vec![Column {
            id: "one".into(),
            name: "One".into(),
        }];
        let b = set_columns(t.path(), "atlas", cols.clone()).unwrap();
        assert_eq!(b.columns, cols);
        let again = read_board(t.path(), "atlas").unwrap();
        assert_eq!(again.board.columns, cols);
        assert!(matches!(
            set_columns(t.path(), "nope", cols).unwrap_err(),
            CoreError::NotFound { .. }
        ));
        assert!(matches!(
            read_board(t.path(), "../etc"),
            Err(CoreError::InvalidPath { .. })
        ));
    }

    #[test]
    fn ulids_are_time_sortable_and_unique() {
        let a = new_ulid().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let b = new_ulid().unwrap();
        assert_eq!(a.len(), 26);
        assert!(is_ulid(&a));
        assert!(b > a);
        assert!(!is_ulid("not-a-ulid"));
    }
}
