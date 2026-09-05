//! `novalis ls [folder]` — the cache-backed note listing of PLAN.md §9.2.

use std::io::Write;

use novalis_core::vault::path::{fold, folder_of, normalize_rel};
use schemars::JsonSchema;
use serde::Serialize;

use crate::cli::{LsArgs, LsSort};
use crate::ctx::Ctx;
use crate::error::CliError;
use crate::output::Render;
use crate::util::ns_to_rfc3339;

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LsItem {
    pub path: String,
    pub stem: String,
    pub title: String,
    pub link_target: String,
    /// The vault-relative folder, empty at the root.
    pub folder: String,
    pub tags: Vec<String>,
    /// The file mtime, RFC 3339 with milliseconds.
    pub modified: String,
    pub size: u64,
    /// From the cache; null for cloud-only notes, which are never read.
    pub sha256: Option<String>,
    pub cloud_only: bool,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct LsOut {
    pub items: Vec<LsItem>,
    pub truncated: bool,
}

/// The keys `--fields` may name.
pub const FIELDS: &[&str] = &[
    "path",
    "stem",
    "title",
    "linkTarget",
    "folder",
    "tags",
    "modified",
    "size",
    "sha256",
    "cloudOnly",
];

pub fn run(ctx: &Ctx, args: LsArgs) -> Result<LsOut, CliError> {
    for f in &args.fields {
        if !FIELDS.contains(&f.as_str()) {
            return Err(CliError::usage(format!(
                "unknown field `{f}`; known fields are {}",
                FIELDS.join(", ")
            )));
        }
    }
    let index = ctx.index()?;
    let cache = &index.cache;
    let stems = cache.stem_index()?;

    let folder = match args.folder.as_deref() {
        Some(f) => normalize_rel(f)?,
        None => String::new(),
    };
    let mut rows = if folder.is_empty() {
        cache.files()?
    } else {
        cache.files_in(&folder)?
    };

    if let Some(tag) = args.tag.as_deref() {
        let wanted: Vec<String> = cache
            .notes_with_tag(tag)?
            .into_iter()
            .map(|p| fold(&p))
            .collect();
        rows.retain(|r| wanted.contains(&fold(&r.path)));
    }

    match args.sort {
        LsSort::Path => rows.sort_by(|a, b| a.path.cmp(&b.path)),
        LsSort::Title => rows.sort_by(|a, b| {
            fold(&a.title)
                .cmp(&fold(&b.title))
                .then_with(|| a.path.cmp(&b.path))
        }),
        // Newest first: that is the only useful order for a timestamp.
        LsSort::Modified => rows.sort_by(|a, b| {
            b.mtime_ns
                .cmp(&a.mtime_ns)
                .then_with(|| a.path.cmp(&b.path))
        }),
        LsSort::Size => rows.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.path.cmp(&b.path))),
    }

    let truncated = args.limit.is_some_and(|n| rows.len() > n);
    if let Some(n) = args.limit {
        rows.truncate(n);
    }

    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let tags = cache.tags_of(&row.path)?;
        items.push(LsItem {
            link_target: stems.link_target_for(&row.path),
            folder: folder_of(&row.path).to_string(),
            modified: ns_to_rfc3339(row.mtime_ns),
            size: row.size,
            sha256: row.hash,
            cloud_only: row.cloud_only,
            stem: row.stem,
            title: row.title,
            tags,
            path: row.path,
        });
    }
    Ok(LsOut { items, truncated })
}

impl Render for LsOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        for item in &self.items {
            let flag = if item.cloud_only { " (cloud-only)" } else { "" };
            writeln!(w, "{}\t{}{}", item.path, item.title, flag)?;
        }
        if self.truncated {
            writeln!(w, "… truncated")?;
        }
        Ok(())
    }
}

/// The plain `--tree` rendering: one indented line per path component.
pub fn render_tree(out: &LsOut, w: &mut dyn Write) -> std::io::Result<()> {
    let mut shown: Vec<String> = Vec::new();
    for item in &out.items {
        let parts: Vec<&str> = item.path.split('/').collect();
        for depth in 0..parts.len() {
            let prefix = parts[..=depth].join("/");
            if shown.contains(&prefix) {
                continue;
            }
            shown.push(prefix);
            let pad = "  ".repeat(depth);
            let leaf = parts[depth];
            if depth + 1 == parts.len() {
                writeln!(w, "{pad}{leaf}\t{}", item.title)?;
            } else {
                writeln!(w, "{pad}{leaf}/")?;
            }
        }
    }
    if out.truncated {
        writeln!(w, "… truncated")?;
    }
    Ok(())
}
