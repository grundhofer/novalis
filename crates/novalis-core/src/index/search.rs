//! Building/updating the index and full-text search.

use std::path::Path;

use rusqlite::{params, Connection};

use crate::error::CoreResult;
use crate::index::links;
use crate::models::{NoteSummary, SearchResult};
use crate::vault::{frontmatter, fs as vault_fs};

/// Full scan of the vault to (re)build the search index.
pub fn build_index(db: &Connection, vault: &Path) -> CoreResult<()> {
    log::info!("building full search index for vault: {}", vault.display());

    db.execute("DELETE FROM note_meta", [])?;
    db.execute("DELETE FROM notes_fts", [])?;
    db.execute("DELETE FROM links", [])?;

    let notes = vault_fs::list_notes(vault);
    for summary in &notes {
        let abs = vault.join(&summary.path);
        // Cloud-only placeholders (OneDrive/iCloud "online only") are indexed
        // from metadata alone — reading them would block on a network download.
        // Their body/tasks/links get indexed on the next reindex after the file
        // is materialized locally.
        let content = match std::fs::metadata(&abs) {
            Ok(meta) if vault_fs::is_cloud_placeholder(&meta) => String::new(),
            _ => match std::fs::read_to_string(&abs) {
                Ok(c) => c,
                Err(e) => {
                    log::warn!("could not read {}: {e}", summary.path);
                    continue;
                }
            },
        };
        if let Err(e) = index_note(db, summary, &content) {
            log::warn!("failed to index {}: {e}", summary.path);
        }
    }

    log::info!("indexed {} notes", notes.len());
    Ok(())
}

/// Upsert a single note into `note_meta`, the FTS index, and the link graph.
pub fn index_note(db: &Connection, summary: &NoteSummary, content: &str) -> CoreResult<()> {
    let tags_json = serde_json::to_string(&summary.tags).unwrap_or_else(|_| "[]".to_string());
    let (fm, body) = frontmatter::parse_frontmatter(content);

    db.execute(
        "INSERT INTO note_meta (path, title, folder, tags, created, modified, size, word_count, pinned, task_total, task_completed, cloud_only)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(path) DO UPDATE SET
            title=excluded.title, folder=excluded.folder, tags=excluded.tags,
            created=excluded.created, modified=excluded.modified, size=excluded.size,
            word_count=excluded.word_count, pinned=excluded.pinned,
            task_total=excluded.task_total, task_completed=excluded.task_completed,
            cloud_only=excluded.cloud_only",
        params![
            summary.path,
            summary.title,
            summary.folder,
            tags_json,
            summary.created,
            summary.modified,
            content.len() as i64,
            summary.word_count as i64,
            summary.pinned as i32,
            summary.task_total as i64,
            summary.task_completed as i64,
            summary.cloud_only as i32,
        ],
    )?;

    // FTS5 has no upsert — delete then insert.
    db.execute(
        "DELETE FROM notes_fts WHERE path = ?1",
        params![summary.path],
    )?;
    db.execute(
        "INSERT INTO notes_fts (title, content, tags, path) VALUES (?1, ?2, ?3, ?4)",
        params![summary.title, body, tags_json, summary.path],
    )?;

    // Inline markdown checkbox tasks.
    let tasks = crate::tasks::index::extract_tasks(content, &summary.path);
    crate::tasks::index::index_tasks(db, &summary.path, &tasks)?;

    // Outgoing wiki-links.
    let targets = links::extract_wiki_links(&body);
    links::index_links(db, &summary.path, &targets)?;

    // Calendar event, if the note's frontmatter declares one.
    let event = crate::index::events::event_from_note(&fm.extra, &summary.title, &summary.path);
    crate::index::events::index_event(db, event.as_ref(), &summary.path)?;

    Ok(())
}

/// Remove a note from all indexes.
pub fn remove_note(db: &Connection, path: &str) -> CoreResult<()> {
    db.execute("DELETE FROM note_meta WHERE path = ?1", params![path])?;
    db.execute("DELETE FROM notes_fts WHERE path = ?1", params![path])?;
    db.execute("DELETE FROM tasks WHERE source_note = ?1", params![path])?;
    db.execute("DELETE FROM links WHERE source_path = ?1", params![path])?;
    db.execute("DELETE FROM events WHERE note_path = ?1", params![path])?;
    Ok(())
}

/// FTS5 search with snippets and optional folder/tag filters.
pub fn search(
    db: &Connection,
    query: &str,
    folder: Option<&str>,
    tag: Option<&str>,
) -> CoreResult<Vec<SearchResult>> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let fts_query = query.replace('"', "\"\"");

    let mut sql = String::from(
        "SELECT f.path, f.title, snippet(notes_fts, 1, '<mark>', '</mark>', '...', 40) as snippet,
                rank
         FROM notes_fts f",
    );

    let mut conditions = vec![format!("notes_fts MATCH '\"{}\"'", fts_query)];

    if let Some(folder_filter) = folder {
        conditions.push(format!(
            "f.path LIKE '{}%'",
            folder_filter.replace('\'', "''")
        ));
    }
    if let Some(tag_filter) = tag {
        conditions.push(format!(
            "f.tags LIKE '%\"{}%'",
            tag_filter.replace('\'', "''")
        ));
    }

    sql.push_str(" WHERE ");
    sql.push_str(&conditions.join(" AND "));
    sql.push_str(" ORDER BY rank LIMIT 50");

    let mut stmt = db.prepare(&sql)?;
    let results = stmt
        .query_map([], |row| {
            Ok(SearchResult {
                path: row.get(0)?,
                title: row.get(1)?,
                snippet: row.get(2)?,
                score: row.get::<_, f64>(3)?.abs(),
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(results)
}

/// Quick fuzzy search by filename/title for the quick-switcher.
pub fn quick_search(db: &Connection, query: &str) -> CoreResult<Vec<NoteSummary>> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let pattern = format!("%{}%", query.replace('%', "\\%"));

    let mut stmt = db.prepare(
        "SELECT path, title, folder, tags, created, modified, pinned, word_count, task_total, task_completed, cloud_only
         FROM note_meta
         WHERE title LIKE ?1 OR path LIKE ?1
         ORDER BY modified DESC
         LIMIT 20",
    )?;

    crate::index::rows_to_summaries(&mut stmt, params![pattern])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::schema;

    fn mem_db() -> Connection {
        let dir = std::env::temp_dir().join(format!("novalis-idx-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        schema::open_db(&dir.join("notes.db")).unwrap()
    }

    fn summary(path: &str, title: &str) -> NoteSummary {
        NoteSummary {
            path: path.to_string(),
            title: title.to_string(),
            folder: String::new(),
            tags: vec![],
            created: String::new(),
            modified: String::new(),
            pinned: false,
            word_count: 0,
            task_total: 0,
            task_completed: 0,
            cloud_only: false,
        }
    }

    #[test]
    fn index_and_full_text_search() {
        let db = mem_db();
        index_note(
            &db,
            &summary("notes/alpha.md", "Alpha"),
            "---\ntitle: Alpha\n---\nThe quick brown fox jumps.",
        )
        .unwrap();
        index_note(
            &db,
            &summary("notes/beta.md", "Beta"),
            "---\ntitle: Beta\n---\nA lazy dog sleeps.",
        )
        .unwrap();

        let hits = search(&db, "fox", None, None).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "notes/alpha.md");

        let quick = quick_search(&db, "bet").unwrap();
        assert_eq!(quick.len(), 1);
        assert_eq!(quick[0].title, "Beta");
    }

    #[test]
    fn cloud_only_flag_round_trips_through_the_index() {
        let db = mem_db();
        let mut s = summary("a.md", "A");
        s.cloud_only = true;
        index_note(&db, &s, "").unwrap();
        index_note(&db, &summary("b.md", "B"), "hello").unwrap();

        let all = crate::index::list_summaries(&db).unwrap();
        assert!(all.iter().find(|n| n.path == "a.md").unwrap().cloud_only);
        assert!(!all.iter().find(|n| n.path == "b.md").unwrap().cloud_only);
    }

    #[test]
    fn remove_note_clears_index() {
        let db = mem_db();
        index_note(&db, &summary("a.md", "A"), "hello world").unwrap();
        remove_note(&db, "a.md").unwrap();
        assert!(search(&db, "hello", None, None).unwrap().is_empty());
    }
}
