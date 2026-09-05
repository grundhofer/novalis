//! The novalis desktop shell.
//!
//! A thin Tauri 2 wrapper around [`novalis_core`]: it owns the window, the
//! native menu, one watcher per vault and nothing else. Every behaviour that
//! could be tested without a UI lives in the core crate; what is left here is
//! wiring, and the command surface below is the whole of it (PLAN.md §5.3).
//!
//! The command and event surface is declared once in [`specta_builder`] and is
//! the single source of truth for `ui/src/ipc/bindings.ts`, regenerated with
//! `cargo run -p novalis-desktop --example gen_bindings`.

mod commands;
mod dto;
mod error;
mod i18n;
mod menu;
mod state;
mod watcher;

use tauri::Manager;
use tauri_specta::{collect_commands, collect_events, Builder};

use crate::i18n::{resolve_locale, Catalog};
use crate::menu::{MenuAction, MenuFlags};
use crate::state::{load_settings, AppState};
use crate::watcher::FsBatch;

/// The IPC surface. 20 commands — PLAN.md §2.3 rule 8 caps it at 25.
fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::bootstrap,
            commands::open_vault_dialog,
            commands::open_vault,
            commands::list_dir,
            commands::list_notes,
            commands::read_file,
            commands::write_file,
            commands::write_conflict_copy,
            commands::create_note,
            commands::create_folder,
            commands::rename,
            commands::trash,
            commands::search,
            commands::board_list,
            commands::board_read,
            commands::board_create,
            commands::board_write,
            commands::card_write,
            commands::settings_set,
            commands::state_save,
        ])
        .events(collect_events![FsBatch, MenuAction])
}

/// Regenerate `ui/src/ipc/bindings.ts` from the command and event surface.
/// Called by `examples/gen_bindings.rs` and, in a debug build, at startup so a
/// changed command signature can never be stale during `just dev`.
pub fn export_bindings() {
    let out = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../ui/src/ipc/bindings.ts");
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent).expect("create the ui ipc directory");
    }
    // `specta-typescript` refuses to emit i64/u64/usize at all, which is why
    // `PreconditionDto` and `EntryDto` carry `mtimeNs` and `size` as decimal
    // strings rather than numbers (see `dto.rs`).
    specta_builder()
        .export(specta_typescript::Typescript::default(), &out)
        .expect("export TypeScript bindings");
}

pub fn run() {
    // Debug builds keep the bindings honest during `just dev`. A bundled app
    // has no `CARGO_MANIFEST_DIR` on disk, so this is debug-only.
    #[cfg(debug_assertions)]
    export_bindings();

    let builder = specta_builder();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);

            let handle = app.handle().clone();
            let config_dir = handle.path().app_config_dir()?;
            std::fs::create_dir_all(&config_dir)?;

            // A settings file we cannot parse must not stop the app: defaults
            // are used and nothing is written back until a setting changes.
            let (settings, _load_error) = load_settings(&config_dir.join("settings.json"));
            let catalog = Catalog::load(resolve_locale(settings.language));
            menu::install(&handle, &catalog, &settings, MenuFlags::default())?;

            app.manage(AppState::new(config_dir, settings));
            Ok(())
        })
        // Every menu click becomes one `menu-action` event carrying a
        // docs/KEYMAP.md command id; the UI dispatches it exactly as it
        // dispatches the matching chord.
        .on_menu_event(|app, event| menu::dispatch(app, event.id().as_ref()))
        .run(tauri::generate_context!())
        .expect("run the novalis desktop app");
}
