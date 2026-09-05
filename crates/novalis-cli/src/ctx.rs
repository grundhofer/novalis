//! The invocation context: the discovered vault, the global flags, and the
//! two things every op needs — a stem index for note addressing and, for the
//! cache-backed commands, an opened cache (PLAN.md §9.1).

use std::cell::OnceCell;
use std::path::{Path, PathBuf};

use novalis_core::cache::{Cache, WATCHER_MAX_AGE};
use novalis_core::notes::links::{Resolution, StemIndex};
use novalis_core::vault::path::{nfc, normalize_rel, vault_note_rel};
use novalis_core::vault::walk::walk_notes;
use novalis_core::CoreError;

use crate::error::CliError;
use crate::output::emit_warning;

/// The application-support directory of ADR-0003. Derived from `$HOME`, which
/// is also the seam the golden tests use to keep a run's cache in its own
/// temporary directory.
pub const APP_DATA_SUFFIX: &str = "Library/Application Support/io.github.grundhofer.novalis";

/// The environment variable of PLAN.md §9.1, consulted after `--vault`.
pub const VAULT_ENV: &str = "NOVALIS_VAULT";

/// The marker file the walk-up discovery looks for (D23).
pub const VAULT_MARKER: &str = ".novalis/vault.json";

/// Where the cache row served by this invocation came from, reported by
/// `index --status` as `indexSource`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexSource {
    /// The app's watcher heartbeat is younger than 10 s; no scan was run.
    App,
    /// This process ran (or skipped, under `--no-index`) its own scan.
    Scan,
}

impl IndexSource {
    pub fn as_str(self) -> &'static str {
        match self {
            IndexSource::App => "app",
            IndexSource::Scan => "scan",
        }
    }
}

/// An opened cache plus how fresh it is.
pub struct Index {
    pub cache: Cache,
    pub source: IndexSource,
    /// The cache was not refreshed by this invocation: `--no-index`, or the
    /// scan's write step found the cache busy.
    pub stale: bool,
}

pub struct Ctx {
    /// Absolute, with the root symlink resolved once (PLAN.md §5.5).
    pub vault: PathBuf,
    pub json: bool,
    pub dry_run: bool,
    pub no_index: bool,
    pub quiet: bool,
    pub app_data: PathBuf,
    stems: OnceCell<StemIndex>,
}

impl Ctx {
    pub fn new(vault: PathBuf, json: bool, dry_run: bool, no_index: bool, quiet: bool) -> Self {
        Ctx {
            vault,
            json,
            dry_run,
            no_index,
            quiet,
            app_data: app_data_dir(),
            stems: OnceCell::new(),
        }
    }

    /// `--vault`, else `$NOVALIS_VAULT`, else the nearest ancestor of the
    /// working directory holding `.novalis/vault.json`, else exit 7.
    pub fn discover(flag: Option<&Path>) -> Result<PathBuf, CliError> {
        if let Some(dir) = flag {
            return accept_vault(dir, "--vault");
        }
        if let Some(raw) = std::env::var_os(VAULT_ENV) {
            if !raw.is_empty() {
                return accept_vault(Path::new(&raw), VAULT_ENV);
            }
        }
        let cwd = std::env::current_dir()
            .map_err(|e| CliError::internal(format!("cannot read the working directory: {e}")))?;
        let mut cur = cwd.as_path();
        loop {
            if cur.join(VAULT_MARKER).is_file() {
                return accept_vault(cur, "discovery");
            }
            match cur.parent() {
                Some(p) => cur = p,
                None => break,
            }
        }
        Err(CliError::no_vault(format!(
            "no {VAULT_MARKER} in {} or any parent",
            cwd.display()
        )))
    }

    /// The vault path guards, as a vault-relative note path. Used for targets
    /// that need not exist yet (`new`, `mv <to>`); a missing `.md` is added.
    pub fn note_target(&self, arg: &str) -> Result<String, CliError> {
        let arg = nfc(arg.trim());
        if arg.is_empty() {
            return Err(CliError::usage("empty note path"));
        }
        let with_ext = if arg.ends_with(".md") {
            arg
        } else {
            format!("{arg}.md")
        };
        vault_note_rel(&self.vault, &with_ext)?;
        Ok(normalize_rel(&with_ext)?)
    }

    /// Note addressing (PLAN.md §9.1): a vault-relative path or a stem,
    /// case-insensitive; ambiguity is a conflict with candidates.
    pub fn resolve_note(&self, arg: &str) -> Result<String, CliError> {
        let arg = nfc(arg.trim());
        if arg.is_empty() {
            return Err(CliError::usage("empty note reference"));
        }
        let stems = self.stem_index()?;
        match stems.resolve_wiki(&arg) {
            Resolution::Resolved(p) => Ok(p),
            Resolution::Ambiguous(candidates) => Err(CliError::from_core(CoreError::Ambiguous {
                name: arg,
                candidates,
            })),
            Resolution::Unresolved => Err(CliError::from_core(CoreError::NotFound { path: arg })),
        }
    }

    /// Every note of the vault, indexed for stem resolution and for the
    /// `linkTarget` of each result row. Built from one stat walk, so it is
    /// correct even when the cache is cold or `--no-index` was passed.
    pub fn stem_index(&self) -> Result<&StemIndex, CliError> {
        if let Some(idx) = self.stems.get() {
            return Ok(idx);
        }
        let paths: Vec<String> = walk_notes(&self.vault)?
            .into_iter()
            .map(|f| f.path)
            .collect();
        let _ = self.stems.set(StemIndex::build(paths));
        Ok(self
            .stems
            .get()
            .expect("the stem index was just written into the cell"))
    }

    /// The absolute path of a vault-relative note path.
    pub fn abs(&self, rel: &str) -> PathBuf {
        self.vault.join(rel)
    }

    /// Open the cache and, unless the app's watcher is live or `--no-index`
    /// was passed, run the incremental scan first. A busy cache during a read
    /// serves what is there behind a `stale_index` warning (PLAN.md §9.2).
    pub fn index(&self) -> Result<Index, CliError> {
        let mut cache = Cache::open(&self.app_data.join("cache"), &self.vault)?;
        if cache.watcher_alive(WATCHER_MAX_AGE).unwrap_or(false) {
            return Ok(Index {
                cache,
                source: IndexSource::App,
                stale: false,
            });
        }
        if self.no_index {
            return Ok(Index {
                cache,
                source: IndexSource::Scan,
                stale: true,
            });
        }
        match cache.incremental_scan() {
            Ok(_) => Ok(Index {
                cache,
                source: IndexSource::Scan,
                stale: false,
            }),
            Err(CoreError::CacheBusy) => {
                self.warn(
                    "stale_index",
                    "the cache is busy; serving the existing rows",
                );
                Ok(Index {
                    cache,
                    source: IndexSource::Scan,
                    stale: true,
                })
            }
            Err(e) => Err(CliError::from_core(e)),
        }
    }

    /// One JSON warning line on stderr, unless `--quiet`.
    pub fn warn(&self, code: &str, message: &str) {
        if !self.quiet {
            emit_warning(&mut std::io::stderr(), code, message);
        }
    }
}

/// `$HOME/Library/Application Support/io.github.grundhofer.novalis`. A missing
/// `$HOME` falls back to the working directory, which keeps the CLI usable in
/// a stripped environment instead of failing before it parses arguments.
pub fn app_data_dir() -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(APP_DATA_SUFFIX)
}

fn accept_vault(dir: &Path, source: &str) -> Result<PathBuf, CliError> {
    if !dir.is_dir() {
        return Err(CliError::no_vault(format!(
            "{source}: {} is not a directory",
            dir.display()
        )));
    }
    // Only the root is canonicalized (PLAN.md §5.5, rule 7): files below it
    // are never resolved, so a symlinked note stays a rejected path.
    Ok(std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_data_follows_home() {
        // The value is read per call, which is what lets the golden runner
        // point a whole invocation at a temporary directory.
        let dir = app_data_dir();
        assert!(dir.ends_with(APP_DATA_SUFFIX));
    }

    #[test]
    fn index_source_strings_are_the_contract() {
        assert_eq!(IndexSource::App.as_str(), "app");
        assert_eq!(IndexSource::Scan.as_str(), "scan");
    }
}
