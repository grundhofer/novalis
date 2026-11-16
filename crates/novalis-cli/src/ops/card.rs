//! `novalis card` — the cards of a vault: list them, add one, move it, change
//! its title, its description or its note references, tombstone it (PLAN.md
//! §9.2).
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
use crate::ops::board::{board_key, board_path, read_board, resolve_column, sort_by_columns};
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
    /// Markdown text under the title; absent when the card has none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Free tags (ADR-0054); absent when the card has none.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub labels: Vec<String>,
    /// The due date, `YYYY-MM-DD` (ADR-0054); absent when none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due: Option<String>,
    /// `high`, `medium` or `low` (ADR-0054); absent when none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    /// Who the card is with (ADR-0054); absent when nobody.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
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
    /// Boxed: a card is far larger than the list's handful of pointers.
    Card(Box<CardOneOut>),
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
        description: card.description.clone(),
        labels: card.labels.clone(),
        due: card.due.clone(),
        priority: card.priority.clone(),
        assignee: card.assignee.clone(),
        deleted: card.deleted.clone(),
    }
}

fn one(slug: &str, card: &Card, dry_run: bool) -> CardOut {
    CardOut::Card(Box::new(CardOneOut {
        card: card_view(slug, card),
        dry_run,
    }))
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
    // A card the app moved to another board (ADR-0019) leaves a tombstone
    // behind for up to 30 days: the live copy is the card, the tombstone is
    // not a second one.
    if found.len() > 1 && found.iter().filter(|(_, d)| !d.card.is_deleted()).count() == 1 {
        found.retain(|(_, d)| !d.card.is_deleted());
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

/// The live card behind `id`: a tombstone (`card rm`, or the source of a
/// move to another board) is not there to change any more, so `mv`, `set`
/// and `rm` answer it like an id nothing holds (exit 3). Changing it would
/// rewrite a card no list shows, and a second `rm` would restart its 30 days.
fn find_live(ctx: &Ctx, id: &str) -> Result<(String, CardDoc), CliError> {
    let (slug, doc) = find(ctx, id)?;
    if doc.card.is_deleted() {
        return Err(CliError::from_core(CoreError::NotFound {
            path: format!("{}/cards/{id}.json", board_path(&slug)),
        })
        .with_hint("the card was removed; `card ls` lists the live ones"));
    }
    Ok((slug, doc))
}

/// A card title: text that is not only blanks (an empty title is no card
/// anyone can find again).
fn title_arg(title: &str) -> Result<String, CliError> {
    if title.trim().is_empty() {
        return Err(CliError::usage("--title must not be empty"));
    }
    Ok(title.to_string())
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

/// Every live card's note references, as `(board, card id, note path)`.
/// Lenient: a card file that is cloud-only or does not parse is left out
/// rather than failing a read-only answer (`links --orphans`, `rm`).
pub fn card_note_refs(ctx: &Ctx) -> Result<Vec<(String, String, String)>, CliError> {
    let mut out = Vec::new();
    for b in boards::list_boards(&ctx.vault)? {
        let (docs, _cloud_only, _unreadable) = boards::list_cards_lenient(&ctx.vault, &b.slug)?;
        for d in docs.into_iter().filter(|d| !d.card.is_deleted()) {
            for note in &d.card.notes {
                out.push((b.slug.clone(), d.card.id.clone(), note.clone()));
            }
        }
    }
    Ok(out)
}

/// A `--priority` value: one of the three steps, or empty for none where
/// `none` is allowed (`card set`).
fn priority_arg(value: &str, none_clears: bool) -> Result<String, CliError> {
    let v = value.trim().to_lowercase();
    if boards::PRIORITIES.contains(&v.as_str()) {
        return Ok(v);
    }
    if none_clears && (v.is_empty() || v == "none") {
        return Ok(String::new());
    }
    Err(CliError::usage(format!(
        "--priority must be high, medium or low{}: {value}",
        if none_clears { " (or none)" } else { "" }
    )))
}

/// A `--due` value: a real day `YYYY-MM-DD`, or empty to clear where allowed.
fn due_arg(value: &str, empty_clears: bool) -> Result<String, CliError> {
    let v = value.trim();
    if (empty_clears && v.is_empty()) || novalis_core::util::is_iso_day(v) {
        return Ok(v.to_string());
    }
    Err(CliError::usage(format!(
        "--due must be a day YYYY-MM-DD: {value}"
    )))
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
        Some(slug) => vec![crate::ops::board::board_key(slug)?],
        None => boards::list_boards(&ctx.vault)?
            .into_iter()
            .map(|b| b.slug)
            .collect(),
    };
    let note = match &args.note {
        Some(reference) => Some(fold(&ctx.resolve_note(reference)?)),
        None => None,
    };
    let priority = match &args.priority {
        Some(p) => Some(priority_arg(p, false)?),
        None => None,
    };
    let label = args.label.as_deref().map(fold);
    // Due days compare as text: `YYYY-MM-DD` sorts like the days it names.
    let today = novalis_core::util::local_iso_day(0);
    let week_end = novalis_core::util::local_iso_day(7);
    let due = match args.due.as_deref() {
        None => None,
        Some(w @ ("overdue" | "today" | "7d" | "none")) => Some(w),
        Some(other) => {
            return Err(CliError::usage(format!(
                "--due must be overdue, today, 7d or none: {other}"
            )))
        }
    };

    let mut items = Vec::new();
    let mut cloud_only_skipped = Vec::new();
    for slug in &slugs {
        let board = read_board(ctx, slug)?;
        let (docs, cloud_only, _unreadable) = boards::list_cards_lenient(&ctx.vault, slug)?;
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
            if label
                .as_ref()
                .is_some_and(|key| !card.labels.iter().any(|l| &fold(l) == key))
            {
                continue;
            }
            if priority.is_some() && card.priority != priority {
                continue;
            }
            if args.assignee.is_some() && card.assignee != args.assignee {
                continue;
            }
            let day = card.due.as_deref();
            let due_ok = match due {
                None => true,
                Some("none") => day.is_none(),
                Some("overdue") => day.is_some_and(|d| d < today.as_str()),
                Some("today") => day == Some(today.as_str()),
                Some(_) => day.is_some_and(|d| d >= today.as_str() && d < week_end.as_str()),
            };
            if !due_ok {
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

fn add(ctx: &Ctx, mut args: CardAddArgs) -> Result<CardOut, CliError> {
    args.board = board_key(&args.board)?;
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
        title: title_arg(&args.title)?,
        column,
        notes,
        position: position_of(&args.position),
        description: args.description.clone(),
        labels: args.labels.clone(),
        due: args.due.as_deref().map(|d| due_arg(d, false)).transpose()?,
        priority: args
            .priority
            .as_deref()
            .map(|p| priority_arg(p, false))
            .transpose()?,
        assignee: args.assignee.clone(),
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
        return Ok(CardOut::Card(Box::new(CardOneOut {
            card: CardView {
                board: args.board.clone(),
                id: String::new(),
                title: new.title,
                column,
                order: String::new(),
                notes: new.notes,
                created: now.clone(),
                updated: now,
                description: new.description.filter(|d| !d.is_empty()),
                labels: tidy_labels(&new.labels),
                due: new.due.filter(|d| !d.is_empty()),
                priority: new.priority,
                assignee: new
                    .assignee
                    .map(|a| a.trim().to_string())
                    .filter(|a| !a.is_empty()),
                deleted: None,
            },
            dry_run: true,
        })));
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
    let (slug, doc) = find_live(ctx, &args.id)?;
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

/// Labels as the store keeps them: trimmed, empty ones left out, each once
/// regardless of case, in the order given.
fn tidy_labels(labels: &[String]) -> Vec<String> {
    let mut kept: Vec<String> = Vec::new();
    for label in labels
        .iter()
        .map(|l| novalis_core::vault::path::nfc(l.trim()))
    {
        if !label.is_empty() && !kept.iter().any(|k| fold(k) == fold(&label)) {
            kept.push(label);
        }
    }
    kept
}

fn set(ctx: &Ctx, args: CardSetArgs) -> Result<CardOut, CliError> {
    if args.title.is_none()
        && args.description.is_none()
        && args.add_note.is_empty()
        && args.rm_note.is_empty()
        && args.label.is_empty()
        && args.add_label.is_empty()
        && args.rm_label.is_empty()
        && args.due.is_none()
        && args.priority.is_none()
        && args.assignee.is_none()
    {
        return Err(CliError::usage(
            "card set needs --title, --description, --add-note, --rm-note, --label, --add-label, --rm-label, --due, --priority or --assignee",
        ));
    }
    // Checked before anything is written: a bad value fails the whole call.
    let due = args.due.as_deref().map(|d| due_arg(d, true)).transpose()?;
    let priority = args
        .priority
        .as_deref()
        .map(|p| priority_arg(p, true))
        .transpose()?;
    let (slug, doc) = find_live(ctx, &args.id)?;
    // One file per change, in a fixed order: the title, the description, then
    // the references that go away, then the ones that arrive.
    let mut changes: Vec<CardChange> = Vec::new();
    if let Some(title) = &args.title {
        changes.push(CardChange::Title(title_arg(title)?));
    }
    if let Some(d) = &args.description {
        changes.push(CardChange::Description(d.clone()));
    }
    for n in &args.rm_note {
        changes.push(CardChange::RemoveNote(resolve_stale_note(ctx, n)?));
    }
    for n in &args.add_note {
        changes.push(CardChange::AddNote(ctx.resolve_note(n)?));
    }
    // Then the fields of ADR-0054. The labels are one change, the whole list:
    // replaced by --label, or the card's own with --rm-label and --add-label.
    if !args.label.is_empty() {
        changes.push(CardChange::Labels(args.label.clone()));
    } else if !args.add_label.is_empty() || !args.rm_label.is_empty() {
        let gone: Vec<String> = args.rm_label.iter().map(|l| fold(l.trim())).collect();
        let mut labels: Vec<String> = doc
            .card
            .labels
            .iter()
            .filter(|l| !gone.contains(&fold(l)))
            .cloned()
            .collect();
        labels.extend(args.add_label.iter().cloned());
        changes.push(CardChange::Labels(labels));
    }
    if let Some(d) = due {
        changes.push(CardChange::Due(d));
    }
    if let Some(p) = priority {
        changes.push(CardChange::Priority(p));
    }
    if let Some(a) = &args.assignee {
        changes.push(CardChange::Assignee(a.clone()));
    }
    apply(ctx, &slug, &args.id, doc, changes, args.if_updated)
}

fn rm(ctx: &Ctx, args: CardRmArgs) -> Result<CardOut, CliError> {
    let (slug, doc) = find_live(ctx, &args.id)?;
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

    /// ADR-0054: the four fields are new keys in the card's JSON, absent
    /// while empty, so an untouched card prints as before.
    #[test]
    fn card_view_carries_the_fields_only_when_set() {
        let mut card = Card {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FAV".into(),
            title: "A".into(),
            column: "todo".into(),
            order: "a0".into(),
            notes: vec![],
            created: "2026-09-05T08:41:12.345Z".into(),
            updated: "2026-09-05T08:41:12.345Z".into(),
            description: None,
            labels: vec![],
            due: None,
            priority: None,
            assignee: None,
            deleted: None,
            extra: Default::default(),
        };
        let plain = serde_json::to_value(card_view("atlas", &card)).unwrap();
        for key in ["labels", "due", "priority", "assignee"] {
            assert!(plain.get(key).is_none(), "{key}");
        }
        card.labels = vec!["Kunde".into()];
        card.due = Some("2026-11-20".into());
        card.priority = Some("high".into());
        card.assignee = Some("Anna".into());
        let full = serde_json::to_value(card_view("atlas", &card)).unwrap();
        assert_eq!(full["labels"], serde_json::json!(["Kunde"]));
        assert_eq!(full["due"], "2026-11-20");
        assert_eq!(full["priority"], "high");
        assert_eq!(full["assignee"], "Anna");
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
            description: None,
            labels: vec![],
            due: None,
            priority: None,
            assignee: None,
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
