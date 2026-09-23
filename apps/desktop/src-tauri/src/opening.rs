//! Files and links macOS hands to the app (ADR-0045): a Markdown or text
//! file opened with novalis — Open With, a drop on the Dock icon, `open -a` —
//! and `novalis://` links. Each arrives as a `RunEvent::Opened`. Until the UI
//! has asked for the boot state they are queued, because a launch by a file
//! delivers it before there is a page to tell; `bootstrap` hands the queue
//! over, and later ones go out as one `OpenRequested` event.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager, Url};
use tauri_specta::Event;

/// Requests that came before the UI asked for its boot state; `None` once
/// it has. A static, not app state: on a launch by a file macOS delivers it
/// before `setup` has registered any state (measured in the built app).
static PENDING: Mutex<Option<Vec<OpenRequestDto>>> = Mutex::new(Some(Vec::new()));

/// The queued requests, once; from then on they are sent as they come.
pub fn take_pending() -> Vec<OpenRequestDto> {
    PENDING
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .unwrap_or_default()
}

/// One thing to open. The UI decides what it means: a file inside the open
/// vault becomes a tab, anything else is said in a toast.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum OpenRequestDto {
    /// An absolute file path.
    File { path: String },
    /// A `novalis://` link, as it came.
    Link { url: String },
}

/// Requests that arrived while the UI was running.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequested {
    pub items: Vec<OpenRequestDto>,
}

/// What a URL macOS handed over asks for; `None` for any other scheme.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn request_of(url: &Url) -> Option<OpenRequestDto> {
    match url.scheme() {
        "file" => url.to_file_path().ok().map(|p| OpenRequestDto::File {
            path: p.to_string_lossy().into_owned(),
        }),
        "novalis" => Some(OpenRequestDto::Link {
            url: url.to_string(),
        }),
        _ => None,
    }
}

/// `RunEvent::Opened`: queue for the boot, or tell the running UI, and bring
/// the window forward either way. Only macOS has the event.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn opened(app: &AppHandle, urls: &[Url]) {
    let items: Vec<OpenRequestDto> = urls.iter().filter_map(request_of).collect();
    if items.is_empty() {
        return;
    }
    let release = {
        let mut pending = PENDING.lock().unwrap_or_else(|e| e.into_inner());
        match pending.as_mut() {
            Some(queue) => {
                queue.extend(items);
                None
            }
            None => Some(items),
        }
    };
    if let Some(items) = release {
        let _ = OpenRequested { items }.emit(app);
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_url_is_its_path_and_a_novalis_link_stays_a_link() {
        let file = Url::parse("file:///Users/me/Vault/a%20b.md").unwrap();
        assert_eq!(
            request_of(&file),
            Some(OpenRequestDto::File {
                path: "/Users/me/Vault/a b.md".into()
            })
        );
        let link = Url::parse("novalis://open?path=notes/a.md").unwrap();
        assert_eq!(
            request_of(&link),
            Some(OpenRequestDto::Link {
                url: "novalis://open?path=notes/a.md".into()
            })
        );
        assert_eq!(request_of(&Url::parse("https://x.org").unwrap()), None);
    }
}
