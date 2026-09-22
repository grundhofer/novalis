//! `novalis search <query>` — the on-demand parallel scan (D7). The cache is
//! only consulted for a `--tag` filter.

use std::io::Write;

use novalis_core::search::{search_collect, SearchQuery};
use novalis_core::vault::path::normalize_rel;
use schemars::JsonSchema;
use serde::Serialize;

use crate::cli::SearchArgs;
use crate::ctx::Ctx;
use crate::error::CliError;
use crate::output::Render;

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct SearchItem {
    pub path: String,
    /// 1-based line number.
    pub line: usize,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SearchOut {
    pub items: Vec<SearchItem>,
    pub truncated: bool,
    /// Cloud placeholders the scan never read.
    pub cloud_only_skipped: usize,
    /// Files skipped as binary or not UTF-8 (`--all-files`; ADR-0022).
    pub not_utf8_skipped: usize,
}

pub fn run(ctx: &Ctx, args: SearchArgs) -> Result<SearchOut, CliError> {
    if args.query.trim().is_empty() {
        return Err(CliError::usage("empty search query"));
    }
    let folder = match args.folder.as_deref() {
        Some(f) => Some(normalize_rel(f)?),
        None => None,
    };
    let query = SearchQuery {
        query: args.query.clone(),
        regex: false,
        case_sensitive: false,
        folder,
        tag: args.tag.clone(),
        // Deliberately no core limit: the scan's workers stop in an arbitrary
        // order, so a limit applied inside it would decide *which* hits
        // survive by thread timing. `--limit` is applied below, after the
        // sort, which is what makes two runs of the same search agree
        // (PLAN.md §9.1, "deterministic sort orders").
        limit: None,
        snippets: args.snippets,
        // Unfiltered by design: an agent wants everything the vault holds,
        // where the app keeps to what its tree lists (ADR-0022 point 5).
        all_files: args.all_files,
    };

    // A tag filter is answered from the cache; without one the scan needs no
    // cache at all, and none is opened.
    let index = match args.tag {
        Some(_) => Some(ctx.index()?),
        None => None,
    };
    let (hits, report) = search_collect(&ctx.vault, &query, index.as_ref().map(|i| &i.cache))?;

    let truncated = hits.len() > args.limit;
    let mut items: Vec<SearchItem> = hits
        .into_iter()
        .map(|h| SearchItem {
            path: h.path,
            line: h.line,
            snippet: h.snippet,
        })
        .collect();
    items.truncate(args.limit);

    Ok(SearchOut {
        items,
        truncated,
        cloud_only_skipped: report.cloud_only_skipped,
        not_utf8_skipped: report.not_utf8_skipped,
    })
}

impl Render for SearchOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        for item in &self.items {
            writeln!(w, "{}:{}:{}", item.path, item.line, item.snippet)?;
        }
        if self.truncated {
            writeln!(w, "… truncated")?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    use super::run;
    use crate::cli::{Cli, Command};
    use crate::ctx::Ctx;

    fn search(vault: &std::path::Path, extra: &[&str]) -> super::SearchOut {
        let argv = [&["novalis", "search", "needle"], extra].concat();
        let Command::Search(args) = Cli::try_parse_from(argv).expect("parse").command else {
            unreachable!()
        };
        run(
            &Ctx::new(vault.to_path_buf(), true, false, true, true),
            args,
        )
        .expect("search")
    }

    /// `--all-files` reaches every regular file; without it a `.txt` next
    /// to the notes is invisible, and a binary is counted, never read.
    #[test]
    fn all_files_widens_the_scan_and_counts_what_it_cannot_read() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("vault");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("a.md"), "a needle\n").unwrap();
        std::fs::write(root.join("b.txt"), "b needle\n").unwrap();
        std::fs::write(root.join("c.bin"), b"needle\0needle").unwrap();

        let notes = search(&root, &[]);
        assert_eq!(
            notes
                .items
                .iter()
                .map(|i| i.path.as_str())
                .collect::<Vec<_>>(),
            ["a.md"]
        );
        assert_eq!(notes.not_utf8_skipped, 0);

        let all = search(&root, &["--all-files"]);
        assert_eq!(
            all.items
                .iter()
                .map(|i| i.path.as_str())
                .collect::<Vec<_>>(),
            ["a.md", "b.txt"]
        );
        assert_eq!(all.not_utf8_skipped, 1);
        assert_eq!(all.cloud_only_skipped, 0);
    }
}
