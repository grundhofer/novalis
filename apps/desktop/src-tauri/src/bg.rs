//! Small background helpers shared by the desktop quit-commit
//! ([`crate::autocommit`]) and the mobile lifecycle sync ([`crate::mobile`]).

use std::time::Duration;

/// Run `work` on a detached thread and wait at most `timeout` for its result;
/// `None` means the deadline passed. The thread is NOT cancelled — it dies
/// with the process (quit) or simply outlives the wait (mobile suspend). That
/// is safe for git sync: the local commit already secured the data and the
/// next sync cycle converges; at worst an interrupted op leaves a stale `.git`
/// lock, which `git::ensure_repo` clears.
pub fn run_with_timeout<T: Send + 'static>(
    timeout: Duration,
    work: impl FnOnce() -> T + Send + 'static,
) -> Option<T> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(work());
    });
    rx.recv_timeout(timeout).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_fast_work() {
        assert_eq!(run_with_timeout(Duration::from_secs(5), || 42), Some(42));
    }

    #[test]
    fn abandons_slow_work() {
        let slow = || {
            std::thread::sleep(Duration::from_millis(500));
            42
        };
        assert_eq!(run_with_timeout(Duration::from_millis(50), slow), None);
    }
}
