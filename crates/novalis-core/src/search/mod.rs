//! On-demand full-text search (PLAN.md §5.2 `search`, D7): no index, no FTS
//! table, no body duplication. Every call walks the vault with readdir +
//! lstat, then reads the matching files in parallel.
//!
//! Parallelism uses scoped OS threads rather than a pool: the materialize-off
//! policy is per OS thread, and rule 7 forbids leaving it on a pooled thread,
//! so each worker installs its own [`MaterializeOff`] guard for exactly its
//! own lifetime. Cloud-only notes are counted from `lstat` and never opened.
//!
//! Results are streamed to the caller's callback as they are found (order is
//! therefore arbitrary); [`search_collect`] gathers and sorts them.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

use crate::cache::Cache;
use crate::error::{CoreError, CoreResult};
use crate::vault::cloud::MaterializeOff;
use crate::vault::fs::read_file;
use crate::vault::path::{fold, is_note_name};
use crate::vault::walk::walk_files;

/// Longest snippet returned per hit (characters, not bytes).
pub const SNIPPET_MAX_CHARS: usize = 200;

/// What to look for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchQuery {
    /// The literal text, or a regular expression when `regex` is set.
    pub query: String,
    pub regex: bool,
    pub case_sensitive: bool,
    /// Only notes below this vault-relative folder.
    pub folder: Option<String>,
    /// Only notes carrying this tag (needs the cache).
    pub tag: Option<String>,
    /// Stop after this many hits and report `truncated`.
    pub limit: Option<usize>,
    /// Include the matching line as a snippet.
    pub snippets: bool,
    /// Search every file, not just `.md` notes.
    pub all_files: bool,
}

impl SearchQuery {
    /// A literal, case-insensitive query over the notes of the whole vault.
    pub fn new(query: impl Into<String>) -> Self {
        SearchQuery {
            query: query.into(),
            regex: false,
            case_sensitive: false,
            folder: None,
            tag: None,
            limit: None,
            snippets: true,
            all_files: false,
        }
    }
}

/// One matching line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    /// 1-based line number.
    pub line: usize,
    pub snippet: String,
}

/// What the scan covered.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchReport {
    /// Files whose body was read.
    pub scanned: usize,
    /// Files skipped because they are cloud-only placeholders.
    pub cloud_only_skipped: usize,
    /// Files skipped because they are not valid UTF-8.
    pub not_utf8_skipped: usize,
    pub matches: usize,
    /// The limit was reached and the scan stopped early.
    pub truncated: bool,
}

fn build_regex(q: &SearchQuery) -> CoreResult<Regex> {
    if q.query.is_empty() {
        return Err(CoreError::parse(None, "empty search query"));
    }
    let pattern = if q.regex {
        q.query.clone()
    } else {
        regex::escape(&q.query)
    };
    RegexBuilder::new(&pattern)
        .case_insensitive(!q.case_sensitive)
        .size_limit(1 << 22)
        .build()
        .map_err(|e| CoreError::parse(None, e.to_string()))
}

fn snippet_of(line: &str, at: usize, want: bool) -> String {
    if !want {
        return String::new();
    }
    let trimmed = line.trim();
    if trimmed.chars().count() <= SNIPPET_MAX_CHARS {
        return trimmed.to_string();
    }
    // Centre the window on the match, on character boundaries.
    let match_char = line[..at.min(line.len())].chars().count();
    let start_char = match_char.saturating_sub(SNIPPET_MAX_CHARS / 3);
    let out: String = line
        .chars()
        .skip(start_char)
        .take(SNIPPET_MAX_CHARS)
        .collect();
    let prefix = if start_char > 0 { "…" } else { "" };
    format!("{prefix}{}", out.trim())
}

/// Scan `root` and hand every hit to `on_hit`, which returns `false` to stop.
/// With `cache`, a `tag` filter is answered from the cache (no extra reads).
/// Runs one guarded worker thread per core; the caller's thread does no IO.
pub fn search(
    root: &Path,
    query: &SearchQuery,
    cache: Option<&Cache>,
    on_hit: &mut (dyn FnMut(SearchHit) -> bool + Send),
) -> CoreResult<SearchReport> {
    let re = build_regex(query)?;
    let tag_filter: Option<Vec<String>> = match (&query.tag, cache) {
        (Some(tag), Some(cache)) => {
            Some(cache.notes_with_tag(tag)?.iter().map(|p| fold(p)).collect())
        }
        (Some(_), None) => {
            return Err(CoreError::internal("tag filter needs an open cache"));
        }
        (None, _) => None,
    };
    let folder_prefix = query
        .folder
        .as_ref()
        .map(|f| format!("{}/", fold(f.trim_end_matches('/'))))
        .filter(|f| f != "/");

    let mut report = SearchReport::default();
    let mut candidates = Vec::new();
    for f in walk_files(root)? {
        if !query.all_files && !is_note_name(&f.path) {
            continue;
        }
        let key = fold(&f.path);
        if let Some(prefix) = &folder_prefix {
            if !key.starts_with(prefix.as_str()) {
                continue;
            }
        }
        if let Some(tags) = &tag_filter {
            if !tags.iter().any(|p| p == &key) {
                continue;
            }
        }
        if f.cloud_only {
            report.cloud_only_skipped += 1;
            continue;
        }
        candidates.push(f.path);
    }

    let next = AtomicUsize::new(0);
    let stop = AtomicBool::new(false);
    let scanned = AtomicUsize::new(0);
    let not_utf8 = AtomicUsize::new(0);
    let cloud = AtomicUsize::new(0);
    let matches = AtomicUsize::new(0);
    let sink = Mutex::new(on_hit);
    let error: Mutex<Option<CoreError>> = Mutex::new(None);
    let limit = query.limit.unwrap_or(usize::MAX);
    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(candidates.len().max(1));

    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| {
                // One guard per worker thread, dropped with the thread.
                let _guard = match MaterializeOff::new() {
                    Ok(g) => g,
                    Err(e) => {
                        *error.lock().unwrap() = Some(e);
                        stop.store(true, Ordering::Relaxed);
                        return;
                    }
                };
                loop {
                    if stop.load(Ordering::Relaxed) {
                        break;
                    }
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some(rel) = candidates.get(i) else { break };
                    let content = match read_file(&root.join(rel)) {
                        Ok(c) => c,
                        Err(CoreError::CloudOnly { .. }) => {
                            cloud.fetch_add(1, Ordering::Relaxed);
                            continue;
                        }
                        Err(CoreError::NotFound { .. }) => continue,
                        Err(e) => {
                            *error.lock().unwrap() = Some(e);
                            stop.store(true, Ordering::Relaxed);
                            break;
                        }
                    };
                    scanned.fetch_add(1, Ordering::Relaxed);
                    if !content.utf8 {
                        not_utf8.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                    for (n, line) in content.text.lines().enumerate() {
                        let Some(m) = re.find(line) else { continue };
                        let hit = SearchHit {
                            path: rel.clone(),
                            line: n + 1,
                            snippet: snippet_of(line, m.start(), query.snippets),
                        };
                        // Counting, the limit check and the callback happen
                        // under one lock, so `stop` is honoured by every
                        // worker at once: exactly `limit` hits are emitted
                        // and nothing follows a `false` from the callback.
                        let mut cb = sink.lock().unwrap();
                        if stop.load(Ordering::Relaxed) {
                            break;
                        }
                        let seen = matches.load(Ordering::Relaxed);
                        if seen >= limit {
                            stop.store(true, Ordering::Relaxed);
                            break;
                        }
                        matches.store(seen + 1, Ordering::Relaxed);
                        if !(cb)(hit) {
                            stop.store(true, Ordering::Relaxed);
                            break;
                        }
                    }
                }
            });
        }
    });

    if let Some(e) = error.lock().unwrap().take() {
        return Err(e);
    }
    report.scanned = scanned.load(Ordering::Relaxed);
    report.cloud_only_skipped += cloud.load(Ordering::Relaxed);
    report.not_utf8_skipped = not_utf8.load(Ordering::Relaxed);
    report.matches = matches.load(Ordering::Relaxed);
    report.truncated = stop.load(Ordering::Relaxed) && report.matches >= limit;
    Ok(report)
}

/// [`search`] into a `Vec`, sorted by `(path, line)` so output is
/// deterministic regardless of how the work was split.
pub fn search_collect(
    root: &Path,
    query: &SearchQuery,
    cache: Option<&Cache>,
) -> CoreResult<(Vec<SearchHit>, SearchReport)> {
    let mut hits = Vec::new();
    let report = search(root, query, cache, &mut |h| {
        hits.push(h);
        true
    })?;
    hits.sort_by(|a, b| (&a.path, a.line).cmp(&(&b.path, b.line)));
    Ok((hits, report))
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

    fn vault() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(root, "a.md", "first line\nlocal-first software\nlast\n");
        write(
            root,
            "sub/b.md",
            "---\ntags: [work]\n---\nLOCAL-FIRST again\nnope\n",
        );
        write(root, "sub/c.md", "nothing here\n");
        write(root, "notes.txt", "local-first in a text file\n");
        write(root, ".hidden/d.md", "local-first hidden\n");
        tmp
    }

    #[test]
    fn finds_literal_matches_case_insensitively_across_folders() {
        let tmp = vault();
        let (hits, report) =
            search_collect(tmp.path(), &SearchQuery::new("local-first"), None).unwrap();
        assert_eq!(
            hits,
            vec![
                SearchHit {
                    path: "a.md".into(),
                    line: 2,
                    snippet: "local-first software".into()
                },
                SearchHit {
                    path: "sub/b.md".into(),
                    line: 4,
                    snippet: "LOCAL-FIRST again".into()
                },
            ]
        );
        assert_eq!(report.matches, 2);
        assert_eq!(report.scanned, 3, "only .md notes, hidden folders skipped");
        assert_eq!(report.cloud_only_skipped, 0);
        assert!(!report.truncated);

        let mut q = SearchQuery::new("local-first");
        q.case_sensitive = true;
        let (hits, _) = search_collect(tmp.path(), &q, None).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "a.md");

        let mut q = SearchQuery::new("local-first");
        q.all_files = true;
        let (hits, _) = search_collect(tmp.path(), &q, None).unwrap();
        assert_eq!(hits.len(), 3);
    }

    #[test]
    fn regex_folder_and_limit() {
        let tmp = vault();
        let mut q = SearchQuery::new(r"^l.*software$");
        q.regex = true;
        let (hits, _) = search_collect(tmp.path(), &q, None).unwrap();
        assert_eq!(hits.len(), 1, "`^`/`$` anchor per line, not per file");
        assert_eq!(hits[0].path, "a.md");
        q.query = r"^local-first .*$".into();
        let (hits, _) = search_collect(tmp.path(), &q, None).unwrap();
        assert_eq!(hits.len(), 2, "the regex is case-insensitive by default");

        let mut q = SearchQuery::new("local-first");
        q.folder = Some("sub".into());
        let (hits, _) = search_collect(tmp.path(), &q, None).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "sub/b.md");

        let mut q = SearchQuery::new("local-first");
        q.limit = Some(1);
        let (hits, report) = search_collect(tmp.path(), &q, None).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(report.truncated);

        let mut q = SearchQuery::new("x");
        q.regex = true;
        q.query = "(unclosed".into();
        assert!(matches!(
            search_collect(tmp.path(), &q, None),
            Err(CoreError::Parse { .. })
        ));
        assert!(matches!(
            search_collect(tmp.path(), &SearchQuery::new(""), None),
            Err(CoreError::Parse { .. })
        ));
    }

    #[test]
    fn tag_filter_uses_the_cache_and_is_refused_without_one() {
        let tmp = vault();
        let cache_dir = tempfile::tempdir().unwrap();
        let mut cache = Cache::open(cache_dir.path(), tmp.path()).unwrap();
        cache.incremental_scan().unwrap();
        let mut q = SearchQuery::new("local-first");
        q.tag = Some("work".into());
        let (hits, _) = search_collect(tmp.path(), &q, Some(&cache)).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "sub/b.md");
        assert!(matches!(
            search_collect(tmp.path(), &q, None),
            Err(CoreError::Internal(_))
        ));
    }

    #[test]
    fn cloud_only_files_are_reported_and_never_read() {
        let tmp = vault();
        let f = std::fs::File::create(tmp.path().join("Cloud.md")).unwrap();
        f.set_len(1 << 16).unwrap();
        drop(f);
        let (hits, report) =
            search_collect(tmp.path(), &SearchQuery::new("local-first"), None).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(report.cloud_only_skipped, 1);
        assert_eq!(report.scanned, 3);
    }

    #[test]
    fn callback_can_stop_the_scan_and_snippets_are_bounded() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..40 {
            write(
                tmp.path(),
                &format!("n{i:02}.md"),
                "needle here\nneedle again\n",
            );
        }
        write(
            tmp.path(),
            "long.md",
            &format!("{} needle {}", "x".repeat(500), "y".repeat(500)),
        );
        let mut seen = 0;
        let report = search(tmp.path(), &SearchQuery::new("needle"), None, &mut |_| {
            seen += 1;
            seen < 5
        })
        .unwrap();
        assert_eq!(seen, 5);
        assert!(report.matches >= 5);

        let (hits, _) = search_collect(tmp.path(), &SearchQuery::new("needle"), None).unwrap();
        let long = hits.iter().find(|h| h.path == "long.md").unwrap();
        assert!(
            long.snippet.chars().count() <= SNIPPET_MAX_CHARS + 1,
            "{}",
            long.snippet.len()
        );
        assert!(long.snippet.starts_with('…'));
        assert!(long.snippet.contains("needle"));
        // 40 files × 2 lines + the long file.
        assert_eq!(hits.len(), 81);
    }

    #[test]
    fn every_worker_restores_the_thread_policy_it_found() {
        let tmp = vault();
        assert!(crate::vault::cloud::materialize_is_default());
        search_collect(tmp.path(), &SearchQuery::new("local-first"), None).unwrap();
        assert!(
            crate::vault::cloud::materialize_is_default(),
            "the caller's thread policy must be untouched"
        );
    }

    #[test]
    fn searches_the_demo_vault_fixture() {
        let fixture = demo_vault_fixture();
        let (hits, report) = search_collect(&fixture, &SearchQuery::new("@status("), None).unwrap();
        assert_eq!(report.scanned, 63);
        assert_eq!(
            hits.len(),
            67,
            "the legacy @status( token count of PLAN.md §10"
        );
        assert!(
            hits.windows(2)
                .all(|w| (&w[0].path, w[0].line) < (&w[1].path, w[1].line)),
            "search_collect returns a deterministic (path, line) order"
        );
    }
}
