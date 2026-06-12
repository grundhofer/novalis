//! Local git versioning for a vault (Git sync P1).
//!
//! Every function opens the repository per call: `git2::Repository` is
//! `!Sync`, per-call opens are cheap at auto-commit rates, and it keeps this
//! module free of shared state. Remote operations are deliberately absent —
//! the workspace builds git2 with `default-features = false` (no
//! openssl/libssh2), so this build physically cannot reach the network;
//! remote sync is the P2 opt-in.

use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use git2::{IndexAddOption, Repository, RepositoryInitOptions, Signature, StatusOptions};

use crate::error::{CoreError, CoreResult};
use crate::models::{GitCommitInfo, GitStatus};

/// Lines Novalis maintains in the vault's `.gitignore`. `.novalis/config.json`
/// is deliberately NOT ignored — per-vault preferences are synced-by-design
/// (they already travel with OneDrive-style vault sync); trash and version
/// snapshots are local safety nets that would only bloat history.
const IGNORE_LINES: [&str; 3] = [".novalis/trash/", ".novalis/versions/", ".DS_Store"];

/// Serializes every mutating git operation in this process — the manual
/// "commit now" command and the background auto-committer would otherwise
/// race each other at `.git/index.lock` and surface spurious lock errors.
/// Cross-process contention (the user's own git CLI) still errors; that one
/// is real.
static MUTATE_GATE: Mutex<()> = Mutex::new(());

/// A `.git` lock file older than this has no live owner: in-process holders
/// are serialized by [`MUTATE_GATE`] and finish in seconds. Crashed/killed
/// processes leave their locks behind, and libgit2 never cleans them up —
/// without this, one power loss mid-commit kills versioning permanently.
const STALE_LOCK_AGE: Duration = Duration::from_secs(600);

fn gerr(e: git2::Error) -> CoreError {
    CoreError::Internal(format!("git: {}", e.message()))
}

/// Open the repository rooted exactly at `vault` (no upward discovery — a
/// vault inside some larger repo is treated as not initialized, and enabling
/// creates a nested repo scoped to the vault).
fn open(vault: &Path) -> Option<Repository> {
    Repository::open(vault).ok()
}

/// Ensure `vault` is a git repository and Novalis' ignore entries exist.
/// Initializes with `main` as the initial HEAD — libgit2 otherwise defaults
/// to an unborn `master`, which breaks pushing `refs/heads/main` later.
/// Also clears crash-orphaned lock files. Idempotent; preserves a
/// user-authored `.gitignore`.
pub fn ensure_repo(vault: &Path) -> CoreResult<()> {
    let _gate = MUTATE_GATE.lock().unwrap_or_else(|p| p.into_inner());
    if open(vault).is_none() {
        let mut opts = RepositoryInitOptions::new();
        opts.initial_head("main");
        Repository::init_opts(vault, &opts).map_err(gerr)?;
    }
    remove_stale_locks(vault, STALE_LOCK_AGE);
    ensure_ignores(vault)
}

/// Remove `.git` lock files left behind by a crashed/killed process. Only
/// locks older than `max_age` go — a fresh lock is live contention (e.g. the
/// user's own git CLI) and must be respected. Best-effort: failures only log,
/// the subsequent commit surfaces the real error.
fn remove_stale_locks(vault: &Path, max_age: Duration) {
    let git_dir = vault.join(".git");
    let mut candidates = vec![git_dir.join("index.lock"), git_dir.join("HEAD.lock")];
    if let Ok(heads) = std::fs::read_dir(git_dir.join("refs/heads")) {
        candidates.extend(
            heads
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x == "lock")),
        );
    }
    for lock in candidates {
        let Ok(meta) = lock.symlink_metadata() else {
            continue;
        };
        let stale = meta
            .modified()
            .ok()
            .and_then(|m| m.elapsed().ok())
            .is_some_and(|age| age > max_age);
        if stale {
            match std::fs::remove_file(&lock) {
                Ok(()) => log::warn!("git: removed stale lock {}", lock.display()),
                Err(e) => log::warn!("git: cannot remove stale lock {}: {e}", lock.display()),
            }
        }
    }
}

/// Append any missing [`IGNORE_LINES`] to the vault's `.gitignore`, creating
/// the file if absent. Operates on raw bytes so a user-authored file in a
/// non-UTF-8 encoding (e.g. Latin-1 comments) is appended to — never
/// rewritten, reordered, or destroyed.
fn ensure_ignores(vault: &Path) -> CoreResult<()> {
    let path = vault.join(".gitignore");
    let existing: Vec<u8> = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(e.into()),
    };
    let has_line = |wanted: &str| {
        existing
            .split(|b| *b == b'\n')
            .any(|line| line.trim_ascii() == wanted.as_bytes())
    };
    let missing: Vec<&str> = IGNORE_LINES
        .iter()
        .copied()
        .filter(|wanted| !has_line(wanted))
        .collect();
    if missing.is_empty() {
        return Ok(());
    }
    let mut out = existing;
    if !out.is_empty() && !out.ends_with(b"\n") {
        out.push(b'\n');
    }
    out.extend_from_slice(missing.join("\n").as_bytes());
    out.push(b'\n');
    std::fs::write(&path, out)?;
    Ok(())
}

/// Repository state for the UI. `initialized: false` (all else empty) when
/// the vault is not a repo — callers treat that as "git sync not set up",
/// not as an error.
pub fn repo_status(vault: &Path) -> CoreResult<GitStatus> {
    let Some(repo) = open(vault) else {
        return Ok(GitStatus {
            initialized: false,
            dirty: 0,
            branch: None,
            last_commit: None,
        });
    };
    Ok(GitStatus {
        initialized: true,
        dirty: count_dirty(&repo)?,
        branch: repo
            .head()
            .ok()
            .and_then(|h| h.shorthand().ok().map(str::to_string)),
        last_commit: head_commit_info(&repo),
    })
}

/// Working-tree paths that differ from HEAD (untracked + modified + deleted),
/// with ignores respected.
fn count_dirty(repo: &Repository) -> CoreResult<u32> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);
    let statuses = repo.statuses(Some(&mut opts)).map_err(gerr)?;
    Ok(statuses.len() as u32)
}

fn head_commit_info(repo: &Repository) -> Option<GitCommitInfo> {
    let commit = repo.head().ok()?.peel_to_commit().ok()?;
    let time = chrono::DateTime::from_timestamp(commit.time().seconds(), 0)?;
    Some(GitCommitInfo {
        id: commit.id().to_string(),
        message: commit
            .summary()
            .ok()
            .flatten()
            .unwrap_or_default()
            .to_string(),
        time: time.to_rfc3339(),
    })
}

/// Stage everything (respecting `.gitignore`) and commit as `name <email>`;
/// blank author fields fall back to the default identity — a cleared
/// settings field must degrade the author, not kill versioning. Returns
/// `Ok(None)` when there is nothing to commit, when the repository has an
/// operation in progress (user mid-merge/rebase in an adopted repo), or
/// when committing would fold in a manually curated index. Handles the
/// unborn HEAD of a fresh repo and never consults user-global git config —
/// the signature is always explicit.
pub fn commit_all(vault: &Path, name: &str, email: &str) -> CoreResult<Option<GitCommitInfo>> {
    let _gate = MUTATE_GATE.lock().unwrap_or_else(|p| p.into_inner());
    let defaults = crate::models::GitPrefs::default();
    let name = if name.trim().is_empty() {
        &defaults.author_name
    } else {
        name
    };
    let email = if email.trim().is_empty() {
        &defaults.author_email
    } else {
        email
    };
    let repo = open(vault).ok_or_else(|| {
        CoreError::BadRequest("vault is not a git repository — enable git sync first".to_string())
    })?;
    // Never commit into a user's in-flight operation (merge/rebase/
    // cherry-pick in an adopted repo): a single-parent auto-commit would
    // destroy the operation's ancestry. Resume once the repo is clean again.
    if repo.state() != git2::RepositoryState::Clean {
        log::info!(
            "git: repository busy ({:?}) — skipping commit",
            repo.state()
        );
        return Ok(None);
    }
    let dirty = count_dirty(&repo)?;
    if dirty == 0 {
        return Ok(None);
    }
    let mut index = repo.index().map_err(gerr)?;
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    // A manually curated index (user staged a PARTIAL change in an adopted
    // repo: index differs from HEAD *and* from the worktree) must not be
    // folded into an auto-commit — the staged selection would be lost.
    // index == worktree is fine to proceed: committing it changes nothing
    // the user didn't intend.
    let head_tree = match &parent {
        Some(c) => Some(c.tree().map_err(gerr)?),
        None => None,
    };
    let staged = repo
        .diff_tree_to_index(head_tree.as_ref(), Some(&index), None)
        .map_err(gerr)?
        .deltas()
        .len();
    if staged > 0 {
        let unstaged = repo
            .diff_index_to_workdir(Some(&index), None)
            .map_err(gerr)?
            .deltas()
            .len();
        if unstaged > 0 {
            log::warn!(
                "git: index holds manually staged changes — skipping commit to preserve them"
            );
            return Ok(None);
        }
    }
    // add_all stages new/modified paths (honoring ignores); update_all stages
    // modifications AND deletions of already-tracked paths.
    index
        .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
        .map_err(gerr)?;
    index.update_all(["*"].iter(), None).map_err(gerr)?;
    index.write().map_err(gerr)?;
    let tree_id = index.write_tree().map_err(gerr)?;
    // Staging can still produce an unchanged tree (e.g. a file flipped dirty
    // and back); committing it would create an empty commit.
    if let Some(p) = &parent {
        if p.tree_id() == tree_id {
            return Ok(None);
        }
    }
    let tree = repo.find_tree(tree_id).map_err(gerr)?;
    let sig = Signature::now(name, email)
        .map_err(|e| CoreError::BadRequest(format!("invalid git author: {}", e.message())))?;
    let message = format!(
        "novalis: auto-commit ({dirty} change{})",
        if dirty == 1 { "" } else { "s" }
    );
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
        .map_err(gerr)?;
    Ok(head_commit_info(&repo))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A vault fixture with notes plus the app-internal dirs that must stay
    /// out of history.
    fn vault() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "# A\n").unwrap();
        std::fs::create_dir_all(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub/b.md"), "# B\n").unwrap();
        std::fs::create_dir_all(dir.path().join(".novalis/trash")).unwrap();
        std::fs::create_dir_all(dir.path().join(".novalis/versions")).unwrap();
        std::fs::write(dir.path().join(".novalis/trash/t.md"), "trashed\n").unwrap();
        std::fs::write(dir.path().join(".novalis/versions/v.md"), "old\n").unwrap();
        std::fs::write(dir.path().join(".novalis/config.json"), "{}\n").unwrap();
        dir
    }

    fn head_tree_paths(vault: &Path) -> Vec<String> {
        let repo = Repository::open(vault).unwrap();
        let tree = repo.head().unwrap().peel_to_tree().unwrap();
        let mut paths = Vec::new();
        tree.walk(git2::TreeWalkMode::PreOrder, |root, entry| {
            if entry.kind() == Some(git2::ObjectType::Blob) {
                paths.push(format!("{root}{}", entry.name().unwrap_or_default()));
            }
            git2::TreeWalkResult::Ok
        })
        .unwrap();
        paths.sort();
        paths
    }

    #[test]
    fn ensure_repo_inits_main_head_and_gitignore() {
        let dir = vault();
        ensure_repo(dir.path()).unwrap();
        let ignore = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        for line in IGNORE_LINES {
            assert!(ignore.lines().any(|l| l == line), "missing {line}");
        }
        // Unborn HEAD must already point at main (the bare-master footgun).
        let repo = Repository::open(dir.path()).unwrap();
        let head = repo.find_reference("HEAD").unwrap();
        assert_eq!(head.symbolic_target().unwrap(), Some("refs/heads/main"));
    }

    #[test]
    fn ensure_repo_preserves_user_gitignore_and_is_idempotent() {
        let dir = vault();
        std::fs::write(dir.path().join(".gitignore"), "drafts/\n").unwrap();
        ensure_repo(dir.path()).unwrap();
        ensure_repo(dir.path()).unwrap();
        let ignore = std::fs::read_to_string(dir.path().join(".gitignore")).unwrap();
        assert!(ignore.lines().any(|l| l == "drafts/"));
        for line in IGNORE_LINES {
            assert_eq!(
                ignore.lines().filter(|l| *l == line).count(),
                1,
                "{line} duplicated"
            );
        }
    }

    #[test]
    fn first_commit_works_on_unborn_head_without_global_config() {
        let dir = vault();
        ensure_repo(dir.path()).unwrap();
        let info = commit_all(dir.path(), "Novalis", "novalis@localhost")
            .unwrap()
            .expect("first commit");
        assert!(info.message.contains("auto-commit"));
        let status = repo_status(dir.path()).unwrap();
        assert!(status.initialized);
        assert_eq!(status.dirty, 0);
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!(status.last_commit.unwrap().id, info.id);
    }

    #[test]
    fn trash_and_versions_stay_out_of_history_but_config_is_tracked() {
        let dir = vault();
        ensure_repo(dir.path()).unwrap();
        commit_all(dir.path(), "Novalis", "novalis@localhost")
            .unwrap()
            .unwrap();
        let paths = head_tree_paths(dir.path());
        assert!(paths.contains(&"a.md".to_string()));
        assert!(paths.contains(&"sub/b.md".to_string()));
        assert!(paths.contains(&".novalis/config.json".to_string()));
        assert!(paths.contains(&".gitignore".to_string()));
        assert!(!paths.iter().any(|p| p.starts_with(".novalis/trash")));
        assert!(!paths.iter().any(|p| p.starts_with(".novalis/versions")));
    }

    #[test]
    fn clean_tree_commits_nothing() {
        let dir = vault();
        ensure_repo(dir.path()).unwrap();
        commit_all(dir.path(), "Novalis", "novalis@localhost")
            .unwrap()
            .unwrap();
        assert!(commit_all(dir.path(), "Novalis", "novalis@localhost")
            .unwrap()
            .is_none());
        // Touching only ignored paths must also commit nothing.
        std::fs::write(dir.path().join(".novalis/trash/more.md"), "x\n").unwrap();
        assert!(commit_all(dir.path(), "Novalis", "novalis@localhost")
            .unwrap()
            .is_none());
    }

    #[test]
    fn modifications_and_deletions_are_committed() {
        let dir = vault();
        ensure_repo(dir.path()).unwrap();
        commit_all(dir.path(), "Novalis", "novalis@localhost")
            .unwrap()
            .unwrap();
        std::fs::write(dir.path().join("a.md"), "# A changed\n").unwrap();
        std::fs::remove_file(dir.path().join("sub/b.md")).unwrap();
        let info = commit_all(dir.path(), "Novalis", "novalis@localhost")
            .unwrap()
            .expect("second commit");
        assert!(info.message.contains("2 changes"));
        let paths = head_tree_paths(dir.path());
        assert!(!paths.contains(&"sub/b.md".to_string()), "deletion staged");
        // History now has two commits.
        let repo = Repository::open(dir.path()).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.parent_count(), 1);
    }

    #[test]
    fn blank_author_falls_back_to_defaults_instead_of_failing() {
        // A cleared settings field must degrade the author, not permanently
        // kill the auto-committer (which only logs failures).
        let dir = vault();
        ensure_repo(dir.path()).unwrap();
        commit_all(dir.path(), " ", "")
            .unwrap()
            .expect("commit with fallback author");
        let repo = Repository::open(dir.path()).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        let author = head.author();
        assert_eq!(author.name().unwrap(), "Novalis");
        assert_eq!(author.email().unwrap(), "novalis@localhost");
    }

    #[test]
    fn stale_locks_are_cleared_but_fresh_locks_respected() {
        let dir = vault();
        ensure_repo(dir.path()).unwrap();
        let lock = dir.path().join(".git/index.lock");
        // A fresh lock (live contention, e.g. the user's git CLI) survives
        // the real threshold…
        std::fs::write(&lock, "").unwrap();
        remove_stale_locks(dir.path(), STALE_LOCK_AGE);
        assert!(lock.exists(), "fresh lock must be respected");
        // …but a lock older than the threshold is cleared (age forced to
        // zero here — mtimes can't be backdated without extra deps).
        remove_stale_locks(dir.path(), Duration::ZERO);
        assert!(!lock.exists(), "stale lock must be removed");
        commit_all(dir.path(), "Novalis", "novalis@localhost")
            .unwrap()
            .expect("commit succeeds after stale lock cleanup");
    }

    #[test]
    fn non_utf8_user_gitignore_is_appended_to_not_destroyed() {
        let dir = vault();
        // Latin-1 "# Entwürfe" — read_to_string would fail on this.
        let user_bytes: &[u8] = b"# Entw\xfcrfe\nprivate/\n";
        std::fs::write(dir.path().join(".gitignore"), user_bytes).unwrap();
        ensure_repo(dir.path()).unwrap();
        let bytes = std::fs::read(dir.path().join(".gitignore")).unwrap();
        assert!(bytes.starts_with(user_bytes), "user content preserved");
        for line in IGNORE_LINES {
            assert!(
                bytes
                    .split(|b| *b == b'\n')
                    .any(|l| l.trim_ascii() == line.as_bytes()),
                "missing {line}"
            );
        }
    }

    #[test]
    fn in_flight_merge_state_skips_commit() {
        let dir = vault();
        ensure_repo(dir.path()).unwrap();
        let baseline = commit_all(dir.path(), "Novalis", "novalis@localhost")
            .unwrap()
            .unwrap();
        // Simulate a user mid-merge in an adopted repo: MERGE_HEAD present.
        std::fs::write(
            dir.path().join(".git/MERGE_HEAD"),
            format!("{}\n", baseline.id),
        )
        .unwrap();
        std::fs::write(dir.path().join("a.md"), "# A edited\n").unwrap();
        assert!(
            commit_all(dir.path(), "Novalis", "novalis@localhost")
                .unwrap()
                .is_none(),
            "must not commit into an in-flight merge"
        );
        // Operation finished → commits resume.
        std::fs::remove_file(dir.path().join(".git/MERGE_HEAD")).unwrap();
        assert!(commit_all(dir.path(), "Novalis", "novalis@localhost")
            .unwrap()
            .is_some());
    }

    #[test]
    fn manually_staged_partial_change_is_preserved_not_clobbered() {
        let dir = vault();
        ensure_repo(dir.path()).unwrap();
        commit_all(dir.path(), "Novalis", "novalis@localhost")
            .unwrap()
            .unwrap();
        // User stages v2 of a note (git add), then keeps editing to v3.
        std::fs::write(dir.path().join("a.md"), "# A v2\n").unwrap();
        {
            let repo = Repository::open(dir.path()).unwrap();
            let mut index = repo.index().unwrap();
            index.add_path(Path::new("a.md")).unwrap();
            index.write().unwrap();
        }
        std::fs::write(dir.path().join("a.md"), "# A v3\n").unwrap();
        assert!(
            commit_all(dir.path(), "Novalis", "novalis@localhost")
                .unwrap()
                .is_none(),
            "curated index must not be folded into an auto-commit"
        );
        // The staged v2 blob is still in the index, untouched.
        let repo = Repository::open(dir.path()).unwrap();
        let index = repo.index().unwrap();
        let entry = index.get_path(Path::new("a.md"), 0).unwrap();
        let blob = repo.find_blob(entry.id).unwrap();
        assert_eq!(blob.content(), b"# A v2\n");
    }

    #[test]
    fn status_on_plain_folder_reports_uninitialized() {
        let dir = vault();
        let status = repo_status(dir.path()).unwrap();
        assert!(!status.initialized);
        assert_eq!(status.dirty, 0);
        assert!(status.last_commit.is_none());
    }
}
