//! The red spelling underlines of PLAN.md §7.5 (Spike B,
//! `docs/spikes/2026-09-05-spike-b-spellcheck.md`): WKWebView marks nothing
//! while its app's own preferences lack `WebContinuousSpellCheckingEnabled`,
//! whatever the DOM's `spellcheck` attribute says. The shell writes that key
//! from the `spellcheck` setting — at launch and whenever the setting changes
//! — so the setting stays the one source of truth; the key is WebKit's state
//! in the app's own preferences domain, not a fifth setting.
//!
//! The write is in-process, through CoreFoundation's plain C preferences
//! API — the domain `NSUserDefaults.standard` reads, with no Objective-C
//! crate for one key. A write from another process (`/usr/bin/defaults`)
//! was tried first: it reached the file but not this process, so the first
//! launch after an install showed no underlines until the next one.

const KEY: &str = "WebContinuousSpellCheckingEnabled";

#[cfg(target_os = "macos")]
mod cf {
    use std::ffi::c_void;

    pub type CFStringRef = *const c_void;
    /// `kCFStringEncodingUTF8` (CFString.h).
    pub const UTF8: u32 = 0x0800_0100;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        pub static kCFBooleanTrue: *const c_void;
        pub static kCFBooleanFalse: *const c_void;
        pub static kCFPreferencesCurrentApplication: CFStringRef;
        pub fn CFStringCreateWithBytes(
            alloc: *const c_void,
            bytes: *const u8,
            len: isize,
            encoding: u32,
            external: u8,
        ) -> CFStringRef;
        pub fn CFPreferencesSetAppValue(key: CFStringRef, value: *const c_void, app: CFStringRef);
        pub fn CFPreferencesAppSynchronize(app: CFStringRef) -> u8;
        pub fn CFRelease(cf: *const c_void);
    }
}

/// Set the key for `enabled` in this process's preferences. A failure costs
/// the underlines, never the app: it is not reported.
pub fn seed(enabled: bool) {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: CoreFoundation calls with a key string created here and
        // released after use, and constant values and domain from the
        // framework; nothing outlives the block.
        unsafe {
            let key = cf::CFStringCreateWithBytes(
                std::ptr::null(),
                KEY.as_ptr(),
                KEY.len() as isize,
                cf::UTF8,
                0,
            );
            if key.is_null() {
                return;
            }
            let value = if enabled {
                cf::kCFBooleanTrue
            } else {
                cf::kCFBooleanFalse
            };
            cf::CFPreferencesSetAppValue(key, value, cf::kCFPreferencesCurrentApplication);
            cf::CFPreferencesAppSynchronize(cf::kCFPreferencesCurrentApplication);
            cf::CFRelease(key);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (KEY, enabled);
    }
}
