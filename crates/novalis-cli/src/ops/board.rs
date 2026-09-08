//! `novalis board` — the boards of a vault, one board with its cards, and the
//! column list (PLAN.md §9.2). A board is `boards/<slug>/` with a valid
//! `board.json`; the store itself lives in `novalis_core::boards`.

use std::io::Write;

use novalis_core::boards::{self, Board, Column};
use novalis_core::vault::path::fold;
use novalis_core::CoreError;
use schemars::JsonSchema;
use serde::Serialize;

use crate::cli::{BoardArgs, BoardColumnsArgs, BoardCommand};
use crate::ctx::Ctx;
use crate::error::CliError;
use crate::ops::card::{card_view, CardView};
use crate::output::Render;

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct ColumnOut {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BoardItem {
    pub slug: String,
    pub name: String,
    /// The board folder, vault-relative.
    pub path: String,
    pub columns: Vec<ColumnOut>,
    /// How many live cards the board holds; tombstones are not counted.
    pub cards: usize,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BoardListOut {
    pub items: Vec<BoardItem>,
    pub truncated: bool,
    /// Card files that are online only and were therefore never read.
    pub cloud_only_skipped: Vec<String>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BoardDetailOut {
    pub slug: String,
    pub name: String,
    /// The board folder, vault-relative.
    pub path: String,
    pub columns: Vec<ColumnOut>,
    /// Live cards, sorted by (column order, order, id). Tombstones are left
    /// out; a card whose column is gone sorts first, as the first column.
    pub cards: Vec<CardView>,
    /// Cards whose `column` is not in `columns` any more. The app shows them
    /// in the first column with a marker; they are never hidden.
    pub orphan_cards: Vec<String>,
    pub cloud_only_skipped: Vec<String>,
    pub updated: String,
    /// Set by `board columns --set --dry-run`: `columns` is what the write
    /// would store, `updated` is still the stamp on disk.
    #[serde(skip_serializing_if = "crate::util::is_false")]
    pub dry_run: bool,
}

/// `board` has two shapes; which one is decided by the subcommand, so the
/// JSON is untagged and an agent selects on the keys of the command it ran.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum BoardOut {
    List(BoardListOut),
    Board(BoardDetailOut),
}

/// `boards/<slug>`, the vault-relative folder that is the board.
pub fn board_path(slug: &str) -> String {
    format!("{}/{slug}", boards::BOARDS_DIR)
}

/// Read `board.json`, with the vault-relative path in a `not_found` (exit 3):
/// the store reports the absolute path it tried to open, and every path the
/// CLI prints is vault-relative (PLAN.md §9.1).
pub fn read_board(ctx: &Ctx, slug: &str) -> Result<Board, CliError> {
    boards::read_board(&ctx.vault, slug)
        .map(|doc| doc.board)
        .map_err(|e| match e {
            CoreError::NotFound { .. } => CliError::from_core(CoreError::NotFound {
                path: format!("{}/board.json", board_path(slug)),
            }),
            other => CliError::from_core(other),
        })
}

/// A `--column` value: a column id, or a column name when exactly one column
/// carries it (PLAN.md §9.2). Unknown is exit 3, ambiguous is exit 4.
pub fn resolve_column(slug: &str, board: &Board, wanted: &str) -> Result<String, CliError> {
    if board.columns.iter().any(|c| c.id == wanted) {
        return Ok(wanted.to_string());
    }
    let key = fold(wanted);
    let by_name: Vec<&Column> = board
        .columns
        .iter()
        .filter(|c| fold(&c.name) == key)
        .collect();
    match by_name.as_slice() {
        [one] => Ok(one.id.clone()),
        // The path the store itself reports for a column that is not there.
        [] => Err(CliError::not_found(format!("no column `{wanted}`"))
            .with_path(format!("{}/board.json#columns/{wanted}", board_path(slug)))),
        many => Err(
            CliError::conflict(format!("`{wanted}` is the name of several columns"))
                .with_candidates(many.iter().map(|c| c.id.clone()).collect()),
        ),
    }
}

/// Where a column sits in the board, 1-based. A column the board does not
/// have is 0: an orphaned card is shown in the first column, never hidden.
pub fn column_rank(board: &Board, column: &str) -> usize {
    board
        .columns
        .iter()
        .position(|c| c.id == column)
        .map(|i| i + 1)
        .unwrap_or(0)
}

/// The card order both `board show` and `card ls` promise: the board's own
/// column order, then the fractional-index key, then the id. The store sorts
/// by the column *id*, which is not the order the board is read in.
pub fn sort_by_columns(board: &Board, cards: &mut [CardView]) {
    cards.sort_by(|a, b| {
        (column_rank(board, &a.column), &a.order, &a.id).cmp(&(
            column_rank(board, &b.column),
            &b.order,
            &b.id,
        ))
    });
}

fn columns_of(board: &Board) -> Vec<ColumnOut> {
    board
        .columns
        .iter()
        .map(|c| ColumnOut {
            id: c.id.clone(),
            name: c.name.clone(),
        })
        .collect()
}

/// The `--set` value: `[{"id":"todo","name":"To Do"}]`. A malformed list is a
/// usage error (exit 2), and so is a list that could not address its cards:
/// an empty id, or the same id twice.
fn parse_columns(raw: &str) -> Result<Vec<Column>, CliError> {
    let columns: Vec<Column> = serde_json::from_str(raw).map_err(|e| {
        CliError::usage(format!("--set is not a column list: {e}"))
            .with_hint(r#"pass JSON like [{"id":"todo","name":"To Do"}]"#)
    })?;
    for (i, c) in columns.iter().enumerate() {
        if c.id.trim().is_empty() {
            return Err(CliError::usage("--set: a column id cannot be empty"));
        }
        if columns[..i].iter().any(|other| other.id == c.id) {
            return Err(CliError::usage(format!(
                "--set: the column id `{}` is used twice",
                c.id
            )));
        }
    }
    Ok(columns)
}

/// Cloud-only card files, as vault-relative paths.
fn skipped_paths(slug: &str, names: &[String]) -> Vec<String> {
    names
        .iter()
        .map(|n| format!("{}/cards/{n}", board_path(slug)))
        .collect()
}

pub fn run(ctx: &Ctx, args: BoardArgs) -> Result<BoardOut, CliError> {
    match args.command {
        BoardCommand::Ls => list(ctx),
        BoardCommand::Show(a) => {
            let board = read_board(ctx, &a.board)?;
            detail(ctx, &a.board, &board, false)
        }
        BoardCommand::Columns(a) => columns(ctx, a),
    }
}

fn list(ctx: &Ctx) -> Result<BoardOut, CliError> {
    let mut items = Vec::new();
    let mut cloud_only_skipped = Vec::new();
    for b in boards::list_boards(&ctx.vault)? {
        let board = read_board(ctx, &b.slug)?;
        let (cards, cloud_only) = boards::list_cards_lenient(&ctx.vault, &b.slug)?;
        cloud_only_skipped.extend(skipped_paths(&b.slug, &cloud_only));
        items.push(BoardItem {
            path: board_path(&b.slug),
            slug: b.slug,
            name: b.name,
            columns: columns_of(&board),
            cards: cards.iter().filter(|d| !d.card.is_deleted()).count(),
        });
    }
    Ok(BoardOut::List(BoardListOut {
        items,
        truncated: false,
        cloud_only_skipped,
    }))
}

fn columns(ctx: &Ctx, args: BoardColumnsArgs) -> Result<BoardOut, CliError> {
    let wanted = parse_columns(&args.set)?;
    // The board must exist before anything is written or reported.
    let mut board = read_board(ctx, &args.board)?;
    if ctx.dry_run {
        board.columns = wanted;
        return detail(ctx, &args.board, &board, true);
    }
    let written = boards::set_columns(&ctx.vault, &args.board, wanted)?;
    detail(ctx, &args.board, &written, false)
}

fn detail(ctx: &Ctx, slug: &str, board: &Board, dry_run: bool) -> Result<BoardOut, CliError> {
    let (docs, cloud_only) = boards::list_cards_lenient(&ctx.vault, slug)?;
    let mut cards: Vec<CardView> = docs
        .iter()
        .filter(|d| !d.card.is_deleted())
        .map(|d| card_view(slug, &d.card))
        .collect();
    sort_by_columns(board, &mut cards);
    let orphan_cards = cards
        .iter()
        .filter(|c| column_rank(board, &c.column) == 0)
        .map(|c| c.id.clone())
        .collect();
    Ok(BoardOut::Board(BoardDetailOut {
        slug: slug.to_string(),
        name: board.name.clone(),
        path: board_path(slug),
        columns: columns_of(board),
        cards,
        orphan_cards,
        cloud_only_skipped: skipped_paths(slug, &cloud_only),
        updated: board.updated.clone(),
        dry_run,
    }))
}

impl Render for BoardOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        match self {
            BoardOut::List(l) => {
                for b in &l.items {
                    writeln!(w, "{}\t{}\t{}", b.slug, b.name, b.cards)?;
                }
                for p in &l.cloud_only_skipped {
                    writeln!(w, "cloud-only, skipped: {p}")?;
                }
            }
            BoardOut::Board(b) => {
                writeln!(w, "{}\t{}", b.slug, b.name)?;
                for c in &b.columns {
                    writeln!(w, "column\t{}\t{}", c.id, c.name)?;
                }
                for c in &b.cards {
                    writeln!(w, "card\t{}\t{}\t{}", c.id, c.column, c.title)?;
                }
                for id in &b.orphan_cards {
                    writeln!(w, "column missing, shown first: {id}")?;
                }
                for p in &b.cloud_only_skipped {
                    writeln!(w, "cloud-only, skipped: {p}")?;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn board_of(columns: &[(&str, &str)]) -> Board {
        Board {
            format: boards::BOARD_FORMAT,
            name: "Atlas".into(),
            columns: columns
                .iter()
                .map(|(id, name)| Column {
                    id: (*id).to_string(),
                    name: (*name).to_string(),
                })
                .collect(),
            updated: "2026-09-05T08:41:12.345Z".into(),
            extra: Default::default(),
        }
    }

    #[test]
    fn a_column_is_addressed_by_id_or_by_an_unambiguous_name() {
        let board = board_of(&[("todo", "To Do"), ("doing", "Doing")]);
        assert_eq!(resolve_column("atlas", &board, "todo").unwrap(), "todo");
        assert_eq!(resolve_column("atlas", &board, "To Do").unwrap(), "todo");
        assert_eq!(resolve_column("atlas", &board, "to do").unwrap(), "todo");
        let missing = resolve_column("atlas", &board, "nope").unwrap_err();
        assert_eq!(missing.exit, crate::error::EXIT_NOT_FOUND);
        assert_eq!(
            missing.body.path.as_deref(),
            Some("boards/atlas/board.json#columns/nope")
        );
        let twice = board_of(&[("a", "Doing"), ("b", "Doing")]);
        let e = resolve_column("atlas", &twice, "Doing").unwrap_err();
        assert_eq!(e.exit, crate::error::EXIT_CONFLICT);
        assert_eq!(e.body.candidates, vec!["a", "b"]);
        // An id always wins over a name that belongs to another column.
        let shadow = board_of(&[("doing", "To Do"), ("todo", "Doing")]);
        assert_eq!(resolve_column("atlas", &shadow, "todo").unwrap(), "todo");
    }

    #[test]
    fn the_column_list_is_json_with_unique_non_empty_ids() {
        let ok = parse_columns(r#"[{"id":"todo","name":"To Do"}]"#).unwrap();
        assert_eq!(ok.len(), 1);
        assert!(parse_columns("[]").unwrap().is_empty());
        for bad in [
            "not json",
            r#"{"id":"todo","name":"To Do"}"#,
            r#"[{"id":"","name":"x"}]"#,
            r#"[{"id":"a","name":"x"},{"id":"a","name":"y"}]"#,
        ] {
            assert_eq!(
                parse_columns(bad).unwrap_err().exit,
                crate::error::EXIT_USAGE,
                "{bad}"
            );
        }
    }
}
