//! Tracks in-flight streaming requests so they can be cancelled. Each running
//! request registers an `Arc<Notify>`; the stream task `select!`s on it and
//! `ai_cancel` fires it. Managed as Tauri state.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::Notify;

#[derive(Default)]
pub struct AiRegistry(Mutex<HashMap<String, Arc<Notify>>>);

impl AiRegistry {
    /// Register `request_id` and return its cancellation handle.
    pub fn register(&self, request_id: &str) -> Arc<Notify> {
        let notify = Arc::new(Notify::new());
        self.0
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(request_id.to_string(), notify.clone());
        notify
    }

    /// Drop the handle once the stream is finished (success, error, or cancel).
    pub fn remove(&self, request_id: &str) {
        self.0
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(request_id);
    }

    /// Signal the stream task for `request_id` to stop. Returns whether a
    /// matching in-flight request was found.
    pub fn cancel(&self, request_id: &str) -> bool {
        if let Some(notify) = self
            .0
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(request_id)
        {
            // `notify_one` stores a permit even if the task isn't waiting yet,
            // so a cancel can't be lost to a race with the stream loop.
            notify.notify_one();
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn cancel_of_an_unknown_request_reports_not_found() {
        let reg = AiRegistry::default();
        assert!(!reg.cancel("nope"));
        // A cancel that raced ahead of register is reported to the caller as
        // "not found" — it does NOT poison a later request with the same id.
        let notify = reg.register("nope");
        assert!(
            tokio::runtime::Builder::new_current_thread()
                .enable_time()
                .build()
                .unwrap()
                .block_on(async {
                    tokio::time::timeout(Duration::from_millis(50), notify.notified())
                        .await
                        .is_err()
                }),
            "a pre-register cancel must not leave a stray permit behind"
        );
    }

    #[tokio::test]
    async fn cancel_between_register_and_await_is_not_lost() {
        let reg = AiRegistry::default();
        let notify = reg.register("req-1");
        // Cancel BEFORE the stream task starts waiting: notify_one stores a
        // permit, so the later notified() must complete immediately.
        assert!(reg.cancel("req-1"));
        tokio::time::timeout(Duration::from_secs(1), notify.notified())
            .await
            .expect("the stored permit must wake a later waiter");
    }

    #[test]
    fn remove_forgets_the_request() {
        let reg = AiRegistry::default();
        let _notify = reg.register("req-2");
        reg.remove("req-2");
        assert!(
            !reg.cancel("req-2"),
            "a finished request cannot be cancelled"
        );
    }

    #[test]
    fn requests_are_isolated_by_id() {
        let reg = AiRegistry::default();
        let _a = reg.register("a");
        let _b = reg.register("b");
        assert!(reg.cancel("a"));
        reg.remove("a");
        assert!(
            reg.cancel("b"),
            "cancelling one request must not drop others"
        );
    }
}
