//! The window comes back where it was (PLAN.md §4.1: window size and
//! position are state, kept in `state.json`, not a setting).
//!
//! The window is created hidden (`tauri.conf.json`), so it never shows at
//! the default place first and then jumps: [`restore`] moves it to the saved
//! rectangle — when that still lands on a connected screen — and then shows
//! it, whatever happened. Moves and resizes are recorded in [`AppState`] as
//! they happen and reach the file with the UI's next save, its last one
//! before quitting, and once more on exit ([`persist`]).

use tauri::{Monitor, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow, Window};

use crate::commands::{read_ui_state, write_ui_state};
use crate::dto::WindowRectDto;
use crate::state::AppState;

/// How much of the window's top edge must be on a screen for the saved place
/// to be used: enough to grab the title bar and drag it back.
const GRIP_WIDTH: i32 = 100;
const GRIP_HEIGHT: i32 = 40;

/// The screen area of each monitor, as `(x, y, width, height)`.
fn screens(monitors: &[Monitor]) -> Vec<(i32, i32, u32, u32)> {
    monitors
        .iter()
        .map(|m| {
            (
                m.position().x,
                m.position().y,
                m.size().width,
                m.size().height,
            )
        })
        .collect()
}

/// The saved rectangle made to fit what is connected now, or `None` when its
/// title bar would be on no screen (the display it was on is gone).
pub fn fitted(rect: WindowRectDto, screens: &[(i32, i32, u32, u32)]) -> Option<WindowRectDto> {
    let (_, _, width, height) = screens.iter().copied().find(|&(sx, sy, sw, sh)| {
        let (sw, sh) = (sw as i32, sh as i32);
        rect.x >= sx - GRIP_WIDTH / 2
            && rect.x <= sx + sw - GRIP_WIDTH
            && rect.y >= sy
            && rect.y <= sy + sh - GRIP_HEIGHT
    })?;
    Some(WindowRectDto {
        width: rect.width.min(width),
        height: rect.height.min(height),
        ..rect
    })
}

fn rect_of<R: Runtime>(window: &Window<R>) -> Option<WindowRectDto> {
    if window.is_fullscreen().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return None;
    }
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    Some(WindowRectDto {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

/// Move the hidden window to its saved place, record where it is, show it.
pub fn restore<R: Runtime>(window: &WebviewWindow<R>, state: &AppState) {
    let saved = read_ui_state(&state.ui_state_path()).window;
    let connected = window.available_monitors().unwrap_or_default();
    if let Some(rect) = saved.and_then(|rect| fitted(rect, &screens(&connected))) {
        let _ = window.set_size(PhysicalSize::new(rect.width, rect.height));
        let _ = window.set_position(PhysicalPosition::new(rect.x, rect.y));
    }
    if let Some(rect) = rect_of(&window.as_ref().window()) {
        state.set_window(rect);
    }
    // Shown in any case: a window left hidden would be an app that seems
    // not to start.
    let _ = window.show();
}

/// A move or a resize: remember where the window is now.
pub fn track<R: Runtime>(window: &Window<R>, state: &AppState) {
    if let Some(rect) = rect_of(window) {
        state.set_window(rect);
    }
}

/// On exit, write the last place into `state.json` — a move after the UI's
/// last save would otherwise be lost. Everything else in the file is kept.
pub fn persist(state: &AppState) {
    let Some(rect) = state.window() else { return };
    let path = state.ui_state_path();
    let mut ui_state = read_ui_state(&path);
    if ui_state.window == Some(rect) {
        return;
    }
    ui_state.window = Some(rect);
    // Nothing is left to report a failure to; the next launch centres.
    let _ = write_ui_state(&path, &ui_state);
}

#[cfg(test)]
mod tests {
    use super::fitted;
    use crate::dto::WindowRectDto;

    const LAPTOP: (i32, i32, u32, u32) = (0, 0, 3024, 1964);
    const EXTERNAL: (i32, i32, u32, u32) = (3024, -200, 5120, 2880);

    fn rect(x: i32, y: i32, width: u32, height: u32) -> WindowRectDto {
        WindowRectDto {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn a_place_on_a_connected_screen_is_kept() {
        assert_eq!(
            fitted(rect(100, 80, 2560, 1600), &[LAPTOP]),
            Some(rect(100, 80, 2560, 1600))
        );
        assert_eq!(
            fitted(rect(4000, 0, 2560, 1600), &[LAPTOP, EXTERNAL]),
            Some(rect(4000, 0, 2560, 1600))
        );
    }

    #[test]
    fn a_place_on_a_screen_that_is_gone_is_dropped() {
        assert_eq!(fitted(rect(4000, 0, 2560, 1600), &[LAPTOP]), None);
        // Title bar above the top of every screen.
        assert_eq!(fitted(rect(100, -500, 2560, 1600), &[LAPTOP]), None);
        assert_eq!(fitted(rect(100, 80, 2560, 1600), &[]), None);
    }

    #[test]
    fn a_window_larger_than_its_screen_is_shrunk_to_it() {
        assert_eq!(
            fitted(rect(0, 0, 5120, 2880), &[LAPTOP]),
            Some(rect(0, 0, 3024, 1964))
        );
    }
}
