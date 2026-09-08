//! `novalis card` — the cards of a vault: list them, add one, move it, change
//! its title or its note references, tombstone it (PLAN.md §9.2).
//!
//! Every mutation is one field-level change through `novalis_core::boards`,
//! which writes one card file under its read-time precondition and replays a
//! conflicting write. `--if-updated` is the agent's own precondition on top:
//! the store refuses (exit 4) when the card's `updated` moved on.

use std::io::Write;

use novalis_core::boards::{self, Card, CardChange, CardDoc, NewCard, Position};
use novalis_core::vault::path::fold;
use novalis_core::CoreError;
use schemars::JsonSchema;
use serde::Serialize;

use crate::cli::{
    CardAddArgs, CardArgs, CardCommand, CardLsArgs, CardMvArgs, CardRmArgs, CardSetArgs,
    PositionArgs,
};
use crate::ctx::Ctx;
use crate::error::{CliError, EXIT_NOT_FOUND};
use crate::ops::board::{board_path, read_board, resolve_column, sort_by_columns};
use crate::output::Render;

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CardView {
    pub board: String,
    /// The ULID. Absent only on `card add --dry-run`, where no file is
    /// written and the id would be invented.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub id: String,
    pub title: String,
    pub column: String,
    /// The fractional-index key; cards sort by `(order, id)`. Absent on
    /// `card add --dry-run` for the same reason as `id`.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub order: String,
    /// Vault-relative note paths.
    pub notes: Vec<String>,
    pub created: String,
    pub updated: String,
    /// The tombstone stamp, on a card `card rm` has removed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<String>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CardListOut {
    pub items: Vec<CardView>,
    pub truncated: bool,
    /// Card files that are online only and were therefore never read.
    pub cloud_only_skipped: Vec<String>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CardOneOut {
    pub card: CardView,
    /// Nothing was written. The card is reported as it stands on disk, since
    /// the id, the order key and `updated` are decided by the write itself.
    #[serde(skip_serializing_if = "crate::util::is_false")]
    pub dry_run: bool,
}

/// `card` has two shapes; which one is decided by the subcommand, so the JSON
/// is untagged and an agent selects on the keys of the command it ran.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum CardOut {
    List(CardListOut),
    Card(CardOneOut),
}

pub fn card_view(slug: &str, card: &Card) -> CardView {
    CardView {
        board: slug.to_string(),
        id: card.id.clone(),
        title: card.title.clone(),
        column: card.column.clone(),
        order: card.order.clone(),
        notes: card.notes.clone(),
        created: card.created.clone(),
        updated: card.updated.clone(),
        deleted: card.deleted.clone(),
    }
}

fn one(slug: &str, card: &Card, dry_run: bool) -> CardOut {
    CardOut::Card(CardOneOut {
        card: card_view(slug, card),
        dry_run,
    })
}

/// `--after ID`, `--first`, `--last`; last when none was given.
fn position_of(args: &PositionArgs) -> Position {
    match (&args.after, args.first) {
        (Some(id), _) => Position::After(id.clone()),
        (None, true) => Position::First,
        (None, false) => Position::Last,
    }
}

fn given(args: &PositionArgs) -> bool {
    args.after.is_some() || args.first || args.last
}

/// The board holding `id`. Card ids are ULIDs, so `card mv/set/rm` need no
/// board argument; the same id on two boards is a conflict, never a guess.
fn find(ctx: &Ctx, id: &str) -> Result<(String, CardDoc), CliError> {
    let mut found: Vec<(String, CardDoc)> = Vec::new();
    for b in boards::list_boards(&ctx.vault)? {
        match boards::read_card(&ctx.vault, &b.slug, id) {
            Ok(doc) => found.push((b.slug, doc)),
            Err(e) if e.is_not_found() => continue,
            Err(e) => return Err(CliError::from_core(e)),
        }
    }
    match found.len() {
        1 => Ok(found.remove(0)),
        0 => Err(CliError::from_core(CoreError::NotFound {
            path: format!("cards/{id}.json"),
        })),
        _ => Err(
            CliError::conflict(format!("card {id} exists on more than one board")).with_candidates(
                found
                    .iter()
                    .map(|(slug, _)| format!("{}/cards/{id}.json", board_path(slug)))
                    .collect(),
            ),
        ),
    }
}

/// A `--rm-note` value. It resolves like every other note reference, but a
/// reference nothing resolves to is kept verbatim: a card can point at a note
/// that has since been deleted, and that is exactly what is being removed.
fn resolve_stale_note(ctx: &Ctx, reference: &str) -> Result<String, CliError> {
    match ctx.resolve_note(reference) {
        Ok(path) => Ok(path),
        Err(e) if e.exit == EXIT_NOT_FOUND => Ok(novalis_core::vault::path::nfc(reference.trim())),
        Err(e) => Err(e),
    }
}

/// A store failure with the card's own precondition flag in the hint: the
/// shared mapping names `--if-match`, which is the flag of a note.
fn card_error(e: CoreError) -> CliError {
    let mapped = CliError::from_core(e);
    if mapped.body.code == "conflict" {
        return mapped.with_hint("re-read the card and retry with the current --if-updated");
    }
    mapped
}

/// `--if-updated` on a dry run, where nothing is written and the store never
/// sees the precondition.
fn check_if_updated(card: &Card, expected: Option<&str>, slug: &str) -> Result<(), CliError> {
    let Some(expected) = expected else {
        return Ok(());
    };
    if expected == card.updated {
        return Ok(());
    }
    Err(card_error(CoreError::Conflict {
        path: format!("{}/cards/{}.json", board_path(slug), card.id),
        expected: None,
        actual: None,
    }))
}

pub fn run(ctx: &Ctx, args: CardArgs) -> Result<CardOut, CliError> {
    match args.command {
        CardCommand::Ls(a) => list(ctx, a),
        CardCommand::Add(a) => add(ctx, a),
        CardCommand::Mv(a) => mv(ctx, a),
        CardCommand::Set(a) => set(ctx, a),
        CardCommand::Rm(a) => rm(ctx, a),
    }
}

fn list(ctx: &Ctx, args: CardLsArgs) -> Result<CardOut, CliError> {
    // A named board must exist, even when it holds nothing.
    let slugs: Vec<String> = match &args.board {
        Some(slug) => vec![slug.clone()],
        None => boards::list_boards(&ctx.vault)?
            .into_iter()
            .map(|b| b.slug)
            .collect(),
    };
    let note = match &args.note {
        Some(reference) => Some(fold(&ctx.resolve_note(reference)?)),
        None => None,
    };

    let mut items = Vec::new();
    let mut cloud_only_skipped = Vec::new();
    for slug in &slugs {
        let board = read_board(ctx, slug)?;
        let (docs, cloud_only) = boards::list_cards_lenient(&ctx.vault, slug)?;
        cloud_only_skipped.extend(
            cloud_only
                .iter()
                .map(|n| format!("{}/cards/{n}", board_path(slug))),
        );
        let mut of_board: Vec<CardView> = Vec::new();
        for d in docs {
            let card = d.card;
            if card.is_deleted() {
                continue;
            }
            if args.column.as_ref().is_some_and(|c| c != &card.column) {
                continue;
            }
            if note
                .as_ref()
                .is_some_and(|key| !card.notes.iter().any(|n| &fold(n) == key))
            {
                continue;
            }
            of_board.push(card_view(slug, &card));
        }
        sort_by_columns(&board, &mut of_board);
        items.append(&mut of_board);
    }
    Ok(CardOut::List(CardListOut {
        items,
        truncated: false,
        cloud_only_skipped,
    }))
}

fn add(ctx: &Ctx, args: CardAddArgs) -> Result<CardOut, CliError> {
    let board = read_board(ctx, &args.board)?;
    let column = match &args.column {
        Some(c) => Some(resolve_column(&args.board, &board, c)?),
        None => None,
    };
    let notes = args
        .notes
        .iter()
        .map(|n| ctx.resolve_note(n))
        .collect::<Result<Vec<String>, CliError>>()?;
    let new = NewCard {
        title: args.title.clone(),
        column,
        notes,
        position: position_of(&args.position),
    };

    if ctx.dry_run {
        // Nothing is written, so there is no id and no order key: the card
        // that would be created, with the column the store would choose.
        let column = new
            .column
            .clone()
            .or_else(|| board.columns.first().map(|c| c.id.clone()))
            .ok_or_else(|| {
                CliError::not_found(format!("board `{}` has no column", args.board))
                    .with_path(format!("{}/board.json#columns", board_path(&args.board)))
            })?;
        let now = novalis_core::util::now_rfc3339_ms();
        return Ok(CardOut::Card(CardOneOut {
            card: CardView {
                board: args.board.clone(),
                id: String::new(),
                title: new.title,
                column,
                order: String::new(),
                notes: new.notes,
                created: now.clone(),
                updated: now,
                deleted: None,
            },
            dry_run: true,
        }));
    }

    let card = boards::add_card(&ctx.vault, &args.board, new)?;
    Ok(one(&args.board, &card, false))
}

fn mv(ctx: &Ctx, args: CardMvArgs) -> Result<CardOut, CliError> {
    if args.column.is_none() && !given(&args.position) {
        return Err(CliError::usage(
            "card mv needs --column, --after, --first or --last",
        ));
    }
    let (slug, doc) = find(ctx, &args.id)?;
    let column = match &args.column {
        Some(c) => Some(resolve_column(&slug, &read_board(ctx, &slug)?, c)?),
        None => None,
    };
    let change = CardChange::Move {
        column,
        position: position_of(&args.position),
    };
    apply(ctx, &slug, &args.id, doc, vec![change], args.if_updated)
}

fn set(ctx: &Ctx, args: CardSetArgs) -> Result<CardOut, CliError> {
    if args.title.is_none() && args.add_note.is_empty() && args.rm_note.is_empty() {
        return Err(CliError::usage(
            "card set needs --title, --add-note or --rm-note",
        ));
    }
    let (slug, doc) = find(ctx, &args.id)?;
    // One file per change, in a fixed order: the title, then the references
    // that go away, then the ones that arrive.
    let mut changes: Vec<CardChange> = Vec::new();
    if let Some(title) = &args.title {
        changes.push(CardChange::Title(title.clone()));
    }
    for n in &args.rm_note {
        changes.push(CardChange::RemoveNote(resolve_stale_note(ctx, n)?));
    }
    for n in &args.add_note {
        changes.push(CardChange::AddNote(ctx.resolve_note(n)?));
    }
    apply(ctx, &slug, &args.id, doc, changes, args.if_updated)
}

fn rm(ctx: &Ctx, args: CardRmArgs) -> Result<CardOut, CliError> {
    let (slug, doc) = find(ctx, &args.id)?;
    apply(
        ctx,
        &slug,
        &args.id,
        doc,
        vec![CardChange::Delete],
        args.if_updated,
    )
}

/// Write the changes one file at a time. `--if-updated` guards the first one
/// and is then carried forward from each result, so a chain of changes is as
/// tight as a single one.
fn apply(
    ctx: &Ctx,
    slug: &str,
    id: &str,
    doc: CardDoc,
    changes: Vec<CardChange>,
    if_updated: Option<String>,
) -> Result<CardOut, CliError> {
    if ctx.dry_run {
        check_if_updated(&doc.card, if_updated.as_deref(), slug)?;
        return Ok(one(slug, &doc.card, true));
    }
    let mut expected = if_updated;
    let mut card = doc.card;
    for change in &changes {
        card = boards::update_card(&ctx.vault, slug, id, change, expected.as_deref())
            .map_err(card_error)?;
        if expected.is_some() {
            expected = Some(card.updated.clone());
        }
    }
    Ok(one(slug, &card, false))
}

impl Render for CardOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        match self {
            CardOut::List(l) => {
                for c in &l.items {
                    line(w, c)?;
                }
                for p in &l.cloud_only_skipped {
                    writeln!(w, "cloud-only, skipped: {p}")?;
                }
            }
            CardOut::Card(c) => line(w, &c.card)?,
        }
        Ok(())
    }
}

fn line(w: &mut dyn Write, c: &CardView) -> std::io::Result<()> {
    let id = if c.id.is_empty() { "-" } else { &c.id };
    let state = if c.deleted.is_some() { "\tdeleted" } else { "" };
    writeln!(w, "{}/{}\t{}\t{}{}", c.board, id, c.column, c.title, state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::{Cli, Command};
    use clap::Parser;

    fn position(argv: &[&str]) -> Position {
        let cli = Cli::try_parse_from(argv).expect("parse");
        let Command::Card(args) = cli.command else {
            unreachable!()
        };
        let CardCommand::Add(add) = args.command else {
            unreachable!()
        };
        position_of(&add.position)
    }

    #[test]
    fn the_default_position_is_last() {
        let base = ["novalis", "card", "add", "b", "--title", "x"];
        assert_eq!(position(&base), Position::Last);
        assert_eq!(
            position(&[base.as_slice(), &["--first"]].concat()),
            Position::First
        );
        assert_eq!(
            position(&[base.as_slice(), &["--last"]].concat()),
            Position::Last
        );
        assert_eq!(
            position(&[base.as_slice(), &["--after", "01ARZ3NDEKTSV4RRFFQ69G5FAV"]].concat()),
            Position::After("01ARZ3NDEKTSV4RRFFQ69G5FAV".into())
        );
    }

    #[test]
    fn if_updated_is_a_conflict_on_a_dry_run_too() {
        let card = Card {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FAV".into(),
            title: "A".into(),
            column: "todo".into(),
            order: "a0".into(),
            notes: vec![],
            created: "2026-09-05T08:41:12.345Z".into(),
            updated: "2026-09-05T08:41:12.345Z".into(),
            deleted: None,
            extra: Default::default(),
        };
        assert!(check_if_updated(&card, None, "atlas").is_ok());
        assert!(check_if_updated(&card, Some(&card.updated), "atlas").is_ok());
        let e = check_if_updated(&card, Some("2020-01-01T00:00:00.000Z"), "atlas").unwrap_err();
        assert_eq!(e.exit, crate::error::EXIT_CONFLICT);
        assert_eq!(
            e.body.hint.as_deref(),
            Some("re-read the card and retry with the current --if-updated")
        );
        assert_eq!(
            e.body.path.as_deref(),
            Some("boards/atlas/cards/01ARZ3NDEKTSV4RRFFQ69G5FAV.json")
        );
    }
}
