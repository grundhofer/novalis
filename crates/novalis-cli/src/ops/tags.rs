//! `novalis tags` — frontmatter and inline tags with their note counts,
//! straight from the cache.

use std::io::Write;

use schemars::JsonSchema;
use serde::Serialize;

use crate::cli::TagsArgs;
use crate::ctx::Ctx;
use crate::error::CliError;
use crate::output::Render;

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct TagCount {
    pub tag: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct TagsOut {
    pub items: Vec<TagCount>,
    pub truncated: bool,
}

pub fn run(ctx: &Ctx, args: TagsArgs) -> Result<TagsOut, CliError> {
    let index = ctx.index()?;
    let mut rows: Vec<TagCount> = index
        .cache
        .tags()?
        .into_iter()
        .map(|(tag, count)| TagCount { tag, count })
        .collect();
    // Most used first, ties by name: `--limit` then means "the top N".
    rows.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.tag.cmp(&b.tag)));

    let truncated = args.limit.is_some_and(|n| rows.len() > n);
    if let Some(n) = args.limit {
        rows.truncate(n);
    }
    Ok(TagsOut {
        items: rows,
        truncated,
    })
}

impl Render for TagsOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        for item in &self.items {
            writeln!(w, "{}\t{}", item.count, item.tag)?;
        }
        if self.truncated {
            writeln!(w, "… truncated")?;
        }
        Ok(())
    }
}
