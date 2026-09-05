//! The disposable SQLite cache (PLAN.md §5.2 `cache`, §5.5, D7).
//!
//! One file per vault and schema, `<vaultkey>-s<schema>.sqlite`, in the given
//! app-data cache directory, so an app and a CLI on different schemas coexist
//! instead of rebuilding each other's file. Four tables: `files`, `links`,
//! `tags`, `meta`. WAL, `busy_timeout` 5 s (pattern lifted from the old
//! `index/schema.rs`).
//!
//! Single writer by construction: [`Cache`] owns its connection and every
//! mutation takes `&mut self`. There is no global lock — a second process
//! waits on SQLite's own lock for at most 5 s and then reports
//! [`CoreError::CacheBusy`].
//!
//! The incremental scan stats every note and reads a body only where
//! `(mtime, size)` changed or `cloud_only` flipped (hydration does not bump
//! mtime). Cloud-only rows carry `hash NULL` and no links or tags (rule 7).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, CoreResult};
use crate::notes::frontmatter;
use crate::notes::links::{extract, LinkForm, Resolution, StemIndex};
use crate::util::{epoch_ms, sha256_hex};
use crate::vault::cloud::MaterializeOff;
use crate::vault::fs::read_file;
use crate::vault::path::{fold, nfc, stem_of};
use crate::vault::walk::walk_notes;

/// Bumped whenever the table layout changes. It is part of the file name, so
/// a different schema is a different file and nothing is ever migrated.
pub const SCHEMA_VERSION: i64 = 1;

/// `meta` key holding the app watcher's heartbeat (ms since the epoch). The
/// CLI skips its own scan while this is younger than 10 s (PLAN.md §9.1).
pub const WATCHER_ALIVE_AT: &str = "watcher_alive_at";

/// How fresh the heartbeat must be for the app to be considered live.
pub const WATCHER_MAX_AGE: Duration = Duration::from_secs(10);

/// One row of `files`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRow {
    pub path: String,
    pub path_fold: String,
    pub mtime_ns: i64,
    pub size: u64,
    /// `None` for cloud-only files (never read, so never hashed).
    pub hash: Option<String>,
    pub title: String,
    pub stem: String,
    pub cloud_only: bool,
}

/// Where one link sits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkSource {
    pub path: String,
    /// 1-based line number.
    pub line: usize,
}

/// A link target nothing in the vault resolves to, with every place that
/// writes it (`links --unresolved`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnresolvedTarget {
    pub target: String,
    pub form: String,
    pub sources: Vec<LinkSource>,
}

/// One row of `links`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRow {
    pub src: String,
    pub target: String,
    pub form: String,
    pub line: usize,
    /// The note the link resolves to, or `None` when it does not resolve.
    pub resolved: Option<String>,
}

/// What one [`Cache::incremental_scan`] did.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    /// Notes found by the walk.
    pub scanned: usize,
    /// Bodies actually read.
    pub read: usize,
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
    /// Notes that are cloud-only placeholders right now.
    pub cloud_only: usize,
    /// Notes whose body was not valid UTF-8 (indexed without links or tags).
    pub not_utf8: usize,
}

/// First 16 hex of the SHA-256 over the NFC absolute vault path, root symlink
/// resolved once, trailing separator stripped (PLAN.md §5.5). Files below the
/// root are never canonicalized (rule 7); only the root is.
pub fn vault_key(root: &Path) -> String {
    let resolved = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let s = nfc(&resolved.to_string_lossy());
    let trimmed = s.trim_end_matches('/');
    let base = if trimmed.is_empty() { "/" } else { trimmed };
    sha256_hex(base.as_bytes())[..16].to_string()
}

/// `<vaultkey>-s<schema>.sqlite`.
pub fn cache_file_name(root: &Path) -> String {
    format!("{}-s{SCHEMA_VERSION}.sqlite", vault_key(root))
}

/// The cache file for `root` inside `cache_dir`.
pub fn cache_path(cache_dir: &Path, root: &Path) -> PathBuf {
    cache_dir.join(cache_file_name(root))
}

const CREATE_SQL: &str = "
CREATE TABLE IF NOT EXISTS files (
    path       TEXT PRIMARY KEY,
    path_fold  TEXT NOT NULL,
    mtime_ns   INTEGER NOT NULL,
    size       INTEGER NOT NULL,
    hash       TEXT,
    title      TEXT NOT NULL,
    stem       TEXT NOT NULL,
    cloud_only INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS files_fold ON files(path_fold);
CREATE INDEX IF NOT EXISTS files_stem ON files(stem);
CREATE TABLE IF NOT EXISTS links (
    src      TEXT NOT NULL,
    target   TEXT NOT NULL,
    form     TEXT NOT NULL,
    line     INTEGER NOT NULL,
    resolved TEXT
);
CREATE INDEX IF NOT EXISTS links_src ON links(src);
CREATE INDEX IF NOT EXISTS links_resolved ON links(resolved);
CREATE TABLE IF NOT EXISTS tags (
    path TEXT NOT NULL,
    tag  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tags_tag ON tags(tag);
CREATE INDEX IF NOT EXISTS tags_path ON tags(path);
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
";

/// The cache for one vault. Owns its connection; every mutation is
/// `&mut self`, which is the whole of the single-writer design.
pub struct Cache {
    conn: Connection,
    root: PathBuf,
    path: PathBuf,
}

/// What a scan learned about one note whose body it read.
struct Parsed {
    title: String,
    hash: String,
    tags: Vec<String>,
    links: Vec<(String, LinkForm, usize)>,
}

impl Cache {
    /// Open (creating it if needed) the cache file for `root` inside
    /// `cache_dir`. The directory is created; the file never lives in the
    /// synced vault (WAL corrupts under sync clients).
    pub fn open(cache_dir: &Path, root: &Path) -> CoreResult<Cache> {
        std::fs::create_dir_all(cache_dir).map_err(|e| CoreError::from_io(cache_dir, e))?;
        Cache::open_at(&cache_path(cache_dir, root), root)
    }

    /// Open a cache file by its exact path (tests, `index --status`).
    pub fn open_at(path: &Path, root: &Path) -> CoreResult<Cache> {
        let conn = Connection::open(path)?;
        conn.busy_timeout(Duration::from_secs(5))?;
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        conn.execute_batch("PRAGMA synchronous=NORMAL;")?;
        conn.execute_batch("PRAGMA foreign_keys=OFF;")?;
        let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if current != SCHEMA_VERSION && current != 0 {
            // The schema lives in the file name, so this can only be a file
            // written by a build that shared our name: start it over.
            conn.execute_batch(
                "DROP TABLE IF EXISTS files;
                 DROP TABLE IF EXISTS links;
                 DROP TABLE IF EXISTS tags;
                 DROP TABLE IF EXISTS meta;",
            )?;
        }
        conn.execute_batch(CREATE_SQL)?;
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        Ok(Cache {
            conn,
            root: root.to_path_buf(),
            path: path.to_path_buf(),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn vault_root(&self) -> &Path {
        &self.root
    }

    /// Number of indexed notes.
    pub fn file_count(&self) -> CoreResult<usize> {
        let n: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM files", [], |r| r.get(0))?;
        Ok(n as usize)
    }

    // ----- meta -------------------------------------------------------

    pub fn meta_get(&self, key: &str) -> CoreResult<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
            .optional()?)
    }

    pub fn meta_set(&mut self, key: &str, value: &str) -> CoreResult<()> {
        self.conn.execute(
            "INSERT INTO meta(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, value],
        )?;
        Ok(())
    }

    /// Record the app watcher's heartbeat.
    pub fn touch_watcher(&mut self) -> CoreResult<()> {
        let now = epoch_ms(SystemTime::now()).to_string();
        self.meta_set(WATCHER_ALIVE_AT, &now)
    }

    /// Whether the app watcher's heartbeat is younger than `max_age`.
    pub fn watcher_alive(&self, max_age: Duration) -> CoreResult<bool> {
        let Some(raw) = self.meta_get(WATCHER_ALIVE_AT)? else {
            return Ok(false);
        };
        let Ok(then) = raw.trim().parse::<i64>() else {
            return Ok(false);
        };
        let age = epoch_ms(SystemTime::now()) - then;
        Ok(age >= 0 && age <= max_age.as_millis() as i64)
    }

    // ----- reads ------------------------------------------------------

    fn row_to_file(r: &rusqlite::Row<'_>) -> rusqlite::Result<FileRow> {
        Ok(FileRow {
            path: r.get(0)?,
            path_fold: r.get(1)?,
            mtime_ns: r.get(2)?,
            size: r.get::<_, i64>(3)? as u64,
            hash: r.get(4)?,
            title: r.get(5)?,
            stem: r.get(6)?,
            cloud_only: r.get::<_, i64>(7)? != 0,
        })
    }

    const FILE_COLS: &'static str =
        "path, path_fold, mtime_ns, size, hash, title, stem, cloud_only";

    /// Every indexed note, sorted by path.
    pub fn files(&self) -> CoreResult<Vec<FileRow>> {
        let sql = format!("SELECT {} FROM files ORDER BY path", Self::FILE_COLS);
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], Self::row_to_file)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// One note by its vault-relative path (case-insensitively).
    pub fn file(&self, path: &str) -> CoreResult<Option<FileRow>> {
        let sql = format!("SELECT {} FROM files WHERE path_fold = ?1", Self::FILE_COLS);
        Ok(self
            .conn
            .query_row(&sql, [fold(path)], Self::row_to_file)
            .optional()?)
    }

    /// Notes below `folder` (`""` = the whole vault), sorted by path.
    pub fn files_in(&self, folder: &str) -> CoreResult<Vec<FileRow>> {
        let files = self.files()?;
        if folder.is_empty() {
            return Ok(files);
        }
        let prefix = format!("{}/", fold(folder.trim_end_matches('/')));
        Ok(files
            .into_iter()
            .filter(|f| f.path_fold.starts_with(&prefix))
            .collect())
    }

    /// A [`StemIndex`] over the indexed notes (link resolution without a walk).
    pub fn stem_index(&self) -> CoreResult<StemIndex> {
        let mut stmt = self.conn.prepare("SELECT path FROM files ORDER BY path")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        Ok(StemIndex::build(
            rows.collect::<rusqlite::Result<Vec<_>>>()?,
        ))
    }

    fn row_to_link(r: &rusqlite::Row<'_>) -> rusqlite::Result<LinkRow> {
        Ok(LinkRow {
            src: r.get(0)?,
            target: r.get(1)?,
            form: r.get(2)?,
            line: r.get::<_, i64>(3)? as usize,
            resolved: r.get(4)?,
        })
    }

    /// The links of one note, in line order.
    pub fn outgoing(&self, path: &str) -> CoreResult<Vec<LinkRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT src, target, form, line, resolved FROM links WHERE src = ?1 ORDER BY line, target",
        )?;
        let rows = stmt.query_map([nfc(path)], Self::row_to_link)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// The links that resolve to `path`, sorted by `(src, line)`.
    pub fn backlinks(&self, path: &str) -> CoreResult<Vec<LinkRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT src, target, form, line, resolved FROM links WHERE resolved = ?1 ORDER BY src, line",
        )?;
        let rows = stmt.query_map([nfc(path)], Self::row_to_link)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Unresolved link targets grouped by `(target, form)`, sorted.
    pub fn unresolved(&self) -> CoreResult<Vec<UnresolvedTarget>> {
        let mut stmt = self.conn.prepare(
            "SELECT src, target, form, line, resolved FROM links
             WHERE resolved IS NULL ORDER BY target, form, src, line",
        )?;
        let rows = stmt.query_map([], Self::row_to_link)?;
        let mut grouped: BTreeMap<(String, String), Vec<LinkSource>> = BTreeMap::new();
        for row in rows {
            let row = row?;
            grouped
                .entry((row.target, row.form))
                .or_default()
                .push(LinkSource {
                    path: row.src,
                    line: row.line,
                });
        }
        Ok(grouped
            .into_iter()
            .map(|((target, form), sources)| UnresolvedTarget {
                target,
                form,
                sources,
            })
            .collect())
    }

    /// Notes nothing links to, sorted by path.
    pub fn orphans(&self) -> CoreResult<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT path FROM files
             WHERE path NOT IN (SELECT resolved FROM links WHERE resolved IS NOT NULL)
             ORDER BY path",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// `(tag, count)` sorted by count descending, then tag.
    pub fn tags(&self) -> CoreResult<Vec<(String, usize)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT tag, COUNT(*) AS n FROM tags GROUP BY tag ORDER BY n DESC, tag ASC")?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as usize))
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// The tags of one note, in index order.
    pub fn tags_of(&self, path: &str) -> CoreResult<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT tag FROM tags WHERE path = ?1 ORDER BY rowid")?;
        let rows = stmt.query_map([nfc(path)], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// The notes carrying `tag` (case-insensitive), sorted by path.
    pub fn notes_with_tag(&self, tag: &str) -> CoreResult<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT DISTINCT path FROM tags WHERE LOWER(tag) = ?1 ORDER BY path")?;
        let rows = stmt.query_map([tag.to_lowercase()], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // ----- the scan ---------------------------------------------------

    /// Drop every row and scan from scratch (`index --rebuild`).
    pub fn rebuild(&mut self) -> CoreResult<ScanReport> {
        self.conn
            .execute_batch("DELETE FROM files; DELETE FROM links; DELETE FROM tags;")?;
        self.incremental_scan()
    }

    /// Stat every note, read the bodies that changed, and update the tables.
    /// Runs under [`MaterializeOff`], so a cloud-only file is never read.
    pub fn incremental_scan(&mut self) -> CoreResult<ScanReport> {
        let _guard = MaterializeOff::new()?;
        let walked = walk_notes(&self.root)?;
        let mut report = ScanReport {
            scanned: walked.len(),
            ..Default::default()
        };

        let mut known: HashMap<String, (i64, u64, bool)> = HashMap::new();
        {
            let mut stmt = self
                .conn
                .prepare("SELECT path, mtime_ns, size, cloud_only FROM files")?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)? as u64,
                    r.get::<_, i64>(3)? != 0,
                ))
            })?;
            for row in rows {
                let (path, mtime, size, cloud) = row?;
                known.insert(path, (mtime, size, cloud));
            }
        }

        // Decide what to read before touching the database: reads can be slow
        // and must not hold a write transaction open (no global lock, rule 6).
        struct Pending {
            path: String,
            mtime_ns: i64,
            size: u64,
            cloud_only: bool,
            parsed: Option<Parsed>,
        }
        let mut pending: Vec<Pending> = Vec::new();
        let mut seen: HashSet<String> = HashSet::with_capacity(walked.len());
        for f in &walked {
            seen.insert(f.path.clone());
            if f.cloud_only {
                report.cloud_only += 1;
            }
            let unchanged = matches!(
                known.get(&f.path),
                Some(&(m, s, c)) if m == f.mtime_ns && s == f.size && c == f.cloud_only
            );
            if unchanged {
                continue;
            }
            if known.contains_key(&f.path) {
                report.updated += 1;
            } else {
                report.added += 1;
            }
            let mut item = Pending {
                path: f.path.clone(),
                mtime_ns: f.mtime_ns,
                size: f.size,
                cloud_only: f.cloud_only,
                parsed: None,
            };
            if !f.cloud_only {
                match read_file(&self.root.join(&f.path)) {
                    Ok(content) => {
                        report.read += 1;
                        // Take the identity from the same read, so a file
                        // rewritten during the scan is picked up next time.
                        item.mtime_ns = content.mtime_ns;
                        item.size = content.size;
                        if content.utf8 {
                            item.parsed = Some(parse_note(&f.path, &content.text, &content.hash));
                        } else {
                            report.not_utf8 += 1;
                            item.parsed = Some(Parsed {
                                title: stem_of(&f.path).to_string(),
                                hash: content.hash,
                                tags: Vec::new(),
                                links: Vec::new(),
                            });
                        }
                    }
                    Err(CoreError::CloudOnly { .. }) => {
                        item.cloud_only = true;
                        report.cloud_only += 1;
                    }
                    Err(CoreError::NotFound { .. }) => {
                        // Deleted between the walk and the read.
                        seen.remove(&f.path);
                        continue;
                    }
                    Err(e) => return Err(e),
                }
            }
            pending.push(item);
        }

        let removed: Vec<String> = known
            .keys()
            .filter(|p| !seen.contains(*p))
            .cloned()
            .collect();
        report.removed = removed.len();
        let membership_changed = report.added > 0 || report.removed > 0;

        let tx = self.conn.transaction()?;
        {
            let mut del_file = tx.prepare("DELETE FROM files WHERE path = ?1")?;
            let mut del_links = tx.prepare("DELETE FROM links WHERE src = ?1")?;
            let mut del_tags = tx.prepare("DELETE FROM tags WHERE path = ?1")?;
            let mut ins_file = tx.prepare(
                "INSERT INTO files(path, path_fold, mtime_ns, size, hash, title, stem, cloud_only)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(path) DO UPDATE SET
                     path_fold = excluded.path_fold, mtime_ns = excluded.mtime_ns,
                     size = excluded.size, hash = excluded.hash, title = excluded.title,
                     stem = excluded.stem, cloud_only = excluded.cloud_only",
            )?;
            let mut ins_link = tx.prepare(
                "INSERT INTO links(src, target, form, line, resolved) VALUES (?1, ?2, ?3, ?4, NULL)",
            )?;
            let mut ins_tag = tx.prepare("INSERT INTO tags(path, tag) VALUES (?1, ?2)")?;

            for p in &removed {
                del_file.execute([p])?;
                del_links.execute([p])?;
                del_tags.execute([p])?;
            }
            for item in &pending {
                del_links.execute([&item.path])?;
                del_tags.execute([&item.path])?;
                let stem = stem_of(&item.path).to_string();
                let (hash, title) = match &item.parsed {
                    Some(p) => (Some(p.hash.clone()), p.title.clone()),
                    None => (None, stem.clone()),
                };
                ins_file.execute(rusqlite::params![
                    &item.path,
                    fold(&item.path),
                    item.mtime_ns,
                    item.size as i64,
                    hash,
                    title,
                    stem,
                    i64::from(item.cloud_only),
                ])?;
                let Some(parsed) = &item.parsed else { continue };
                for (target, form, line) in &parsed.links {
                    ins_link.execute(rusqlite::params![
                        &item.path,
                        target,
                        form.as_str(),
                        *line as i64
                    ])?;
                }
                for tag in &parsed.tags {
                    ins_tag.execute(rusqlite::params![&item.path, tag])?;
                }
            }
        }
        tx.commit()?;

        // Resolution depends on the whole path set, so a single added or
        // removed note can change links in files that did not change.
        if membership_changed || !pending.is_empty() {
            self.resolve_links()?;
        }
        Ok(report)
    }

    /// Recompute `links.resolved` for every row from the current path set.
    fn resolve_links(&mut self) -> CoreResult<()> {
        let index = self.stem_index()?;
        let mut rows: Vec<(i64, String, String, String)> = Vec::new();
        {
            let mut stmt = self
                .conn
                .prepare("SELECT rowid, src, target, form FROM links")?;
            let it = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })?;
            for row in it {
                rows.push(row?);
            }
        }
        let tx = self.conn.transaction()?;
        {
            let mut upd = tx.prepare("UPDATE links SET resolved = ?2 WHERE rowid = ?1")?;
            for (rowid, src, target, form) in rows {
                let resolution = match LinkForm::parse(&form) {
                    Some(LinkForm::Markdown) => index.resolve_markdown(&src, &target),
                    _ => index.resolve_wiki(&target),
                };
                let resolved = match resolution {
                    Resolution::Resolved(p) => Some(p),
                    _ => None,
                };
                upd.execute(rusqlite::params![rowid, resolved])?;
            }
        }
        tx.commit()?;
        Ok(())
    }
}

fn parse_note(path: &str, text: &str, hash: &str) -> Parsed {
    let stem = stem_of(path);
    Parsed {
        title: frontmatter::title(text, stem),
        hash: hash.to_string(),
        tags: frontmatter::all_tags(text),
        links: extract(text)
            .into_iter()
            .map(|l| (l.target, l.form, l.line))
            .collect(),
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

    fn open(dir: &Path, root: &Path) -> Cache {
        Cache::open(&dir.join("cache"), root).unwrap()
    }

    #[test]
    fn vault_key_is_stable_nfc_and_trailing_slash_insensitive() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("Über Notizen");
        std::fs::create_dir_all(&root).unwrap();
        let a = vault_key(&root);
        let b = vault_key(&tmp.path().join("Über Notizen/"));
        let nfd = tmp.path().join("U\u{0308}ber Notizen");
        assert_eq!(a.len(), 16);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(a, b, "a trailing separator must not change the key");
        assert_eq!(a, vault_key(&nfd), "NFD and NFC roots share one cache");
        assert_ne!(a, vault_key(tmp.path()));
        assert!(cache_file_name(&root).ends_with(&format!("-s{SCHEMA_VERSION}.sqlite")));
        // A symlinked root resolves to the same key as the real one.
        let link = tmp.path().join("link");
        std::os::unix::fs::symlink(&root, &link).unwrap();
        assert_eq!(vault_key(&link), a);
    }

    #[test]
    fn scan_indexes_titles_links_and_tags_then_resolves() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("vault");
        write(&root, "index.md", "---\ntitle: Start Here\ntags: [hub, work]\n---\nSee [[Atlas Overview]] and [[Missing]].\n");
        write(
            &root,
            "projects/Atlas Overview.md",
            "# Atlas\n\nBack to [x](../index.md) #project\n",
        );
        write(&root, ".novalis/vault.json", "{}");
        let mut c = open(tmp.path(), &root);
        let r = c.incremental_scan().unwrap();
        assert_eq!((r.scanned, r.added, r.read, r.removed), (2, 2, 2, 0));

        let files = c.files().unwrap();
        assert_eq!(files.len(), 2, "hidden folders are not indexed");
        assert_eq!(files[0].path, "index.md");
        assert_eq!(files[0].title, "Start Here");
        assert_eq!(files[1].title, "Atlas");
        assert_eq!(files[1].stem, "Atlas Overview");
        assert_eq!(files[1].path_fold, "projects/atlas overview.md");
        assert!(files[0].hash.is_some() && !files[0].cloud_only);
        assert_eq!(c.file("INDEX.MD").unwrap().unwrap().path, "index.md");
        assert_eq!(c.file("nope.md").unwrap(), None);

        let out = c.outgoing("index.md").unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].target, "Atlas Overview");
        assert_eq!(out[0].form, "wiki");
        assert_eq!(out[0].line, 5);
        assert_eq!(
            out[0].resolved.as_deref(),
            Some("projects/Atlas Overview.md")
        );
        assert_eq!(out[1].resolved, None);
        let back = c.backlinks("index.md").unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].src, "projects/Atlas Overview.md");
        let un = c.unresolved().unwrap();
        assert_eq!(
            un,
            vec![UnresolvedTarget {
                target: "Missing".into(),
                form: "wiki".into(),
                sources: vec![LinkSource {
                    path: "index.md".into(),
                    line: 5
                }],
            }]
        );
        assert!(c.orphans().unwrap().is_empty());
        assert_eq!(
            c.tags().unwrap(),
            vec![
                ("hub".to_string(), 1),
                ("project".to_string(), 1),
                ("work".to_string(), 1)
            ]
        );
        assert_eq!(c.notes_with_tag("WORK").unwrap(), vec!["index.md"]);
        assert_eq!(c.tags_of("index.md").unwrap(), vec!["hub", "work"]);
        assert_eq!(c.files_in("projects").unwrap().len(), 1);
        assert_eq!(c.stem_index().unwrap().len(), 2);
    }

    #[test]
    fn scan_is_incremental_and_reads_only_changed_files() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("vault");
        write(&root, "a.md", "a\n");
        write(&root, "b.md", "b\n");
        let mut c = open(tmp.path(), &root);
        assert_eq!(c.incremental_scan().unwrap().read, 2);
        let second = c.incremental_scan().unwrap();
        assert_eq!(
            (second.read, second.added, second.updated, second.removed),
            (0, 0, 0, 0)
        );
        assert_eq!(second.scanned, 2);

        write(&root, "a.md", "a changed and longer\n");
        write(&root, "c.md", "c\n");
        std::fs::remove_file(root.join("b.md")).unwrap();
        let third = c.incremental_scan().unwrap();
        assert_eq!(
            (third.read, third.added, third.updated, third.removed),
            (2, 1, 1, 1)
        );
        let paths: Vec<String> = c.files().unwrap().into_iter().map(|f| f.path).collect();
        assert_eq!(paths, vec!["a.md", "c.md"]);
        assert!(c.outgoing("b.md").unwrap().is_empty());
    }

    #[test]
    fn removing_a_note_makes_its_backlinks_unresolved_again() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("vault");
        write(&root, "a.md", "[[Target]]\n");
        write(&root, "Target.md", "t\n");
        let mut c = open(tmp.path(), &root);
        c.incremental_scan().unwrap();
        assert!(c.outgoing("a.md").unwrap()[0].resolved.is_some());
        std::fs::remove_file(root.join("Target.md")).unwrap();
        c.incremental_scan().unwrap();
        assert_eq!(c.outgoing("a.md").unwrap()[0].resolved, None);
        assert_eq!(c.orphans().unwrap(), vec!["a.md"]);
        write(&root, "Target.md", "t\n");
        c.incremental_scan().unwrap();
        assert_eq!(
            c.outgoing("a.md").unwrap()[0].resolved.as_deref(),
            Some("Target.md")
        );
    }

    #[test]
    fn cloud_only_rows_have_no_hash_and_no_links() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("vault");
        std::fs::create_dir_all(&root).unwrap();
        // A sparse file (size > 0, no blocks) is the cloud-only stand-in.
        let f = std::fs::File::create(root.join("Cloud.md")).unwrap();
        f.set_len(1 << 16).unwrap();
        drop(f);
        write(&root, "local.md", "[[Cloud]]\n");
        let mut c = open(tmp.path(), &root);
        let r = c.incremental_scan().unwrap();
        assert_eq!(r.cloud_only, 1);
        assert_eq!(r.read, 1, "the cloud-only body is never read");
        let cloud = c.file("Cloud.md").unwrap().unwrap();
        assert!(cloud.cloud_only);
        assert_eq!(cloud.hash, None);
        assert_eq!(cloud.title, "Cloud", "title falls back to the stem");
        assert!(c.outgoing("Cloud.md").unwrap().is_empty());
        // It still resolves as a link target.
        assert_eq!(
            c.outgoing("local.md").unwrap()[0].resolved.as_deref(),
            Some("Cloud.md")
        );
    }

    #[test]
    fn non_utf8_notes_are_indexed_without_links() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("vault");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("bin.md"),
            [0xff, 0xfe, b'[', b'[', b'x', b']', b']'],
        )
        .unwrap();
        let mut c = open(tmp.path(), &root);
        let r = c.incremental_scan().unwrap();
        assert_eq!(r.not_utf8, 1);
        let row = c.file("bin.md").unwrap().unwrap();
        assert!(row.hash.is_some());
        assert_eq!(row.title, "bin");
        assert!(c.outgoing("bin.md").unwrap().is_empty());
    }

    #[test]
    fn meta_heartbeat_and_reopen_keep_the_rows() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("vault");
        write(&root, "a.md", "a\n");
        let path;
        {
            let mut c = open(tmp.path(), &root);
            c.incremental_scan().unwrap();
            assert!(!c.watcher_alive(WATCHER_MAX_AGE).unwrap());
            c.touch_watcher().unwrap();
            assert!(c.watcher_alive(WATCHER_MAX_AGE).unwrap());
            c.meta_set("k", "v").unwrap();
            assert_eq!(c.meta_get("k").unwrap().as_deref(), Some("v"));
            path = c.path().to_path_buf();
        }
        assert!(path.exists());
        let mut c = Cache::open_at(&path, &root).unwrap();
        assert_eq!(c.file_count().unwrap(), 1);
        assert_eq!(c.meta_get("k").unwrap().as_deref(), Some("v"));
        assert_eq!(
            c.incremental_scan().unwrap().read,
            0,
            "reopening reuses the rows"
        );
        let r = c.rebuild().unwrap();
        assert_eq!((r.added, r.read), (1, 1));
        assert_eq!(
            c.meta_get("k").unwrap().as_deref(),
            Some("v"),
            "meta survives a rebuild"
        );
    }

    #[test]
    fn scans_the_demo_vault_fixture() {
        let fixture = demo_vault_fixture();
        let tmp = tempfile::tempdir().unwrap();
        let mut c = open(tmp.path(), &fixture);
        let r = c.incremental_scan().unwrap();
        assert_eq!(r.scanned, 63, "the demo vault has 63 notes");
        assert_eq!(r.added, 63);
        assert_eq!(r.cloud_only, 0);
        let idx = c.file("index.md").unwrap().unwrap();
        assert_eq!(idx.title, "Start Here");
        assert!(!c.tags().unwrap().is_empty());
        assert!(c.backlinks("projects/Atlas Overview.md").unwrap().len() > 1);
        // The fixture is read-only for us: a second scan reads nothing.
        assert_eq!(c.incremental_scan().unwrap().read, 0);
    }
}
