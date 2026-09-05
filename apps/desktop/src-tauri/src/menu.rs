//! The native menu bar, built from `i18n/*.json` (PLAN.md §5.3, §5.8).
//!
//! Predefined items (About, Services, Hide, Quit, Minimize, Zoom, Full Screen,
//! and the clipboard group) get their system names from macOS; everything else
//! is a catalog key. Command ids are the ones in `docs/KEYMAP.md`, so a menu
//! click and the matching chord dispatch the same UI command.
//!
//! The menu carries no state of its own: it is rebuilt whenever a setting that
//! it displays changes (appearance, language, spellcheck, sidebar/board
//! visibility), which is cheaper and less error-prone than mutating check
//! items in place.

use novalis_core::settings::{Appearance, Language, Settings};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::menu::{
    AboutMetadata, CheckMenuItemBuilder, Menu, MenuBuilder, MenuItem, MenuItemBuilder,
    SubmenuBuilder,
};
use tauri::{AppHandle, Wry};
use tauri_specta::Event;

use crate::i18n::Catalog;

/// What the UI sees when a menu item is clicked. `id` is a `docs/KEYMAP.md`
/// command id, or a `menu.`-prefixed id for the items that have no chord.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct MenuAction {
    pub id: String,
}

/// Every catalog key [`build`] asks for. The i18n test walks this list, so a
/// typo fails `cargo test` instead of showing up as a raw key in the menu bar.
/// Test-only data: it exists to be checked, not to be read at runtime.
#[cfg(test)]
pub const MENU_KEYS: &[&str] = &[
    "menu.file.title",
    "menu.file.newNote",
    "menu.file.newFolder",
    "menu.file.newBoard",
    "menu.file.openVault",
    "menu.file.save",
    "menu.file.rename",
    "menu.file.moveToTrash",
    "menu.file.closeTab",
    "menu.file.reopenClosedTab",
    "menu.edit.title",
    "menu.edit.find",
    "menu.edit.findNext",
    "menu.edit.findPrevious",
    "menu.edit.findAndReplace",
    "menu.edit.findInVault",
    "menu.edit.gotoLine",
    "menu.edit.selectNextOccurrence",
    "menu.edit.selectAllOccurrences",
    "menu.edit.addCursorAbove",
    "menu.edit.addCursorBelow",
    "menu.edit.moveLineUp",
    "menu.edit.moveLineDown",
    "menu.edit.duplicateLine",
    "menu.edit.deleteLine",
    "menu.edit.toggleComment",
    "menu.edit.bold",
    "menu.edit.italic",
    "menu.edit.insertLink",
    "menu.edit.toggleCheckbox",
    "menu.edit.spelling",
    "menu.edit.checkSpellingWhileTyping",
    "menu.view.title",
    "menu.view.showSidebar",
    "menu.view.hideSidebar",
    "menu.view.showBoard",
    "menu.view.hideBoard",
    "menu.view.fontLarger",
    "menu.view.fontSmaller",
    "menu.view.fontReset",
    "menu.view.appearance",
    "menu.view.language",
    "menu.go.title",
    "menu.go.quickOpen",
    "menu.go.commandPalette",
    "menu.go.back",
    "menu.go.forward",
    "menu.go.previousTab",
    "menu.go.nextTab",
    "menu.window.title",
    "settings.appearance.system",
    "settings.appearance.light",
    "settings.appearance.dark",
    "settings.language.system",
    "settings.language.de",
    "settings.language.en",
];

/// What the menu needs to know beyond the settings: the two panes it can
/// toggle. They live in `state.json`, not in the settings (PLAN.md §4.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MenuFlags {
    pub sidebar_visible: bool,
    pub board_visible: bool,
}

impl Default for MenuFlags {
    fn default() -> Self {
        MenuFlags {
            sidebar_visible: true,
            board_visible: false,
        }
    }
}

/// One menu item. The accelerator is best-effort: an item whose chord string
/// the platform refuses still exists (the UI binds every chord itself), which
/// is strictly better than failing to build a menu bar at launch.
fn item(
    app: &AppHandle,
    id: &str,
    label: String,
    accelerator: &str,
) -> tauri::Result<MenuItem<Wry>> {
    if !accelerator.is_empty() {
        if let Ok(built) = MenuItemBuilder::with_id(id, &label)
            .accelerator(accelerator)
            .build(app)
        {
            return Ok(built);
        }
    }
    MenuItemBuilder::with_id(id, label).build(app)
}

/// Build the whole menu bar for `settings` and `flags`.
pub fn build(
    app: &AppHandle,
    cat: &Catalog,
    settings: &Settings,
    flags: MenuFlags,
) -> tauri::Result<Menu<Wry>> {
    let app_name = cat.t("app.name");

    let app_menu = SubmenuBuilder::new(app, &app_name)
        .about(Some(AboutMetadata {
            name: Some(app_name.clone()),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
            ..Default::default()
        }))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file = SubmenuBuilder::new(app, cat.t("menu.file.title"))
        .item(&item(
            app,
            "file.newNote",
            cat.t("menu.file.newNote"),
            "CmdOrCtrl+KeyN",
        )?)
        .item(&item(
            app,
            "tree.newFolder",
            cat.t("menu.file.newFolder"),
            "Shift+CmdOrCtrl+KeyN",
        )?)
        .item(&item(app, "board.new", cat.t("menu.file.newBoard"), "")?)
        .separator()
        .item(&item(
            app,
            "vault.open",
            cat.t("menu.file.openVault"),
            "CmdOrCtrl+KeyO",
        )?)
        .separator()
        .item(&item(
            app,
            "file.save",
            cat.t("menu.file.save"),
            "CmdOrCtrl+KeyS",
        )?)
        // Rename and Move to Trash carry no accelerator on purpose: `Enter`
        // and `Cmd+Delete` are tree-scoped in docs/KEYMAP.md and would shadow
        // the editor's newline and delete-to-line-start if the menu owned them.
        .item(&item(app, "tree.rename", cat.t("menu.file.rename"), "")?)
        .item(&item(
            app,
            "tree.trash",
            cat.t("menu.file.moveToTrash"),
            "",
        )?)
        .separator()
        .item(&item(
            app,
            "tab.close",
            cat.t("menu.file.closeTab"),
            "CmdOrCtrl+KeyW",
        )?)
        .item(&item(
            app,
            "tab.reopenClosed",
            cat.t("menu.file.reopenClosedTab"),
            "Shift+CmdOrCtrl+KeyT",
        )?)
        .build()?;

    let spelling = SubmenuBuilder::new(app, cat.t("menu.edit.spelling"))
        .item(
            &CheckMenuItemBuilder::with_id(
                "settings.spellcheck",
                cat.t("menu.edit.checkSpellingWhileTyping"),
            )
            .checked(settings.spellcheck)
            .build(app)?,
        )
        .build()?;

    let edit = SubmenuBuilder::new(app, cat.t("menu.edit.title"))
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&item(
            app,
            "find.open",
            cat.t("menu.edit.find"),
            "CmdOrCtrl+KeyF",
        )?)
        .item(&item(
            app,
            "find.next",
            cat.t("menu.edit.findNext"),
            "CmdOrCtrl+KeyG",
        )?)
        .item(&item(
            app,
            "find.previous",
            cat.t("menu.edit.findPrevious"),
            "Shift+CmdOrCtrl+KeyG",
        )?)
        .item(&item(
            app,
            "find.replace",
            cat.t("menu.edit.findAndReplace"),
            "Alt+CmdOrCtrl+KeyF",
        )?)
        .item(&item(
            app,
            "search.vault",
            cat.t("menu.edit.findInVault"),
            "Shift+CmdOrCtrl+KeyF",
        )?)
        .item(&item(
            app,
            "editor.gotoLine",
            cat.t("menu.edit.gotoLine"),
            "Ctrl+KeyG",
        )?)
        .separator()
        .item(&item(
            app,
            "editor.selectNextOccurrence",
            cat.t("menu.edit.selectNextOccurrence"),
            "CmdOrCtrl+KeyD",
        )?)
        .item(&item(
            app,
            "editor.selectAllOccurrences",
            cat.t("menu.edit.selectAllOccurrences"),
            "Shift+CmdOrCtrl+KeyL",
        )?)
        .item(&item(
            app,
            "editor.addCursorAbove",
            cat.t("menu.edit.addCursorAbove"),
            "Ctrl+Shift+ArrowUp",
        )?)
        .item(&item(
            app,
            "editor.addCursorBelow",
            cat.t("menu.edit.addCursorBelow"),
            "Ctrl+Shift+ArrowDown",
        )?)
        .separator()
        .item(&item(
            app,
            "editor.moveLineUp",
            cat.t("menu.edit.moveLineUp"),
            "Ctrl+CmdOrCtrl+ArrowUp",
        )?)
        .item(&item(
            app,
            "editor.moveLineDown",
            cat.t("menu.edit.moveLineDown"),
            "Ctrl+CmdOrCtrl+ArrowDown",
        )?)
        .item(&item(
            app,
            "editor.duplicateLine",
            cat.t("menu.edit.duplicateLine"),
            "Shift+CmdOrCtrl+KeyD",
        )?)
        .item(&item(
            app,
            "editor.deleteLine",
            cat.t("menu.edit.deleteLine"),
            "Ctrl+Shift+KeyK",
        )?)
        .item(&item(
            app,
            "editor.toggleComment",
            cat.t("menu.edit.toggleComment"),
            "CmdOrCtrl+Slash",
        )?)
        .separator()
        .item(&item(
            app,
            "markdown.bold",
            cat.t("menu.edit.bold"),
            "CmdOrCtrl+KeyB",
        )?)
        .item(&item(
            app,
            "markdown.italic",
            cat.t("menu.edit.italic"),
            "CmdOrCtrl+KeyI",
        )?)
        .item(&item(
            app,
            "markdown.link",
            cat.t("menu.edit.insertLink"),
            "CmdOrCtrl+KeyK",
        )?)
        .item(&item(
            app,
            "markdown.toggleCheckbox",
            cat.t("menu.edit.toggleCheckbox"),
            "CmdOrCtrl+Enter",
        )?)
        .separator()
        .item(&spelling)
        .build()?;

    let appearance = SubmenuBuilder::new(app, cat.t("menu.view.appearance"))
        .item(
            &CheckMenuItemBuilder::with_id(
                "settings.appearance.system",
                cat.t("settings.appearance.system"),
            )
            .checked(settings.appearance == Appearance::System)
            .build(app)?,
        )
        .item(
            &CheckMenuItemBuilder::with_id(
                "settings.appearance.light",
                cat.t("settings.appearance.light"),
            )
            .checked(settings.appearance == Appearance::Light)
            .build(app)?,
        )
        .item(
            &CheckMenuItemBuilder::with_id(
                "settings.appearance.dark",
                cat.t("settings.appearance.dark"),
            )
            .checked(settings.appearance == Appearance::Dark)
            .build(app)?,
        )
        .build()?;

    let language = SubmenuBuilder::new(app, cat.t("menu.view.language"))
        .item(
            &CheckMenuItemBuilder::with_id(
                "settings.language.system",
                cat.t("settings.language.system"),
            )
            .checked(settings.language == Language::System)
            .build(app)?,
        )
        .item(
            &CheckMenuItemBuilder::with_id("settings.language.de", cat.t("settings.language.de"))
                .checked(settings.language == Language::De)
                .build(app)?,
        )
        .item(
            &CheckMenuItemBuilder::with_id("settings.language.en", cat.t("settings.language.en"))
                .checked(settings.language == Language::En)
                .build(app)?,
        )
        .build()?;

    let sidebar_label = if flags.sidebar_visible {
        cat.t("menu.view.hideSidebar")
    } else {
        cat.t("menu.view.showSidebar")
    };
    let board_label = if flags.board_visible {
        cat.t("menu.view.hideBoard")
    } else {
        cat.t("menu.view.showBoard")
    };

    let view = SubmenuBuilder::new(app, cat.t("menu.view.title"))
        .item(&item(
            app,
            "sidebar.toggle",
            sidebar_label,
            "CmdOrCtrl+Backslash",
        )?)
        .item(&item(
            app,
            "board.toggle",
            board_label,
            "Shift+CmdOrCtrl+KeyB",
        )?)
        .separator()
        .item(&item(
            app,
            "view.fontLarger",
            cat.t("menu.view.fontLarger"),
            "CmdOrCtrl+Equal",
        )?)
        .item(&item(
            app,
            "view.fontSmaller",
            cat.t("menu.view.fontSmaller"),
            "CmdOrCtrl+Minus",
        )?)
        .item(&item(
            app,
            "view.fontReset",
            cat.t("menu.view.fontReset"),
            "CmdOrCtrl+Digit0",
        )?)
        .separator()
        .item(&appearance)
        .item(&language)
        .separator()
        .fullscreen()
        .build()?;

    let go = SubmenuBuilder::new(app, cat.t("menu.go.title"))
        .item(&item(
            app,
            "quickOpen.open",
            cat.t("menu.go.quickOpen"),
            "CmdOrCtrl+KeyP",
        )?)
        .item(&item(
            app,
            "palette.open",
            cat.t("menu.go.commandPalette"),
            "Shift+CmdOrCtrl+KeyP",
        )?)
        .separator()
        .item(&item(
            app,
            "nav.back",
            cat.t("menu.go.back"),
            "CmdOrCtrl+BracketLeft",
        )?)
        .item(&item(
            app,
            "nav.forward",
            cat.t("menu.go.forward"),
            "CmdOrCtrl+BracketRight",
        )?)
        .separator()
        .item(&item(
            app,
            "tab.previous",
            cat.t("menu.go.previousTab"),
            "Shift+CmdOrCtrl+BracketLeft",
        )?)
        .item(&item(
            app,
            "tab.next",
            cat.t("menu.go.nextTab"),
            "Shift+CmdOrCtrl+BracketRight",
        )?)
        .build()?;

    let window = SubmenuBuilder::new(app, cat.t("menu.window.title"))
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &view, &go, &window])
        .build()
}

/// Rebuild and install the menu for the current settings.
pub fn install(
    app: &AppHandle,
    cat: &Catalog,
    settings: &Settings,
    flags: MenuFlags,
) -> tauri::Result<()> {
    let menu = build(app, cat, settings, flags)?;
    app.set_menu(menu)?;
    Ok(())
}

/// Forward a menu click to the UI as one `menu-action` event.
pub fn dispatch(app: &AppHandle, id: &str) {
    let _ = MenuAction { id: id.to_string() }.emit(app);
}
