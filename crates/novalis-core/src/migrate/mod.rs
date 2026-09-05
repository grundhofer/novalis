//! One-time migration of a vault written by the old Novalis (PLAN.md §10,
//! ADR-0005). The old app resolved wikilinks by frontmatter `title`; novalis
//! resolves by file stem (D4), so a vault whose stems differ from its titles
//! has to be renamed once, with every link rewritten in the same operation.
//!
//! [`report`] is pure: it walks the vault, computes the full rename plan
//! against the **final** state, validates it all-or-nothing, and adds the
//! link rewrites (from a `relink` dry run), the sanitization map, the legacy
//! token counts and the importable Kanban columns. [`apply`] performs exactly
//! that plan: `RENAME_EXCL` renames, then one relink pass, then
//! `.novalis/vault.json`.
//!
//! Frontmatter is never rewritten and stale `modified:` values stay as they
//! are (rule 3). `@due(`/`@status(` tokens are left as inert text and only
//! counted (D18).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::boards::{self, Column};
use crate::error::{CoreError, CoreResult};
use crate::notes::frontmatter;
use crate::notes::relink::{self, Change, RelinkOptions, RelinkSpec, RewrittenFile};
use crate::vault::cloud::MaterializeOff;
use crate::vault::fs::{create_atomic, read_bytes, read_file, rename, write_atomic};
use crate::vault::path::{fold, folder_of, join_rel, nfc, stem_of};
use crate::vault::walk::walk_notes;

/// `.novalis/vault.json`, the only file v1 writes under `.novalis/` (D23).
pub const VAULT_MARKER: &str = ".novalis/vault.json";
/// The legacy preferences file, read leniently, never written.
pub const LEGACY_CONFIG: &str = ".novalis/config.json";
/// `vault.json` format stamp.
pub const VAULT_FORMAT: u32 = 1;
/// The board a legacy column import lands in.
pub const IMPORTED_BOARD_SLUG: &str = "kanban";

/// The published character map for stems (PLAN.md §10). `#` and `|` are not
/// in it: a stem containing them can never be a wikilink target, so such a
/// note is reported as [`Unlinkable`] instead of being renamed.
pub const SANITIZE_MAP: &[(char, &str)] = &[(':', " –"), ('/', "-")];

/// Characters that make a stem unusable as a wikilink target (§7.2).
pub const UNLINKABLE_CHARS: &[char] = &['#', '|'];

/// `.novalis/vault.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultMarker {
    pub format: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub migrated: Option<String>,
}

/// Why one note is renamed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RenameReason {
    /// The frontmatter title differs from the file stem.
    TitleDiffersFromStem,
    /// …and the title had to be sanitized to become a file name.
    TitleSanitized,
}

/// One planned rename.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rename {
    pub from: String,
    pub to: String,
    pub title: String,
    pub reason: RenameReason,
}

/// A note whose title can never be a wikilink target.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Unlinkable {
    pub path: String,
    pub title: String,
    /// The offending characters, in title order.
    pub chars: String,
}

/// Two notes that would end up at the same path (the plan is refused).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collision {
    pub target: String,
    /// The notes that want that target, or that already occupy it.
    pub sources: Vec<String>,
}

/// Counts of the legacy inline tokens, left in the text (D18).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyTokens {
    pub due: usize,
    pub status: usize,
}

/// What a migration would do (`--dry-run`) or did (`--apply`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrateReport {
    pub renames: Vec<Rename>,
    pub links_rewritten: Vec<RewrittenFile>,
    pub cards_updated: Vec<relink::CardUpdate>,
    pub unlinkable: Vec<Unlinkable>,
    /// Columns found in the legacy `config.json` (`--import-columns`).
    pub columns: Vec<Column>,
    pub legacy_tokens: LegacyTokens,
    /// Cloud-only notes: they cannot be read, so the plan is incomplete.
    pub cloud_only_skipped: Vec<String>,
    /// Non-empty means the whole plan is refused.
    pub collisions: Vec<Collision>,
    /// Notes whose frontmatter block does not parse as a mapping.
    pub frontmatter_failures: Vec<String>,
    pub changes: Vec<Change>,
    /// The plan is complete and internally consistent.
    pub ok: bool,
    /// The `migrated` stamp `.novalis/vault.json` already carries, if any.
    pub already_migrated: Option<String>,
    pub applied: bool,
}

/// How to migrate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigrateOptions {
    /// Rename notes whose stem differs from their frontmatter title.
    pub rename_to_title: bool,
    /// Import `taskView.kanbanColumns` into `boards/kanban/board.json`.
    pub import_columns: bool,
    /// Proceed even though cloud-only notes could not be read.
    pub force: bool,
}

impl Default for MigrateOptions {
    fn default() -> Self {
        MigrateOptions {
            rename_to_title: true,
            import_columns: false,
            force: false,
        }
    }
}

/// Apply [`SANITIZE_MAP`] and trim what a file name cannot carry. Returns
/// the sanitized stem and whether anything changed.
pub fn sanitize_stem(title: &str) -> (String, bool) {
    let mut out = String::with_capacity(title.len());
    let mut changed = false;
    for ch in nfc(title).chars() {
        match SANITIZE_MAP.iter().find(|(c, _)| *c == ch) {
            Some((_, repl)) => {
                out.push_str(repl);
                changed = true;
            }
            None if (ch as u32) < 0x20 => changed = true,
            None => out.push(ch),
        }
    }
    // Collapse the runs a replacement can create and trim what macOS and the
    // sync vendors dislike at the edges.
    while out.contains("  ") {
        out = out.replace("  ", " ");
        changed = true;
    }
    let trimmed = out.trim().trim_end_matches('.').trim_end();
    if trimmed != out {
        changed = true;
    }
    (trimmed.to_string(), changed)
}

/// The [`UNLINKABLE_CHARS`] present in `s`, in order, without duplicates.
fn unlinkable_chars(s: &str) -> String {
    let mut out = String::new();
    for ch in s.chars() {
        if UNLINKABLE_CHARS.contains(&ch) && !out.contains(ch) {
            out.push(ch);
        }
    }
    out
}

/// The legacy Kanban columns of `.novalis/config.json` (`{id, title}` in the
/// old shape). Missing or unparsable config yields an empty list.
pub fn legacy_columns(vault: &Path) -> Vec<Column> {
    let Ok((bytes, _)) = read_bytes(&vault.join(LEGACY_CONFIG)) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return Vec::new();
    };
    let Some(list) = value
        .get("taskView")
        .and_then(|t| t.get("kanbanColumns"))
        .and_then(|c| c.as_array())
    else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|c| {
            let id = c.get("id")?.as_str()?.trim();
            if id.is_empty() {
                return None;
            }
            let name = c
                .get("title")
                .or_else(|| c.get("name"))
                .and_then(|t| t.as_str())
                .unwrap_or(id);
            Some(Column {
                id: id.to_string(),
                name: name.to_string(),
            })
        })
        .collect()
}

/// The `migrated` stamp of `.novalis/vault.json`, if the file exists.
pub fn migrated_stamp(vault: &Path) -> Option<String> {
    let (bytes, _) = read_bytes(&vault.join(VAULT_MARKER)).ok()?;
    serde_json::from_slice::<VaultMarker>(&bytes).ok()?.migrated
}

/// Write `.novalis/vault.json` (idempotent; `migrated` records when the
/// vault was **first** migrated and is never cleared or re-stamped, so a
/// second `apply` on an already-migrated vault changes no bytes).
pub fn write_marker(vault: &Path, migrated: Option<&str>) -> CoreResult<VaultMarker> {
    let path = vault.join(VAULT_MARKER);
    let existing = read_bytes(&path)
        .ok()
        .and_then(|(b, _)| serde_json::from_slice::<VaultMarker>(&b).ok());
    let marker = VaultMarker {
        format: VAULT_FORMAT,
        migrated: existing
            .as_ref()
            .and_then(|m| m.migrated.clone())
            .or_else(|| migrated.map(str::to_string)),
    };
    let mut json = serde_json::to_string_pretty(&marker)?;
    json.push('\n');
    match existing {
        Some(_) => {
            let expected = crate::vault::fs::Precondition::of(&path)?;
            write_atomic(&path, json.as_bytes(), Some(&expected))?;
        }
        None => {
            create_atomic(&path, json.as_bytes())?;
        }
    }
    Ok(marker)
}

struct Note {
    path: String,
    title: String,
    cloud_only: bool,
}

fn collect_notes(vault: &Path, report: &mut MigrateReport) -> CoreResult<Vec<Note>> {
    let mut notes = Vec::new();
    for f in walk_notes(vault)? {
        if f.cloud_only {
            report.cloud_only_skipped.push(f.path.clone());
            notes.push(Note {
                path: f.path.clone(),
                title: stem_of(&f.path).to_string(),
                cloud_only: true,
            });
            continue;
        }
        let content = match read_file(&vault.join(&f.path)) {
            Ok(c) => c,
            Err(CoreError::CloudOnly { .. }) => {
                report.cloud_only_skipped.push(f.path.clone());
                notes.push(Note {
                    path: f.path.clone(),
                    title: stem_of(&f.path).to_string(),
                    cloud_only: true,
                });
                continue;
            }
            Err(CoreError::NotFound { .. }) => continue,
            Err(e) => return Err(e),
        };
        if !content.utf8 {
            notes.push(Note {
                path: f.path.clone(),
                title: stem_of(&f.path).to_string(),
                cloud_only: false,
            });
            continue;
        }
        report.legacy_tokens.due += content.text.matches("@due(").count();
        report.legacy_tokens.status += content.text.matches("@status(").count();
        if frontmatter::block_span(&content.text).is_some()
            && frontmatter::edit_key(&content.text, "title", None).is_err()
        {
            report.frontmatter_failures.push(f.path.clone());
        }
        let stem = stem_of(&f.path).to_string();
        notes.push(Note {
            path: f.path.clone(),
            title: frontmatter::read(&content.text)
                .title
                .filter(|t| !t.trim().is_empty())
                .unwrap_or(stem),
            cloud_only: false,
        });
    }
    Ok(notes)
}

/// Compute the migration plan without touching the vault.
pub fn report(vault: &Path, opts: &MigrateOptions) -> CoreResult<MigrateReport> {
    let mut report = MigrateReport {
        already_migrated: migrated_stamp(vault),
        ..Default::default()
    };
    if opts.import_columns {
        report.columns = legacy_columns(vault);
    }
    let notes = {
        let _guard = MaterializeOff::new()?;
        collect_notes(vault, &mut report)?
    };

    // Paths that stay as they are; a rename target may not land on one.
    let mut kept: HashMap<String, String> = HashMap::new();
    let mut planned: Vec<Rename> = Vec::new();
    if opts.rename_to_title {
        for n in &notes {
            let stem = stem_of(&n.path);
            let bad = unlinkable_chars(&n.title);
            if !bad.is_empty() {
                report.unlinkable.push(Unlinkable {
                    path: n.path.clone(),
                    title: n.title.clone(),
                    chars: bad,
                });
                kept.insert(fold(&n.path), n.path.clone());
                continue;
            }
            let (sanitized, changed) = sanitize_stem(&n.title);
            if sanitized.is_empty() || n.cloud_only || sanitized == stem {
                kept.insert(fold(&n.path), n.path.clone());
                continue;
            }
            // A target that differs from the source only by case or
            // normalization is still a rename; `vault::fs::rename` does it as
            // a same-inode two-step.
            let to = join_rel(folder_of(&n.path), &format!("{sanitized}.md"));
            planned.push(Rename {
                from: n.path.clone(),
                to,
                title: n.title.clone(),
                reason: if changed {
                    RenameReason::TitleSanitized
                } else {
                    RenameReason::TitleDiffersFromStem
                },
            });
        }
    } else {
        for n in &notes {
            kept.insert(fold(&n.path), n.path.clone());
        }
    }
    planned.sort_by(|a, b| a.from.cmp(&b.from));

    // Validate against the FINAL state: no two targets may collide, and no
    // target may equal a file that is not being renamed.
    let mut by_target: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for r in &planned {
        by_target
            .entry(fold(&r.to))
            .or_default()
            .push(r.from.clone());
    }
    for (target, mut sources) in by_target {
        let mut clash = Vec::new();
        if let Some(existing) = kept.get(&target) {
            clash.push(existing.clone());
        }
        if sources.len() > 1 || !clash.is_empty() {
            sources.sort();
            clash.extend(sources);
            clash.sort();
            clash.dedup();
            report.collisions.push(Collision {
                target: planned
                    .iter()
                    .find(|r| fold(&r.to) == target)
                    .map(|r| r.to.clone())
                    .unwrap_or(target),
                sources: clash,
            });
        }
    }
    report.renames = planned;
    report.ok =
        report.collisions.is_empty() && (report.cloud_only_skipped.is_empty() || opts.force);

    // The link rewrites the renames imply, from a dry run against the vault
    // as it is now (the specs carry both the old title and the old path).
    if report.ok && !report.renames.is_empty() {
        let specs = specs_for(&report.renames);
        let dry = relink::relink_many(vault, &specs, &RelinkOptions { dry_run: true })?;
        report.links_rewritten = dry.rewritten;
        report.cards_updated = dry.cards_updated;
        report.changes = dry.changes;
    }
    Ok(report)
}

fn specs_for(renames: &[Rename]) -> Vec<RelinkSpec> {
    renames
        .iter()
        .map(|r| RelinkSpec::new(&r.title, &r.to).with_old_path(&r.from))
        .collect()
}

/// Perform the plan of [`report`], all or nothing: the renames first (each
/// with `RENAME_EXCL`), then one relink pass over notes and cards, then
/// `.novalis/vault.json`. A plan with collisions, or with cloud-only notes
/// and no `force`, is refused before anything is touched.
pub fn apply(vault: &Path, opts: &MigrateOptions) -> CoreResult<MigrateReport> {
    let mut plan = report(vault, opts)?;
    if !plan.collisions.is_empty() {
        let first = &plan.collisions[0];
        return Err(CoreError::AlreadyExists {
            path: first.target.clone(),
        });
    }
    if !plan.cloud_only_skipped.is_empty() && !opts.force {
        return Err(CoreError::CloudOnly {
            path: plan.cloud_only_skipped[0].clone(),
        });
    }

    // Two-phase renames: everything goes through a temporary name first, so
    // a plan that swaps two names (a → b, b → a) never needs a free slot.
    let direct: Vec<&Rename> = plan.renames.iter().collect();
    let targets: HashSet<String> = direct.iter().map(|r| fold(&r.to)).collect();
    let mut staged: Vec<(String, String)> = Vec::new();
    for r in &direct {
        if targets.contains(&fold(&r.from)) && fold(&r.from) != fold(&r.to) {
            let tmp = join_rel(
                folder_of(&r.from),
                &format!(".novalis-migrate-{}.md", stem_of(&r.from)),
            );
            rename(&vault.join(&r.from), &vault.join(&tmp))?;
            staged.push((tmp, r.to.clone()));
        } else {
            rename(&vault.join(&r.from), &vault.join(&r.to))?;
        }
    }
    for (tmp, to) in staged {
        rename(&vault.join(&tmp), &vault.join(&to))?;
    }

    if !plan.renames.is_empty() {
        let specs = specs_for(&plan.renames);
        let done = relink::relink_many(vault, &specs, &RelinkOptions::default())?;
        plan.links_rewritten = done.rewritten;
        plan.cards_updated = done.cards_updated;
        plan.changes = done.changes;
        for p in done.cloud_only_skipped {
            if !plan.cloud_only_skipped.contains(&p) {
                plan.cloud_only_skipped.push(p);
            }
        }
    }
    if opts.import_columns && !plan.columns.is_empty() {
        import_columns(vault, &plan.columns)?;
    }
    write_marker(vault, Some(&crate::util::now_rfc3339_ms()))?;
    plan.applied = true;
    plan.ok = true;
    Ok(plan)
}

/// Create `boards/kanban/board.json` from legacy columns, or add the missing
/// columns to an existing board (never removing one: cards would be orphaned).
fn import_columns(vault: &Path, columns: &[Column]) -> CoreResult<()> {
    match boards::read_board(vault, IMPORTED_BOARD_SLUG) {
        Ok(doc) => {
            let mut merged = doc.board.columns.clone();
            for c in columns {
                if !merged.iter().any(|x| x.id == c.id) {
                    merged.push(c.clone());
                }
            }
            if merged != doc.board.columns {
                boards::set_columns(vault, IMPORTED_BOARD_SLUG, merged)?;
            }
            Ok(())
        }
        Err(e) if e.is_not_found() => {
            boards::create_board(vault, IMPORTED_BOARD_SLUG, "Kanban", columns.to_vec())?;
            Ok(())
        }
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::demo_vault_fixture;

    fn write(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    fn read(root: &Path, rel: &str) -> String {
        std::fs::read_to_string(root.join(rel)).unwrap()
    }

    fn note(title: &str, body: &str) -> String {
        format!("---\ntitle: {title}\nmodified: 2026-08-07T08:15:00+00:00\n---\n\n{body}\n")
    }

    #[test]
    fn sanitization_map_is_the_published_one() {
        assert_eq!(
            sanitize_stem("Notes on: Walden"),
            ("Notes on – Walden".into(), true)
        );
        assert_eq!(sanitize_stem("A/B testing"), ("A-B testing".into(), true));
        assert_eq!(sanitize_stem("Plain Title"), ("Plain Title".into(), false));
        assert_eq!(sanitize_stem("  padded  "), ("padded".into(), true));
        assert_eq!(sanitize_stem("trailing."), ("trailing".into(), true));
        assert_eq!(sanitize_stem("Über Nötes"), ("Über Nötes".into(), false));
        assert_eq!(unlinkable_chars("a#b|c#d"), "#|");
        assert_eq!(unlinkable_chars("clean"), "");
    }

    #[test]
    fn report_lists_renames_links_tokens_and_leaves_the_vault_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(
            root,
            "old-stem.md",
            &note("Start Here", "See [[Notes on: Walden]] @due(2026-01-01)"),
        );
        write(
            root,
            "reading/walden.md",
            &note("Notes on: Walden", "Back to [[Start Here]] @status(done)"),
        );
        write(root, "fine.md", &note("fine", "nothing to do"));
        write(root, "no-frontmatter.md", "# Just a heading\n");
        let before = read(root, "reading/walden.md");

        let r = report(root, &MigrateOptions::default()).unwrap();
        assert!(r.ok && !r.applied);
        assert_eq!(r.legacy_tokens, LegacyTokens { due: 1, status: 1 });
        let plan: Vec<(&str, &str, RenameReason)> = r
            .renames
            .iter()
            .map(|x| (x.from.as_str(), x.to.as_str(), x.reason))
            .collect();
        assert_eq!(
            plan,
            vec![
                (
                    "old-stem.md",
                    "Start Here.md",
                    RenameReason::TitleDiffersFromStem
                ),
                (
                    "reading/walden.md",
                    "reading/Notes on – Walden.md",
                    RenameReason::TitleSanitized
                ),
            ],
            "`fine.md`, the H1-only note and hidden files are untouched"
        );
        assert_eq!(
            r.links_rewritten,
            vec![RewrittenFile {
                path: "old-stem.md".into(),
                count: 1
            }],
            "only the note whose link text changes is rewritten; [[Start Here]] already matches"
        );
        assert!(r
            .changes
            .iter()
            .any(|c| c.after.contains("[[Notes on – Walden]]")));
        assert!(r.collisions.is_empty() && r.unlinkable.is_empty());
        assert_eq!(
            read(root, "reading/walden.md"),
            before,
            "report writes nothing"
        );
        assert!(!root.join(VAULT_MARKER).exists());
    }

    #[test]
    fn apply_renames_relinks_and_writes_the_marker() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(
            root,
            "old-stem.md",
            &note(
                "Start Here",
                "See [[Notes on: Walden]] and [w](reading/walden.md)",
            ),
        );
        write(
            root,
            "reading/walden.md",
            &note("Notes on: Walden", "Back to [[old-stem]]"),
        );
        boards::create_board(
            root,
            "atlas",
            "Atlas",
            vec![Column {
                id: "todo".into(),
                name: "To Do".into(),
            }],
        )
        .unwrap();
        let card = boards::add_card(
            root,
            "atlas",
            boards::NewCard {
                title: "read it".into(),
                column: None,
                notes: vec!["reading/walden.md".into()],
                position: boards::Position::Last,
            },
        )
        .unwrap();

        let r = apply(root, &MigrateOptions::default()).unwrap();
        assert!(r.applied && r.ok);
        assert!(root.join("Start Here.md").exists());
        assert!(root.join("reading/Notes on – Walden.md").exists());
        assert!(!root.join("old-stem.md").exists());
        let start = read(root, "Start Here.md");
        assert!(start.contains("[[Notes on – Walden]]"), "{start}");
        assert!(
            start.contains("[w](reading/Notes%20on%20\u{2013}%20Walden.md)"),
            "{start}"
        );
        assert!(
            start.contains("modified: 2026-08-07T08:15:00+00:00"),
            "frontmatter untouched"
        );
        assert!(read(root, "reading/Notes on – Walden.md").contains("[[Start Here]]"));
        let updated = boards::read_card(root, "atlas", &card.id).unwrap().card;
        assert_eq!(updated.notes, vec!["reading/Notes on – Walden.md"]);

        let marker: VaultMarker = serde_json::from_str(&read(root, VAULT_MARKER)).unwrap();
        assert_eq!(marker.format, VAULT_FORMAT);
        assert!(marker.migrated.is_some());
        assert_eq!(migrated_stamp(root), marker.migrated);

        // Idempotent: nothing left to do, the stamp is reported and kept.
        let again = report(root, &MigrateOptions::default()).unwrap();
        assert!(again.renames.is_empty());
        assert_eq!(again.already_migrated, marker.migrated);
        let re_applied = apply(root, &MigrateOptions::default()).unwrap();
        assert!(re_applied.renames.is_empty());
        assert_eq!(
            migrated_stamp(root),
            marker.migrated,
            "the first stamp is kept"
        );
    }

    #[test]
    fn a_colliding_plan_is_refused_whole() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(root, "a.md", &note("Same Title", "x"));
        write(root, "b.md", &note("Same Title", "y"));
        write(root, "c.md", &note("Existing", "z"));
        write(root, "Existing.md", "# already there\n");
        let r = report(root, &MigrateOptions::default()).unwrap();
        assert!(!r.ok);
        assert_eq!(r.collisions.len(), 2);
        let same = r
            .collisions
            .iter()
            .find(|c| c.target == "Same Title.md")
            .unwrap();
        assert_eq!(same.sources, vec!["a.md", "b.md"]);
        let existing = r
            .collisions
            .iter()
            .find(|c| c.target == "Existing.md")
            .unwrap();
        assert_eq!(existing.sources, vec!["Existing.md", "c.md"]);
        assert!(
            r.links_rewritten.is_empty(),
            "no relink is planned for a refused plan"
        );
        assert!(matches!(
            apply(root, &MigrateOptions::default()),
            Err(CoreError::AlreadyExists { .. })
        ));
        assert!(
            root.join("a.md").exists() && root.join("b.md").exists() && root.join("c.md").exists()
        );
        assert!(!root.join(VAULT_MARKER).exists());
    }

    #[test]
    fn a_swap_is_renamed_through_a_temporary_name() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(root, "A.md", &note("B", "i am b"));
        write(root, "B.md", &note("A", "i am a"));
        let r = apply(root, &MigrateOptions::default()).unwrap();
        assert_eq!(r.renames.len(), 2);
        assert!(read(root, "A.md").contains("i am a"));
        assert!(read(root, "B.md").contains("i am b"));
        let names: Vec<String> = crate::vault::fs::list_dir(root)
            .unwrap()
            .into_iter()
            .map(|e| e.name)
            .filter(|n| n.ends_with(".md"))
            .collect();
        assert_eq!(names, vec!["A.md", "B.md"], "no temporary file left behind");
    }

    #[test]
    fn unlinkable_titles_are_reported_and_not_renamed() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(root, "hash.md", &note("\"C# notes\"", "x"));
        write(root, "pipe.md", &note("\"a | b\"", "y"));
        let r = report(root, &MigrateOptions::default()).unwrap();
        assert!(r.renames.is_empty());
        assert_eq!(r.unlinkable.len(), 2);
        assert_eq!(r.unlinkable[0].chars, "#");
        assert_eq!(r.unlinkable[1].chars, "|");
        assert!(
            r.ok,
            "unlinkable notes do not refuse the plan, they are reported"
        );
    }

    #[test]
    fn cloud_only_notes_block_the_plan_until_forced() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(root, "old.md", &note("New Name", "x"));
        let f = std::fs::File::create(root.join("Cloud.md")).unwrap();
        f.set_len(1 << 16).unwrap();
        drop(f);
        let r = report(root, &MigrateOptions::default()).unwrap();
        assert_eq!(r.cloud_only_skipped, vec!["Cloud.md"]);
        assert!(!r.ok);
        assert!(matches!(
            apply(root, &MigrateOptions::default()),
            Err(CoreError::CloudOnly { .. })
        ));
        assert!(root.join("old.md").exists());
        let forced = MigrateOptions {
            force: true,
            ..Default::default()
        };
        let r = report(root, &forced).unwrap();
        assert!(r.ok);
        assert_eq!(r.renames.len(), 1, "the cloud-only note is never renamed");
        apply(root, &forced).unwrap();
        assert!(root.join("New Name.md").exists());
        assert!(root.join("Cloud.md").exists());
    }

    #[test]
    fn legacy_columns_are_read_leniently_and_imported_once() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(
            root,
            LEGACY_CONFIG,
            r#"{"prefsVersion":1,"taskView":{"defaultMode":"list","kanbanColumns":[
                 {"id":"backlog","title":"Backlog"},{"id":"todo","title":"To Do"},
                 {"id":"","title":"broken"},{"nope":1}]},"unknown":{"x":1}}"#,
        );
        let cols = legacy_columns(root);
        assert_eq!(
            cols,
            vec![
                Column {
                    id: "backlog".into(),
                    name: "Backlog".into()
                },
                Column {
                    id: "todo".into(),
                    name: "To Do".into()
                },
            ]
        );
        let opts = MigrateOptions {
            import_columns: true,
            ..Default::default()
        };
        let r = apply(root, &opts).unwrap();
        assert_eq!(r.columns, cols);
        let board = boards::read_board(root, IMPORTED_BOARD_SLUG).unwrap().board;
        assert_eq!(board.columns, cols);
        assert_eq!(board.name, "Kanban");
        // A second import adds nothing and never removes a column.
        boards::set_columns(
            root,
            IMPORTED_BOARD_SLUG,
            vec![Column {
                id: "extra".into(),
                name: "Extra".into(),
            }],
        )
        .unwrap();
        apply(root, &opts).unwrap();
        let ids: Vec<String> = boards::read_board(root, IMPORTED_BOARD_SLUG)
            .unwrap()
            .board
            .columns
            .into_iter()
            .map(|c| c.id)
            .collect();
        assert_eq!(ids, vec!["extra", "backlog", "todo"]);
        assert!(legacy_columns(tempfile::tempdir().unwrap().path()).is_empty());
    }

    #[test]
    fn marker_is_idempotent_and_never_clears_the_stamp() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let m = write_marker(root, None).unwrap();
        assert_eq!(
            m,
            VaultMarker {
                format: 1,
                migrated: None
            }
        );
        assert_eq!(read(root, VAULT_MARKER), "{\n  \"format\": 1\n}\n");
        write_marker(root, Some("2026-09-05T08:00:00.000Z")).unwrap();
        assert_eq!(
            migrated_stamp(root).as_deref(),
            Some("2026-09-05T08:00:00.000Z")
        );
        write_marker(root, None).unwrap();
        assert_eq!(
            migrated_stamp(root).as_deref(),
            Some("2026-09-05T08:00:00.000Z")
        );
    }

    /// The golden test of PLAN.md §10: after `migrate --apply` on a copy of
    /// the demo vault every link resolves.
    #[test]
    fn demo_vault_migrates_with_no_unresolved_links() {
        let fixture = demo_vault_fixture();
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("vault");
        copy_dir(&fixture, &root);

        let dry = report(&root, &MigrateOptions::default()).unwrap();
        assert!(dry.ok, "{:?}", dry.collisions);
        assert_eq!(
            dry.renames.len(),
            40,
            "40 of 63 stems differ from their title"
        );
        assert_eq!(
            dry.renames
                .iter()
                .filter(|r| r.reason == RenameReason::TitleSanitized)
                .count(),
            6,
            "6 titles contain a `:`"
        );
        assert_eq!(
            dry.legacy_tokens,
            LegacyTokens {
                due: 63,
                status: 67
            }
        );
        assert!(dry.unlinkable.is_empty());
        assert!(dry.frontmatter_failures.is_empty());

        let before = unresolved_targets(&root);
        assert!(
            before >= 16,
            "the fixture starts with title-only wikilinks: {before}"
        );
        let applied = apply(&root, &MigrateOptions::default()).unwrap();
        assert!(applied.applied);
        assert!(
            applied
                .links_rewritten
                .iter()
                .map(|f| f.count)
                .sum::<usize>()
                >= 16,
            "at least the 16 wikilinks of PLAN.md §10 are rewritten"
        );
        assert_eq!(
            unresolved_targets(&root),
            0,
            "no unresolved links after migrate --apply"
        );
    }

    fn copy_dir(from: &Path, to: &Path) {
        std::fs::create_dir_all(to).unwrap();
        for e in std::fs::read_dir(from).unwrap() {
            let e = e.unwrap();
            let target = to.join(e.file_name());
            if e.file_type().unwrap().is_dir() {
                copy_dir(&e.path(), &target);
            } else {
                std::fs::copy(e.path(), &target).unwrap();
            }
        }
    }

    fn unresolved_targets(root: &Path) -> usize {
        let notes = walk_notes(root).unwrap();
        let index = crate::notes::links::StemIndex::build(notes.iter().map(|n| n.path.clone()));
        let mut n = 0;
        for note in &notes {
            let text = std::fs::read_to_string(root.join(&note.path)).unwrap();
            for link in crate::notes::links::extract(&text) {
                if index.resolve(&note.path, &link).path().is_none() {
                    n += 1;
                }
            }
        }
        n
    }
}
