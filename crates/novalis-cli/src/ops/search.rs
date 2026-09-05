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
        all_files: false,
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
