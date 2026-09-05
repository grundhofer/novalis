//! Vault-wide link rewriting (PLAN.md §5.2 `notes::links`, ADR-0005 D5).
//!
//! `relink` rewrites every link form that points at an old target so it
//! points at a note's new path: `[[old]]`, `[[old|label]]`, `[[old#heading]]`,
//! `[text](old.md)` and board card `notes[]`. The caller renames first, then
//! relinks. Every note is written under its read-time precondition; the
//! operation is idempotent (a second run changes no bytes); cloud-only notes
//! are counted from `lstat` and never read (rule 7).

use std::collections::{BTreeSet, HashMap};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::boards::{self, CardChange};
use crate::error::{CoreError, CoreResult};
use crate::notes::links::{extract, Link, LinkForm, Resolution, StemIndex};
use crate::util::percent_encode_path;
use crate::vault::cloud::MaterializeOff;
use crate::vault::fs::{read_file, write_atomic};
use crate::vault::path::{
    fold, folder_of, nfc, normalize_rel, relative_from, resolve_relative, vault_note_rel,
};
use crate::vault::walk::walk_notes;

/// One rewrite. `old_target` is the literal link text to replace (wikilink
/// text or Markdown path; case-insensitive, NFC, percent-decoded; it need
/// not resolve). `old_path` is the note's former vault-relative path when
/// known: it enables `[[folder/stem]]` forms (only where they resolved
/// uniquely to that path), Markdown links resolved relative to the linking
/// note, and card `notes[]`. An `old_target` ending in `.md` is also taken as
/// `old_path`. `new_path` is the note's current vault-relative path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelinkSpec {
    pub old_target: String,
    pub old_path: Option<String>,
    pub new_path: String,
}

impl RelinkSpec {
    pub fn new(old_target: &str, new_path: &str) -> Self {
        RelinkSpec {
            old_target: old_target.to_string(),
            old_path: None,
            new_path: new_path.to_string(),
        }
    }

    pub fn with_old_path(mut self, old_path: &str) -> Self {
        self.old_path = Some(old_path.to_string());
        self
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RelinkOptions {
    /// Compute the report and `changes` without writing anything.
    pub dry_run: bool,
}

/// One changed line (`--dry-run` output shape, PLAN.md §9.1).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    pub line: usize,
    pub before: String,
    pub after: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewrittenFile {
    pub path: String,
    pub count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardUpdate {
    pub board: String,
    pub id: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkReport {
    /// Notes whose bytes changed (or would change under `dry_run`).
    pub rewritten: Vec<RewrittenFile>,
    pub cards_updated: Vec<CardUpdate>,
    /// Notes that could not be processed: not valid UTF-8.
    pub skipped: Vec<String>,
    /// Notes or cards that changed on disk between read and write.
    pub conflicts: Vec<String>,
    /// Cloud-only notes or cards, never read.
    pub cloud_only_skipped: Vec<String>,
    pub changes: Vec<Change>,
    pub dry_run: bool,
}

/// `fold(s)` without a `.md` suffix: the key both sides of a literal match
/// are reduced to.
fn literal_key(s: &str) -> String {
    let f = fold(s.trim());
    match f.strip_suffix(".md") {
        Some(k) => k.to_string(),
        None => f,
    }
}

fn is_md_path(s: &str) -> bool {
    s.len() > 3 && s[s.len() - 3..].eq_ignore_ascii_case(".md")
}

struct Matcher<'a> {
    specs: &'a [RelinkSpec],
    /// `literal_key(old_target)` → spec.
    literal: HashMap<String, usize>,
    /// `fold(old_path)` → spec.
    paths: HashMap<String, usize>,
    /// `fold(suffix form)` → spec, only for forms that resolved uniquely to
    /// the old path (an ambiguous bare stem is never rewritten by path).
    suffix: HashMap<String, usize>,
    /// The post-rename index, for the shortest unambiguous new text.
    after: StemIndex,
}

impl<'a> Matcher<'a> {
    fn build(specs: &'a [RelinkSpec], note_paths: &[String]) -> Self {
        let after = StemIndex::build(note_paths);
        let mut with_old = after.clone();
        let old_paths: Vec<Option<String>> = specs
            .iter()
            .map(|s| {
                s.old_path
                    .clone()
                    .or_else(|| is_md_path(&s.old_target).then(|| s.old_target.clone()))
                    .and_then(|p| normalize_rel(&p).ok())
                    .filter(|p| !p.is_empty())
            })
            .collect();
        for p in old_paths.iter().flatten() {
            with_old.insert(p);
        }
        let mut literal = HashMap::new();
        let mut paths = HashMap::new();
        let mut suffix = HashMap::new();
        for (i, spec) in specs.iter().enumerate() {
            literal.insert(literal_key(&spec.old_target), i);
            let Some(p) = &old_paths[i] else { continue };
            paths.insert(fold(p), i);
            let no_ext = p.strip_suffix(".md").unwrap_or(p);
            let parts: Vec<&str> = no_ext.split('/').collect();
            for n in 1..=parts.len() {
                let form = parts[parts.len() - n..].join("/");
                if matches!(with_old.resolve_wiki(&form), Resolution::Resolved(ref r) if fold(r) == fold(p))
                {
                    suffix.insert(fold(&form), i);
                }
            }
        }
        Matcher {
            specs,
            literal,
            paths,
            suffix,
            after,
        }
    }

    fn match_link(&self, note_path: &str, link: &Link) -> Option<usize> {
        match link.form {
            LinkForm::Markdown => {
                if let Some(joined) = resolve_relative(folder_of(note_path), &link.target) {
                    if let Some(&i) = self.paths.get(&fold(&joined)) {
                        return Some(i);
                    }
                }
                self.literal.get(&literal_key(&link.target)).copied()
            }
            _ => {
                let key = literal_key(&link.target);
                self.literal
                    .get(&key)
                    .or_else(|| self.suffix.get(&key))
                    .copied()
            }
        }
    }

    fn replacement(&self, note_path: &str, link: &Link, spec: usize) -> String {
        let new_path = &self.specs[spec].new_path;
        match link.form {
            LinkForm::Markdown => {
                percent_encode_path(&relative_from(folder_of(note_path), new_path))
            }
            _ => self.after.link_target_for(new_path),
        }
    }

    fn match_card_note(&self, note: &str) -> Option<&str> {
        self.paths
            .get(&fold(note))
            .map(|&i| self.specs[i].new_path.as_str())
    }
}

/// Rewrite the links of one note's text. Returns the new text and the
/// 1-based lines that changed, or `None` when nothing matched.
fn rewrite_text(text: &str, note_path: &str, m: &Matcher<'_>) -> Option<(String, BTreeSet<usize>)> {
    let links = extract(text);
    let mut edits: Vec<(&Link, String)> = Vec::new();
    for link in &links {
        if let Some(i) = m.match_link(note_path, link) {
            let after = m.replacement(note_path, link, i);
            if text[link.span.clone()] != after {
                edits.push((link, after));
            }
        }
    }
    if edits.is_empty() {
        return None;
    }
    let mut out = text.to_string();
    let mut lines = BTreeSet::new();
    for (link, after) in edits.iter().rev() {
        out.replace_range(link.span.clone(), after);
        lines.insert(link.line);
    }
    Some((out, lines))
}

/// Rewrite links for one `(old → new)` pair. See [`relink_many`].
pub fn relink(vault: &Path, spec: &RelinkSpec, opts: &RelinkOptions) -> CoreResult<RelinkReport> {
    relink_many(vault, std::slice::from_ref(spec), opts)
}

/// Rewrite links for several `(old → new)` pairs in one pass over the vault.
/// Runs under [`MaterializeOff`]; cloud-only notes are reported, never read.
/// Each note is written under its read-time precondition. Unless `dry_run`,
/// every `new_path` must be an existing note.
pub fn relink_many(
    vault: &Path,
    specs: &[RelinkSpec],
    opts: &RelinkOptions,
) -> CoreResult<RelinkReport> {
    let specs: Vec<RelinkSpec> = specs
        .iter()
        .map(|s| RelinkSpec {
            old_target: nfc(&s.old_target),
            old_path: s.old_path.as_deref().map(nfc),
            new_path: nfc(&s.new_path),
        })
        .collect();
    let mut report = RelinkReport {
        dry_run: opts.dry_run,
        ..Default::default()
    };
    if specs.is_empty() {
        return Ok(report);
    }
    for s in &specs {
        let abs = vault_note_rel(vault, &s.new_path)?;
        if !opts.dry_run && std::fs::symlink_metadata(&abs).is_err() {
            return Err(CoreError::NotFound {
                path: s.new_path.clone(),
            });
        }
    }
    let _guard = MaterializeOff::new()?;
    let notes = walk_notes(vault)?;
    let note_paths: Vec<String> = notes.iter().map(|n| n.path.clone()).collect();
    let matcher = Matcher::build(&specs, &note_paths);

    for note in &notes {
        if note.cloud_only {
            report.cloud_only_skipped.push(note.path.clone());
            continue;
        }
        let abs = vault.join(&note.path);
        let content = match read_file(&abs) {
            Ok(c) => c,
            Err(CoreError::CloudOnly { .. }) => {
                report.cloud_only_skipped.push(note.path.clone());
                continue;
            }
            Err(CoreError::NotFound { .. }) => continue,
            Err(e) => return Err(e),
        };
        if !content.utf8 {
            report.skipped.push(note.path.clone());
            continue;
        }
        let Some((new_text, lines)) = rewrite_text(&content.text, &note.path, &matcher) else {
            continue;
        };
        let before: Vec<&str> = content.text.lines().collect();
        let after: Vec<&str> = new_text.lines().collect();
        for &line in &lines {
            report.changes.push(Change {
                path: note.path.clone(),
                line,
                before: before.get(line - 1).unwrap_or(&"").to_string(),
                after: after.get(line - 1).unwrap_or(&"").to_string(),
            });
        }
        if !opts.dry_run {
            match write_atomic(&abs, new_text.as_bytes(), Some(&content.precondition())) {
                Ok(_) => {}
                Err(CoreError::Conflict { .. }) => {
                    report.conflicts.push(note.path.clone());
                    continue;
                }
                Err(e) => return Err(e),
            }
        }
        report.rewritten.push(RewrittenFile {
            path: note.path.clone(),
            count: lines.len(),
        });
    }

    if !matcher.paths.is_empty() {
        for b in boards::list_boards(vault)? {
            let (docs, cloud) = boards::list_cards_lenient(vault, &b.slug)?;
            report.cloud_only_skipped.extend(
                cloud
                    .into_iter()
                    .map(|n| format!("boards/{}/cards/{n}", b.slug)),
            );
            for d in docs {
                if d.card.is_deleted() {
                    continue;
                }
                let mut changed = false;
                let mut notes: Vec<String> = Vec::with_capacity(d.card.notes.len());
                for n in &d.card.notes {
                    let next = match matcher.match_card_note(n) {
                        Some(np) if np != n => {
                            changed = true;
                            np.to_string()
                        }
                        _ => n.to_string(),
                    };
                    if !notes.iter().any(|x| fold(x) == fold(&next)) {
                        notes.push(next);
                    }
                }
                if !changed {
                    continue;
                }
                let rel = format!("boards/{}/cards/{}.json", b.slug, d.card.id);
                if !opts.dry_run {
                    match boards::update_card(
                        vault,
                        &b.slug,
                        &d.card.id,
                        &CardChange::Notes(notes),
                        None,
                    ) {
                        Ok(_) => {}
                        Err(CoreError::Conflict { .. }) => {
                            report.conflicts.push(rel);
                            continue;
                        }
                        Err(CoreError::CloudOnly { .. }) => {
                            report.cloud_only_skipped.push(rel);
                            continue;
                        }
                        Err(e) => return Err(e),
                    }
                }
                report.cards_updated.push(CardUpdate {
                    board: b.slug.clone(),
                    id: d.card.id.clone(),
                });
            }
        }
    }
    report.cloud_only_skipped.sort();
    report.cloud_only_skipped.dedup();
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::boards::{Column, NewCard, Position};
    use crate::vault::fs::rename;

    fn write(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    fn read(root: &Path, rel: &str) -> String {
        std::fs::read_to_string(root.join(rel)).unwrap()
    }

    const REF: &str = "---\ntitle: Ref\n---\nSee [[Old Note]], [[old note|Label]] and [[Old Note#Sec]].\n\nAlso [link](../Old%20Note.md) and [[Unrelated]].\n\n```\n[[Old Note]] in a fence\n```\n`[[Old Note]]` in code\n";

    #[test]
    fn rewrites_every_form_and_is_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(root, "Old Note.md", "# Old\n");
        write(root, "Unrelated.md", "x\n");
        write(root, "notes/Ref.md", REF);
        write(root, "Other.md", "[[Unrelated]] only\n");
        rename(&root.join("Old Note.md"), &root.join("archive/New Note.md")).unwrap();
        let spec = RelinkSpec::new("Old Note", "archive/New Note.md").with_old_path("Old Note.md");

        let dry = relink(root, &spec, &RelinkOptions { dry_run: true }).unwrap();
        assert!(dry.dry_run);
        assert_eq!(
            dry.rewritten,
            vec![RewrittenFile {
                path: "notes/Ref.md".into(),
                count: 2
            }]
        );
        assert_eq!(dry.changes.len(), 2);
        assert_eq!(dry.changes[0].line, 4);
        assert_eq!(
            dry.changes[0].before,
            "See [[Old Note]], [[old note|Label]] and [[Old Note#Sec]]."
        );
        assert_eq!(
            dry.changes[0].after,
            "See [[New Note]], [[New Note|Label]] and [[New Note#Sec]]."
        );
        assert_eq!(
            dry.changes[1].after,
            "Also [link](../archive/New%20Note.md) and [[Unrelated]]."
        );
        assert_eq!(read(root, "notes/Ref.md"), REF, "dry run writes nothing");

        let real = relink(root, &spec, &RelinkOptions::default()).unwrap();
        assert_eq!(real.rewritten, dry.rewritten);
        assert!(
            real.conflicts.is_empty()
                && real.skipped.is_empty()
                && real.cloud_only_skipped.is_empty()
        );
        let after = read(root, "notes/Ref.md");
        assert_eq!(
            after,
            "---\ntitle: Ref\n---\nSee [[New Note]], [[New Note|Label]] and [[New Note#Sec]].\n\nAlso [link](../archive/New%20Note.md) and [[Unrelated]].\n\n```\n[[Old Note]] in a fence\n```\n`[[Old Note]]` in code\n"
        );
        assert_eq!(read(root, "Other.md"), "[[Unrelated]] only\n");

        let again = relink(root, &spec, &RelinkOptions::default()).unwrap();
        assert_eq!(again, RelinkReport::default(), "idempotent");
        // A literal path form works too, and a missing target is refused.
        assert!(relink(
            root,
            &RelinkSpec::new("x", "missing.md"),
            &RelinkOptions::default()
        )
        .unwrap_err()
        .is_not_found());
    }

    #[test]
    fn ambiguous_bare_stems_are_not_rewritten_by_path() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(root, "index.md", "---\ntitle: Start Here\n---\n");
        write(root, "reading/index.md", "# reading index\n");
        write(
            root,
            "a.md",
            "[[index]] [[reading/index]] [[Start Here]] [x](index.md)\n",
        );
        rename(&root.join("index.md"), &root.join("Start Here.md")).unwrap();
        let spec = RelinkSpec::new("Start Here", "Start Here.md").with_old_path("index.md");
        let r = relink(root, &spec, &RelinkOptions::default()).unwrap();
        assert_eq!(r.rewritten.len(), 1);
        assert_eq!(
            read(root, "a.md"),
            "[[index]] [[reading/index]] [[Start Here]] [x](Start%20Here.md)\n"
        );
    }

    #[test]
    fn folder_move_keeps_unique_stem_links_and_fixes_folder_forms() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(root, "projects/X.md", "# X\n");
        write(root, "a.md", "[[X]] [[projects/X]] [m](projects/X.md)\n");
        rename(&root.join("projects/X.md"), &root.join("archive/X.md")).unwrap();
        let spec = RelinkSpec::new("X", "archive/X.md").with_old_path("projects/X.md");
        let r = relink(root, &spec, &RelinkOptions::default()).unwrap();
        assert_eq!(r.rewritten[0].count, 1);
        assert_eq!(read(root, "a.md"), "[[X]] [[X]] [m](archive/X.md)\n");
    }

    #[test]
    fn cards_notes_are_rewritten_and_cloud_only_is_reported_not_read() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(root, "Old.md", "# Old\n");
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
            NewCard {
                title: "T".into(),
                column: None,
                notes: vec!["Old.md".into(), "keep.md".into()],
                position: Position::Last,
            },
        )
        .unwrap();
        // A sparse file has size > 0 and no blocks: the cloud-only stand-in.
        let sparse = std::fs::File::create(root.join("Cloud.md")).unwrap();
        sparse.set_len(1 << 16).unwrap();
        drop(sparse);
        rename(&root.join("Old.md"), &root.join("New.md")).unwrap();
        let spec = RelinkSpec::new("Old.md", "New.md");
        let r = relink(root, &spec, &RelinkOptions::default()).unwrap();
        assert_eq!(
            r.cards_updated,
            vec![CardUpdate {
                board: "atlas".into(),
                id: card.id.clone()
            }]
        );
        assert_eq!(r.cloud_only_skipped, vec!["Cloud.md"]);
        let updated = boards::read_card(root, "atlas", &card.id).unwrap().card;
        assert_eq!(updated.notes, vec!["New.md", "keep.md"]);
        assert!(updated.updated >= card.updated);
        let again = relink(root, &spec, &RelinkOptions::default()).unwrap();
        assert!(again.cards_updated.is_empty());
    }

    #[test]
    fn many_specs_in_one_pass_and_non_utf8_is_skipped() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(root, "A2.md", "");
        write(root, "B2.md", "");
        write(root, "n.md", "[[Notes on: A]] and [[B]]\n");
        std::fs::write(
            root.join("bin.md"),
            [0xff, 0xfe, b'[', b'[', b'B', b']', b']'],
        )
        .unwrap();
        let specs = vec![
            RelinkSpec::new("Notes on: A", "A2.md").with_old_path("a.md"),
            RelinkSpec::new("B", "B2.md").with_old_path("B.md"),
        ];
        let r = relink_many(root, &specs, &RelinkOptions::default()).unwrap();
        assert_eq!(r.skipped, vec!["bin.md"]);
        assert_eq!(read(root, "n.md"), "[[A2]] and [[B2]]\n");
    }
}
