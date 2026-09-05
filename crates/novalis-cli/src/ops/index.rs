//! `novalis index --status | --rebuild` — the one command that talks about
//! the cache itself. The cache is disposable: a rebuild is never a data loss.

use std::io::Write;

use novalis_core::cache::{Cache, WATCHER_MAX_AGE};
use schemars::JsonSchema;
use serde::Serialize;

use crate::cli::IndexArgs;
use crate::ctx::{Ctx, IndexSource};
use crate::error::CliError;
use crate::output::Render;

/// The `meta` key the desktop app stamps with its own version, so `doctor`
/// and `index --status` can report skew (PLAN.md §9.2).
pub const APP_VERSION_KEY: &str = "app_version";

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct IndexOut {
    pub cache_path: String,
    pub files: usize,
    /// The cache was not refreshed by this invocation.
    pub stale: bool,
    /// "app" when the desktop watcher's heartbeat is younger than 10 s,
    /// else "scan".
    pub index_source: String,
    /// The app version recorded in the cache, null when no app has opened it.
    pub app_version: Option<String>,
    pub cli_version: String,
    #[serde(skip_serializing_if = "crate::util::is_false")]
    pub dry_run: bool,
}

pub fn run(ctx: &Ctx, args: IndexArgs) -> Result<IndexOut, CliError> {
    if args.rebuild {
        let mut cache = Cache::open(&ctx.app_data.join("cache"), &ctx.vault)?;
        let source = if cache.watcher_alive(WATCHER_MAX_AGE).unwrap_or(false) {
            IndexSource::App
        } else {
            IndexSource::Scan
        };
        if ctx.dry_run {
            return report(&cache, source, true, true);
        }
        cache.rebuild()?;
        return report(&cache, source, false, false);
    }
    let index = ctx.index()?;
    report(&index.cache, index.source, index.stale, ctx.dry_run)
}

fn report(
    cache: &Cache,
    source: IndexSource,
    stale: bool,
    dry_run: bool,
) -> Result<IndexOut, CliError> {
    Ok(IndexOut {
        cache_path: cache.path().to_string_lossy().into_owned(),
        files: cache.file_count()?,
        stale,
        index_source: source.as_str().to_string(),
        app_version: cache.meta_get(APP_VERSION_KEY)?,
        cli_version: env!("CARGO_PKG_VERSION").to_string(),
        dry_run,
    })
}

impl Render for IndexOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        writeln!(w, "cache: {}", self.cache_path)?;
        writeln!(w, "files: {}", self.files)?;
        writeln!(w, "source: {}", self.index_source)?;
        writeln!(w, "stale: {}", self.stale)?;
        writeln!(
            w,
            "versions: cli {} / app {}",
            self.cli_version,
            crate::output::or_dash(self.app_version.as_deref())
        )
    }
}
