//! `novalis doctor` — read-only diagnostics (D: `doctor --fix` was declined).
//! Every check the plan names is one row; `ok` is true only when all of them
//! are clean, so an agent's first call tells it whether there is work.

use std::io::Write;

use novalis_core::boards;
use novalis_core::migrate::{self, MigrateOptions};
use novalis_core::notes::links::extract_destinations;
use novalis_core::vault::cloud;
use novalis_core::vault::fs::{read_text, TextRead};
use novalis_core::vault::path::{fold, folder_of, resolve_relative};
use novalis_core::vault::walk::{walk_files, walk_notes};
use schemars::JsonSchema;
use serde::Serialize;

use crate::ctx::Ctx;
use crate::error::CliError;
use crate::ops::index::APP_VERSION_KEY;
use crate::output::Render;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Ok,
    Warn,
    Fail,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct Check {
    pub id: String,
    pub status: Status,
    pub detail: String,
    /// The vault paths behind a count, where a check names them (ADR-0042).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct DoctorOut {
    pub ok: bool,
    pub checks: Vec<Check>,
}

fn check(id: &str, status: Status, detail: impl Into<String>) -> Check {
    Check {
        id: id.to_string(),
        status,
        detail: detail.into(),
        paths: Vec::new(),
    }
}

fn count(id: &str, n: usize, detail: impl Into<String>) -> Check {
    check(id, if n == 0 { Status::Ok } else { Status::Warn }, detail)
}

pub fn run(ctx: &Ctx, _args: ()) -> Result<DoctorOut, CliError> {
    let mut checks = Vec::new();

    checks.push(if ctx.vault.join(migrate::VAULT_MARKER).is_file() {
        check("vault_marker", Status::Ok, "the vault marker is present")
    } else {
        check(
            "vault_marker",
            Status::Warn,
            "no .novalis/vault.json; run `novalis init <dir>`",
        )
    });

    let index = ctx.index();
    let cache = match &index {
        Ok(i) => {
            checks.push(check(
                "cache",
                Status::Ok,
                format!("{} notes indexed", i.cache.file_count().unwrap_or(0)),
            ));
            Some(&i.cache)
        }
        Err(e) => {
            checks.push(check("cache", Status::Fail, e.body.message.clone()));
            None
        }
    };

    let cli_version = env!("CARGO_PKG_VERSION");
    checks.push(
        match cache.and_then(|c| c.meta_get(APP_VERSION_KEY).ok().flatten()) {
            None => check(
                "version_skew",
                Status::Ok,
                format!("cli {cli_version}; no app version recorded"),
            ),
            Some(app) if app == cli_version => check(
                "version_skew",
                Status::Ok,
                format!("cli and app are both {cli_version}"),
            ),
            Some(app) => check(
                "version_skew",
                Status::Warn,
                format!("cli {cli_version} but the app wrote {app}"),
            ),
        },
    );

    // One read pass over the vault answers three of the plan's rows.
    let plan = migrate::report(
        &ctx.vault,
        &MigrateOptions {
            rename_to_title: false,
            import_columns: false,
            force: true,
        },
    )?;
    checks.push(count(
        "frontmatter",
        plan.frontmatter_failures.len(),
        format!(
            "{} note(s) whose frontmatter is not a plain mapping",
            plan.frontmatter_failures.len()
        ),
    ));

    match cache {
        Some(c) => {
            let unresolved = c.unresolved()?;
            checks.push(count(
                "unresolved_links",
                unresolved.len(),
                format!("{} link target(s) resolve to nothing", unresolved.len()),
            ));
        }
        None => checks.push(check(
            "unresolved_links",
            Status::Warn,
            "not checked: the cache did not open",
        )),
    }

    let stems = ctx.stem_index()?;
    let duplicates = stems.duplicates();
    checks.push(count(
        "duplicate_stems",
        duplicates.len(),
        format!(
            "{} stem(s) shared by more than one note; link them as [[folder/stem]]",
            duplicates.len()
        ),
    ));
    let unlinkable = stems.unlinkable();
    checks.push(count(
        "unlinkable_stems",
        unlinkable.len(),
        format!(
            "{} stem(s) contain # or | and can never be linked",
            unlinkable.len()
        ),
    ));

    let notes_in_boards = notes_under_boards(ctx)?;
    checks.push(count(
        "notes_in_boards",
        notes_in_boards,
        format!("{notes_in_boards} note(s) live inside a board folder"),
    ));

    let copies = cloud::find_conflict_copies(&ctx.vault)?;
    checks.push(count(
        "conflict_copies",
        copies.len(),
        format!("{} conflict cop(y|ies) from the sync client", copies.len()),
    ));

    let cloud_only = match cache {
        Some(c) => c.files()?.into_iter().filter(|f| f.cloud_only).count(),
        None => 0,
    };
    checks.push(count(
        "cloud_only_links",
        cloud_only,
        format!("{cloud_only} cloud-only note(s); their links are not indexed"),
    ));

    let legacy = plan.legacy_tokens.due + plan.legacy_tokens.status;
    checks.push(count(
        "legacy_tokens",
        legacy,
        format!(
            "{} @due( and {} @status( token(s) from the old app, left as text",
            plan.legacy_tokens.due, plan.legacy_tokens.status
        ),
    ));

    let (dead, orphans) = attachments(ctx)?;
    let mut attachment_check = count(
        "attachments",
        dead.len() + orphans.len(),
        format!(
            "{} link(s) to a missing attachment, {} attachment(s) no note links",
            dead.len(),
            orphans.len()
        ),
    );
    attachment_check.paths = dead.into_iter().chain(orphans).collect();
    checks.push(attachment_check);

    let ok = checks.iter().all(|c| c.status == Status::Ok);
    Ok(DoctorOut { ok, checks })
}

/// The file types a note carries as attachments (ADR-0017, ADR-0041).
const ATTACHMENT_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "pdf"];

fn is_attachment(path: &str) -> bool {
    path.rsplit_once('.')
        .is_some_and(|(_, ext)| ATTACHMENT_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

/// The attachment check (ADR-0042): links from notes to an attachment type
/// that is not on disk (`note → target`), and files in an `attachments/`
/// folder that no note links to. Every readable note is read — the cache
/// indexes only note links — and cloud-only notes are not: an attachment
/// only they link to counts as unlinked, which the detail cannot tell apart.
fn attachments(ctx: &Ctx) -> Result<(Vec<String>, Vec<String>), CliError> {
    let _guard = novalis_core::vault::cloud::MaterializeOff::new()?;
    let mut linked = std::collections::BTreeSet::new();
    let mut dead = Vec::new();
    for note in walk_notes(&ctx.vault)? {
        if note.cloud_only {
            continue;
        }
        let Ok(TextRead::Text(content)) = read_text(&ctx.vault.join(&note.path)) else {
            continue;
        };
        for link in extract_destinations(&content.text) {
            if !is_attachment(&link.target) {
                continue;
            }
            let Some(target) = resolve_relative(folder_of(&note.path), &link.target) else {
                continue;
            };
            if ctx.vault.join(&target).exists() {
                linked.insert(fold(&target));
            } else {
                dead.push(format!("{} → {}", note.path, target));
            }
        }
    }
    let orphans = walk_files(&ctx.vault)?
        .into_iter()
        .filter(|f| {
            is_attachment(&f.path)
                && f.path.split('/').rev().nth(1) == Some("attachments")
                && !linked.contains(&fold(&f.path))
        })
        .map(|f| f.path)
        .collect();
    Ok((dead, orphans))
}

/// `.md` files that sit inside a folder holding a valid `board.json`. Other
/// files under `boards/` are ordinary notes (PLAN.md §5.5).
fn notes_under_boards(ctx: &Ctx) -> Result<usize, CliError> {
    let prefix = format!("{}/", boards::BOARDS_DIR);
    let mut n = 0;
    for note in walk_notes(&ctx.vault)? {
        let Some(rest) = note.path.strip_prefix(&prefix) else {
            continue;
        };
        let Some(slug) = rest.split('/').next() else {
            continue;
        };
        if boards::is_board_dir(&ctx.vault.join(&prefix).join(slug)) {
            n += 1;
        }
    }
    Ok(n)
}

impl Render for DoctorOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        for c in &self.checks {
            let mark = match c.status {
                Status::Ok => "ok  ",
                Status::Warn => "warn",
                Status::Fail => "fail",
            };
            writeln!(w, "{mark} {:<18} {}", c.id, c.detail)?;
            for path in &c.paths {
                writeln!(w, "       {path}")?;
            }
        }
        writeln!(w, "{}", if self.ok { "ok" } else { "needs attention" })
    }
}
