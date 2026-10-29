//! The window comes back where it was (PLAN.md §4.1: window size and
//! position are state, kept in `state.json`, not a setting).
//!
//! The window is created hidden (`tauri.conf.json`), so it never shows at
//! the default place first and then jumps: [`restore`] moves it to the saved
//! rectangle — when that still lands on a connected screen — and then shows
//! it, whatever happened. Moves and resizes are recorded in [`AppState`] as
//! they happen and reach the file with the UI's next save, its last one
//! before quitting, and once more on exit ([`persist`]).
//!
//! The look comes from settings.json, the one store for it (ADR-0051 #22,
//! DSK-14, spec/09 §13.1): [`init_script`] hands the choice to sebaro's
//! `theme-init.js` before the page's own scripts run, [`native_theme`] gives
//! the window the same mode, and [`paint_ground`] gives it the matching
//! ground from sebaro's `tokens.json`. On macOS the window's theme is NSApp's
//! appearance too (tao); the menu-bar menus still stay in the system's mode,
//! which no call here changes (docs/sebaro-luecken.md, „Systemthema, Menüs“).
//!
//! DSK-14 says not to start the window invisible and show it after the first
//! paint. This window is hidden only until [`restore`] has put it in place,
//! which runs in `setup` right after it is built, before the page has loaded;
//! it never waits for the page. What the user sees before the page paints is
//! the ground set here.

use novalis_core::settings::{Appearance, Settings, Tone};
use tauri::window::Color;
use tauri::{Monitor, PhysicalPosition, PhysicalSize, Runtime, Theme, WebviewWindow, Window};

use crate::commands::{read_ui_state, write_ui_state};
use crate::dto::WindowRectDto;
use crate::state::AppState;

// SEBARO_BG: the four grounds, written by build.rs from sebaro's tokens.json.
include!(concat!(env!("OUT_DIR"), "/sebaro_bg.rs"));

/// The window ground for a tone and a mode (DSK-14: cool or warm, light or
/// dark).
pub fn ground(tone: Tone, dark: bool) -> Color {
    let (r, g, b) = SEBARO_BG[usize::from(tone == Tone::Warm)][usize::from(dark)];
    Color(r, g, b, 255)
}

/// Whether the window shows dark: the choice, or for `system` the mode the
/// window reports (`None` before it exists: light, corrected once it does).
pub fn is_dark(appearance: Appearance, system: Option<Theme>) -> bool {
    match appearance {
        Appearance::System => system == Some(Theme::Dark),
        Appearance::Light => false,
        Appearance::Dark => true,
    }
}

/// The window's own system theme for the stored choice (DSK-14): an explicit
/// mode is set on the window, so the traffic lights and every control macOS
/// draws match the page; `system` leaves the window to follow macOS.
pub fn native_theme(appearance: Appearance) -> Option<Theme> {
    match appearance {
        Appearance::System => None,
        Appearance::Light => Some(Theme::Light),
        Appearance::Dark => Some(Theme::Dark),
    }
}

/// Give the window the ground of the stored choice; for `system` it asks the
/// window for the mode macOS shows now.
pub fn paint_ground<R: Runtime>(window: &WebviewWindow<R>, settings: &Settings) {
    let dark = is_dark(settings.appearance, window.theme().ok());
    let _ = window.set_background_color(Some(ground(settings.tone, dark)));
}

/// Runs before the page's own scripts (spec/09 §13.1, ADR-0051 #22): writes
/// what sebaro's `theme-init.js` reads (`sb-theme`, `sb-tone`, `sb-motion`)
/// and names the platform (`html[data-sb-platform]`). For `system` it also
/// stamps the resolved `data-theme`, because the preview's diagrams
/// (Preview.tsx) learn of a change of the system's scheme only when that
/// attribute changes; `theme-init.js` sets it only for an explicit choice. The script is
/// fixed when the window is built: after a change at run time, a reload of
/// the page starts in the old choice until `bootstrap` reads settings.json.
pub fn init_script(settings: &Settings) -> String {
    let theme = match settings.appearance {
        Appearance::System => "localStorage.removeItem('sb-theme');",
        Appearance::Light => "localStorage.setItem('sb-theme','light');",
        Appearance::Dark => "localStorage.setItem('sb-theme','dark');",
    };
    let tone = match settings.tone {
        Tone::Cool => "localStorage.removeItem('sb-tone');",
        Tone::Warm => "localStorage.setItem('sb-tone','warm');",
    };
    let motion = if settings.reduce_motion {
        "localStorage.setItem('sb-motion','reduce');"
    } else {
        "localStorage.removeItem('sb-motion');"
    };
    let platform = if cfg!(target_os = "macos") {
        "mac"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    };
    let system = settings.appearance == Appearance::System;
    format!(
        "try{{{theme}{tone}{motion}}}catch(e){{}}\
         (function(p,s){{function set(){{var r=document.documentElement;if(!r)return false;\
         r.setAttribute('data-sb-platform',p);\
         if(s)r.setAttribute('data-theme',matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');\
         return true}}if(!set())new MutationObserver(function(m,o){{if(set())o.disconnect()}})\
         .observe(document,{{childList:true}})}})('{platform}',{system});"
    )
}

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
    use novalis_core::settings::{Appearance, Settings, Tone};
    use tauri::Theme;

    use super::{fitted, ground, init_script, is_dark, native_theme};
    use crate::dto::WindowRectDto;

    #[test]
    fn the_four_grounds_come_from_tokens_json_and_differ() {
        let grounds = [
            ground(Tone::Cool, false),
            ground(Tone::Cool, true),
            ground(Tone::Warm, false),
            ground(Tone::Warm, true),
        ];
        for (i, a) in grounds.iter().enumerate() {
            assert_eq!(a.3, 255, "a ground is opaque");
            for b in &grounds[i + 1..] {
                assert_ne!(a, b);
            }
        }
    }

    #[test]
    fn system_follows_the_window_and_a_choice_overrides_it() {
        assert!(!is_dark(Appearance::System, None));
        assert!(!is_dark(Appearance::System, Some(Theme::Light)));
        assert!(is_dark(Appearance::System, Some(Theme::Dark)));
        assert!(is_dark(Appearance::Dark, Some(Theme::Light)));
        assert!(!is_dark(Appearance::Light, Some(Theme::Dark)));
    }

    #[test]
    fn the_window_takes_an_explicit_mode_and_follows_macos_for_system() {
        assert_eq!(native_theme(Appearance::System), None);
        assert_eq!(native_theme(Appearance::Light), Some(Theme::Light));
        assert_eq!(native_theme(Appearance::Dark), Some(Theme::Dark));
    }

    #[test]
    fn the_init_script_writes_what_theme_init_reads() {
        let defaults = init_script(&Settings::default());
        assert!(defaults.contains("localStorage.removeItem('sb-theme');"));
        assert!(defaults.contains("localStorage.removeItem('sb-tone');"));
        assert!(defaults.contains("localStorage.removeItem('sb-motion');"));
        // `system`: the resolved mode for novalis's own dark values.
        assert!(defaults.ends_with(",true);"));

        let chosen = init_script(&Settings {
            appearance: Appearance::Dark,
            tone: Tone::Warm,
            reduce_motion: true,
            ..Settings::default()
        });
        assert!(chosen.contains("localStorage.setItem('sb-theme','dark');"));
        assert!(chosen.contains("localStorage.setItem('sb-tone','warm');"));
        assert!(chosen.contains("localStorage.setItem('sb-motion','reduce');"));
        assert!(chosen.ends_with(",false);"));

        let light = init_script(&Settings {
            appearance: Appearance::Light,
            ..Settings::default()
        });
        assert!(light.contains("localStorage.setItem('sb-theme','light');"));
    }

    #[test]
    fn the_init_script_names_the_platform() {
        let script = init_script(&Settings::default());
        let platform = if cfg!(target_os = "macos") {
            "'mac'"
        } else if cfg!(target_os = "windows") {
            "'windows'"
        } else {
            "'linux'"
        };
        assert!(script.contains("setAttribute('data-sb-platform',p)"));
        assert!(script.contains(&format!("({platform},")));
    }

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

    // D91 F2a, DSK-07, spec/02 §4.17: the smallest window is 480 × 400 px;
    // the side parts give way, the content keeps 480 px. A large minimum is
    // what DSK-07 forbids.
    #[test]
    fn the_smallest_window_is_sebaros_480_by_400() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let main = &conf["app"]["windows"][0];
        assert_eq!(main["label"], "main");
        assert_eq!(main["minWidth"], 480);
        assert_eq!(main["minHeight"], 400);
    }
}
