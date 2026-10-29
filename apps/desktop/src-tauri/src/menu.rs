//! The native menu bar, built from `i18n/*.json` (PLAN.md §5.3, §5.8).
//!
//! The groups are sebaro's (DSK-08, spec/02 §4.24, spec/09 §13.1; ADR-0051):
//! the app menu, File, Edit, View, Window and Help. There is no Go menu:
//! Quick Open and Today's Note are in File, back/forward and the tabs in
//! Window, Commands… last in View.
//!
//! The bar is data first ([`layout`]), so its structure is tested without a
//! running app, and [`build`] makes the native menus from it. Every label is
//! a catalog key, the predefined items' too (About, Services, Hide, Minimize,
//! Zoom, Full Screen and the six of the clipboard group): muda's own texts are
//! English in every language. Command ids are the ones in `docs/KEYMAP.md`,
//! so a menu click and the matching chord dispatch the same UI command.
//!
//! The menu carries no state of its own: it is rebuilt whenever a setting that
//! it displays changes (appearance, tone, language, spellcheck, sidebar/board
//! visibility, the sidebar width's check) or an item gains or loses its
//! target ([`has_target`]), which is cheaper and less error-prone than
//! mutating items in place. The one exception is a click on a choice that is
//! already checked ([`check_again`]).

use novalis_core::settings::{Appearance, Language, Settings, Tone};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::time::Duration;
use tauri::menu::{
    AboutMetadata, CheckMenuItem, CheckMenuItemBuilder, Menu, MenuBuilder, MenuItem,
    MenuItemBuilder, MenuItemKind, PredefinedMenuItem, Submenu, SubmenuBuilder,
};

use tauri::{AppHandle, Manager, Wry};
use tauri_specta::Event;

use crate::dto::MenuTargetsDto;
use crate::i18n::Catalog;
use crate::state::AppState;

/// What the UI sees when a menu item is clicked. `id` is a `docs/KEYMAP.md`
/// command id, or a `menu.`-prefixed id for the items that have no chord.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct MenuAction {
    pub id: String,
}

/// The catalog keys of the context menus ([`tree_context`], [`card_context`]).
/// The i18n test walks this list and every key of [`layout`] ([`layout_keys`]),
/// so a typo fails `cargo test` instead of showing up as a raw key in a menu.
/// Test-only data: it exists to be checked, not to be read at runtime.
#[cfg(test)]
pub const MENU_KEYS: &[&str] = &[
    "menu.file.revealInFinder",
    "menu.file.openInDefaultApp",
    "menu.file.rename",
    "menu.edit.moveTo",
    "menu.edit.moveToTrash",
    "menu.file.newNoteItem",
    "menu.file.newFolderItem",
    "board.openNote",
    "board.editDescription",
    "board.linkNote",
    "board.deleteCard",
    "board.moveToColumn",
    "board.createNote",
];

/// Every catalog key of the menu bar, titles included.
#[cfg(test)]
pub fn layout_keys() -> Vec<&'static str> {
    fn walk(entries: &[Entry], out: &mut Vec<&'static str>) {
        for entry in entries {
            match entry {
                Entry::Item(_, key, _) | Entry::Check(_, key, _, _) | Entry::Predefined(_, key) => {
                    out.push(key)
                }
                Entry::Submenu(key, entries) => {
                    out.push(key);
                    walk(entries, out);
                }
                Entry::Separator => {}
            }
        }
    }
    let mut out = Vec::new();
    for group in layout(&Settings::default(), MenuFlags::default()) {
        out.push(group.title);
        walk(&group.entries, &mut out);
    }
    out
}

/// The Help menu's id, for [`install`] to find it again.
const HELP_MENU: &str = "menu.help";

/// The Window menu's id, for [`install`] to name it the system's: macOS lists
/// the open windows below it (spec/09 §13.1 `install_mac_menu`, spec/02
/// §4.24).
const WINDOW_MENU: &str = "menu.window";

/// View ▸ Sidebar Width ▸ Narrow · Normal · Wide (spec/02 §4.23, DSK-07,
/// ADR-0051): menu id, catalog key and width in px. The UI's `SIDEBAR_WIDTH`
/// has the same three widths (sebaro D100).
pub const SIDEBAR_WIDTHS: [(&str, &str, u32); 3] = [
    ("sidebar.width.min", "sidebar.width.narrow", 200),
    ("sidebar.width.start", "sidebar.width.normal", 240),
    ("sidebar.width.max", "sidebar.width.wide", 360),
];

/// The width of the three that `width` is, if any: the check follows the
/// sidebar's own width, and none is checked while a dragged width lies
/// between them.
pub fn sidebar_width_step(width: u32) -> Option<u32> {
    SIDEBAR_WIDTHS
        .iter()
        .map(|&(_, _, step)| step)
        .find(|&step| step == width)
}

/// What the menu needs to know beyond the settings: the panes it can
/// toggle and the sidebar's width, which live in `state.json`, not in the
/// settings (PLAN.md §4.1), and which commands have a target now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MenuFlags {
    pub sidebar_visible: bool,
    pub board_visible: bool,
    /// The backlinks pane (ADR-0043): View ▸ Show/Hide Backlinks.
    pub backlinks_visible: bool,
    /// The checked step of View ▸ Sidebar Width ([`sidebar_width_step`]).
    pub sidebar_width: Option<u32>,
    /// What the commands can act on ([`has_target`]); none at launch, until
    /// the UI's first `state_save`.
    pub targets: MenuTargetsDto,
}

impl Default for MenuFlags {
    fn default() -> Self {
        MenuFlags {
            sidebar_visible: true,
            board_visible: false,
            backlinks_visible: false,
            sidebar_width: Some(SIDEBAR_WIDTHS[1].2),
            targets: MenuTargetsDto::default(),
        }
    }
}

/// Whether View ▸ Sidebar carries its check: the sidebar shows. Beside the
/// content that is the choice in `state.json`; in a window too narrow for
/// it, whether its overlay is open (spec/02 §4.17, §4.18: the item keeps the
/// shown state, as the title bar's tool does).
pub fn sidebar_checked(visible: bool, targets: &MenuTargetsDto) -> bool {
    if targets.sidebar_overlay {
        targets.sidebar_overlay_open
    } else {
        visible
    }
}

/// Whether the menu bar's item `id` has something to act on (sebaro D102
/// (9), spec/02 §4.24): one without is switched off, never hidden and never
/// a silent no-op. The conditions are the commands' own in
/// `ui/src/lib/commands.ts` (`menuTargetsNow`); an id not named here always
/// acts.
pub fn has_target(targets: &MenuTargetsDto, id: &str) -> bool {
    match id {
        "file.newNote" | "tree.newFolder" | "board.new" | "quickOpen.open" | "file.todayNote"
        | "search.vault" => targets.vault,
        "file.save" => targets.save,
        "tab.close" => targets.close,
        "tab.reopenClosed" => targets.reopen,
        "tree.reveal" => targets.path,
        "tree.rename" | "tree.trash" => targets.vault_path,
        "tree.moveTo" => targets.movable,
        "nav.back" => targets.back,
        "nav.forward" => targets.forward,
        "note.togglePreview" => targets.preview,
        "tab.previous" | "tab.next" => targets.cycle,
        "tab.moveEarlier" => targets.earlier,
        "tab.moveLater" => targets.later,
        id if id.starts_with("find.")
            || id.starts_with("editor.")
            || id.starts_with("markdown.") =>
        {
            targets.editor
        }
        _ => true,
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

/// One check item, with the same best-effort accelerator as [`item`].
fn check(
    app: &AppHandle,
    id: &str,
    label: String,
    checked: bool,
    accelerator: &str,
) -> tauri::Result<CheckMenuItem<Wry>> {
    if !accelerator.is_empty() {
        if let Ok(built) = CheckMenuItemBuilder::with_id(id, &label)
            .checked(checked)
            .accelerator(accelerator)
            .build(app)
        {
            return Ok(built);
        }
    }
    CheckMenuItemBuilder::with_id(id, label)
        .checked(checked)
        .build(app)
}

/// A predefined item: macOS does what it says, and the text comes from the
/// catalog, since muda's own texts are English in every language („Toggle
/// Full Screen“ in the German menu; docs/sebaro-luecken.md J).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Predefined {
    About,
    Services,
    Hide,
    HideOthers,
    ShowAll,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Minimize,
    Zoom,
    Fullscreen,
}

/// One entry of a menu, as data: [`build`] makes the native items from it,
/// and the tests read the structure without a running app.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Entry {
    /// A command: its `docs/KEYMAP.md` id, catalog key and accelerator
    /// (`""` for none).
    Item(&'static str, &'static str, &'static str),
    /// A check item: id, catalog key, checked, accelerator.
    Check(&'static str, &'static str, bool, &'static str),
    Predefined(Predefined, &'static str),
    /// A submenu: catalog key and entries.
    Submenu(&'static str, Vec<Entry>),
    Separator,
}

/// One menu of the bar: its id (the Help menu's is [`HELP_MENU`]), the
/// catalog key of its title and its entries.
pub struct Group {
    pub id: Option<&'static str>,
    pub title: &'static str,
    pub entries: Vec<Entry>,
}

/// A catalog key of the menu bar, as it is: the name marks it for the i18n
/// check (`t("…")`, apps/desktop/ui/scripts/i18n-check.mjs), which then fails
/// on a key that is in neither catalog.
const fn t(key: &'static str) -> &'static str {
    key
}

/// The menu bar for `settings` and `flags`: sebaro's groups and their order
/// (DSK-08, spec/02 §4.24, spec/09 §13.1 `mac_menu`). The app's own items of a
/// menu stand in one block of their own between sebaro's groups, set off by
/// lines (D102 (8)); inside the block, lines keep its kinds apart
/// (docs/sebaro-luecken.md S).
pub fn layout(settings: &Settings, flags: MenuFlags) -> Vec<Group> {
    use Entry::{Check, Item, Separator, Submenu};
    let pre = Entry::Predefined;

    let app_menu = vec![
        pre(Predefined::About, t("menu.app.about")),
        Separator,
        // The settings view (DSK-02, spec/09 §13.1 `mac_menu`, ADR-0051 #1),
        // in a group of its own before Services.
        Item("settings.open", t("menu.app.settings"), "CmdOrCtrl+Comma"),
        Separator,
        pre(Predefined::Services, t("menu.app.services")),
        Separator,
        pre(Predefined::Hide, t("menu.app.hide")),
        pre(Predefined::HideOthers, t("menu.app.hideOthers")),
        pre(Predefined::ShowAll, t("menu.app.showAll")),
        Separator,
        // Not the predefined Quit: that one terminates at once and no event
        // reaches the app, so the last second of typing was lost (D19). This
        // item asks the UI to save first — [`request_quit`].
        Item("app.quit", t("menu.app.quit"), "CmdOrCtrl+KeyQ"),
    ];

    // sebaro: Neue Notiz · Öffnen … | the app's | Schließen. novalis has one
    // window and no recent list, so New Window and Open Recent are not here
    // (PLAN.md; ⇧⌘N stays free).
    // „…“ where a dialog asks for the name first (D102 (22)); the dialog's
    // title keeps the word without it.
    let file = vec![
        Item("file.newNote", t("menu.file.newNoteItem"), "CmdOrCtrl+KeyN"),
        Item("vault.open", t("menu.file.openVault"), "CmdOrCtrl+KeyO"),
        Separator,
        Item(
            "tree.newFolder",
            t("menu.file.newFolderItem"),
            "Alt+CmdOrCtrl+KeyN",
        ),
        Item("board.new", t("menu.file.newBoardItem"), ""),
        Item("quickOpen.open", t("menu.file.quickOpen"), "CmdOrCtrl+KeyP"),
        Item("file.todayNote", t("menu.file.todayNote"), "CmdOrCtrl+KeyJ"),
        Item("file.save", t("menu.file.save"), "CmdOrCtrl+KeyS"),
        // Rename has no chord: Enter in the tree opens the row (ADR-0051
        // #12). Move To… and Move to Trash are in Edit (ADR-0051).
        Item("tree.rename", t("menu.file.rename"), ""),
        Item("tree.reveal", t("menu.file.revealInFinder"), ""),
        Item(
            "tab.reopenClosed",
            t("menu.file.reopenClosedTab"),
            "Shift+CmdOrCtrl+KeyT",
        ),
        Separator,
        Item("tab.close", t("menu.file.closeTab"), "CmdOrCtrl+KeyW"),
    ];

    let spelling = vec![Check(
        "settings.spellcheck",
        t("menu.edit.checkSpellingWhileTyping"),
        settings.spellcheck,
        "",
    )];

    // The six predefined items keep text editing working (spec/09 §13.1).
    let edit = vec![
        pre(Predefined::Undo, t("menu.edit.undo")),
        pre(Predefined::Redo, t("menu.edit.redo")),
        Separator,
        pre(Predefined::Cut, t("menu.edit.cut")),
        pre(Predefined::Copy, t("menu.edit.copy")),
        pre(Predefined::Paste, t("menu.edit.paste")),
        pre(Predefined::SelectAll, t("menu.edit.selectAll")),
        Separator,
        Item("find.open", t("menu.edit.find"), "CmdOrCtrl+KeyF"),
        // sebaro's way to move a row without dragging (DSK-11, spec/02
        // §4.22, §4.24, ADR-0051 #5).
        Item("tree.moveTo", t("menu.edit.moveTo"), ""),
        Separator,
        Item("find.next", t("menu.edit.findNext"), "CmdOrCtrl+KeyG"),
        Item(
            "find.previous",
            t("menu.edit.findPrevious"),
            "Shift+CmdOrCtrl+KeyG",
        ),
        Item(
            "find.replace",
            t("menu.edit.findAndReplace"),
            "Alt+CmdOrCtrl+KeyF",
        ),
        Item(
            "search.vault",
            t("menu.edit.findInVault"),
            "Shift+CmdOrCtrl+KeyF",
        ),
        Item("editor.gotoLine", t("menu.edit.gotoLine"), "Ctrl+KeyG"),
        Separator,
        Item(
            "editor.selectNextOccurrence",
            t("menu.edit.selectNextOccurrence"),
            "CmdOrCtrl+KeyD",
        ),
        Item(
            "editor.selectAllOccurrences",
            t("menu.edit.selectAllOccurrences"),
            "Shift+CmdOrCtrl+KeyL",
        ),
        Item(
            "editor.addCursorAbove",
            t("menu.edit.addCursorAbove"),
            "Ctrl+Shift+ArrowUp",
        ),
        Item(
            "editor.addCursorBelow",
            t("menu.edit.addCursorBelow"),
            "Ctrl+Shift+ArrowDown",
        ),
        Separator,
        Item(
            "editor.moveLineUp",
            t("menu.edit.moveLineUp"),
            "Ctrl+CmdOrCtrl+ArrowUp",
        ),
        Item(
            "editor.moveLineDown",
            t("menu.edit.moveLineDown"),
            "Ctrl+CmdOrCtrl+ArrowDown",
        ),
        Item(
            "editor.duplicateLine",
            t("menu.edit.duplicateLine"),
            "Shift+CmdOrCtrl+KeyD",
        ),
        Item(
            "editor.deleteLine",
            t("menu.edit.deleteLine"),
            "Ctrl+Shift+KeyK",
        ),
        Item(
            "editor.toggleComment",
            t("menu.edit.toggleComment"),
            "CmdOrCtrl+Slash",
        ),
        Separator,
        Item("markdown.bold", t("menu.edit.bold"), "CmdOrCtrl+KeyB"),
        Item("markdown.italic", t("menu.edit.italic"), "CmdOrCtrl+KeyI"),
        Item(
            "markdown.link",
            t("menu.edit.insertLink"),
            "Shift+CmdOrCtrl+KeyK",
        ),
        Item(
            "markdown.toggleCheckbox",
            t("menu.edit.toggleCheckbox"),
            "CmdOrCtrl+Enter",
        ),
        Separator,
        Submenu(t("menu.edit.spelling"), spelling),
        // sebaro's Delete is last in Edit after a line (DSK-08), worded for
        // what it does (ADR-0051 #7, D102 (19)). No accelerator: `Cmd+Backspace`
        // is tree-scoped and would take the editor's delete-to-line-start
        // (spec/09 §13.1); the page handles it.
        Separator,
        Item("tree.trash", t("menu.edit.moveToTrash"), ""),
    ];

    let appearance = vec![
        Check(
            "settings.appearance.system",
            t("settings.appearance.system"),
            settings.appearance == Appearance::System,
            "",
        ),
        Check(
            "settings.appearance.light",
            t("settings.appearance.light"),
            settings.appearance == Appearance::Light,
            "",
        ),
        Check(
            "settings.appearance.dark",
            t("settings.appearance.dark"),
            settings.appearance == Appearance::Dark,
            "",
        ),
    ];
    // sebaro's „Farbton: Kühl · Warm“ right after „Hell oder Dunkel“
    // (FAR-15, D102 (8), spec/11 §1a, ADR-0051).
    let tone = vec![
        Check(
            "settings.tone.cool",
            t("settings.tone.cool"),
            settings.tone == Tone::Cool,
            "",
        ),
        Check(
            "settings.tone.warm",
            t("settings.tone.warm"),
            settings.tone == Tone::Warm,
            "",
        ),
    ];
    let language = vec![
        Check(
            "settings.language.system",
            t("settings.language.system"),
            settings.language == Language::System,
            "",
        ),
        Check(
            "settings.language.de",
            t("settings.language.de"),
            settings.language == Language::De,
            "",
        ),
        Check(
            "settings.language.en",
            t("settings.language.en"),
            settings.language == Language::En,
            "",
        ),
    ];
    let sidebar_width = SIDEBAR_WIDTHS
        .iter()
        .map(|&(id, key, width)| Check(id, key, flags.sidebar_width == Some(width), ""))
        .collect();

    // sebaro: Seitenleiste · Breite der Seitenleiste | the app's | Hell oder
    // Dunkel · Farbton · Bewegung | Schrift größer · kleiner | Befehle …
    // (spec/02 §4.24). No inspector, so neither its item nor its width
    // (ADR-0051 #8).
    let view = vec![
        Check(
            "sidebar.toggle",
            t("menu.view.sidebar"),
            flags.sidebar_visible,
            "Ctrl+CmdOrCtrl+KeyS",
        ),
        Submenu(t("menu.view.sidebarWidth"), sidebar_width),
        Separator,
        Check(
            "board.toggle",
            t("menu.view.board"),
            flags.board_visible,
            "Shift+CmdOrCtrl+KeyB",
        ),
        // The current tab's preview (ADR-0020, ADR-0025, ADR-0051 #43): the
        // check follows it, and a tab without one switches the item off.
        Check(
            "note.togglePreview",
            t("menu.view.preview"),
            flags.targets.previewing,
            "CmdOrCtrl+KeyE",
        ),
        Check(
            "backlinks.toggle",
            t("menu.view.backlinks"),
            flags.backlinks_visible,
            "",
        ),
        Submenu(t("menu.view.language"), language),
        Item(
            "view.fontReset",
            t("menu.view.fontReset"),
            "CmdOrCtrl+Digit0",
        ),
        pre(Predefined::Fullscreen, t("menu.view.fullScreen")),
        Separator,
        Submenu(t("menu.view.appearance"), appearance),
        Submenu(t("menu.view.tone"), tone),
        Check(
            "settings.reduceMotion",
            t("menu.view.reduceMotion"),
            settings.reduce_motion,
            "",
        ),
        Separator,
        // ⌘+ and ⌘− are the page's (docs/KEYMAP.md): an accelerator binds a
        // key's position, and „+“ is a key of its own on the German layout
        // (spec/09 §13.1, ADR-0051). So these two show no chord.
        Item("view.fontLarger", t("menu.view.fontLarger"), ""),
        Item("view.fontSmaller", t("menu.view.fontSmaller"), ""),
        Separator,
        Item("palette.open", t("menu.view.commands"), "CmdOrCtrl+KeyK"),
    ];

    // sebaro: Minimieren · Nächster / Vorheriger Bereich (F6 / ⇧F6, spec/02
    // §4.20; here too, since Mac keyboards often need fn for F6) · Reiter
    // nach vorn / hinten (the way to reorder the tabs without a pointer,
    // §4.21, D102 (5)) | the app's. Zoom keeps its macOS place after Minimize
    // (docs/sebaro-luecken.md S).
    let window = vec![
        pre(Predefined::Minimize, t("menu.window.minimize")),
        pre(Predefined::Zoom, t("menu.window.zoom")),
        Item("area.next", t("menu.window.nextArea"), "F6"),
        Item("area.previous", t("menu.window.previousArea"), "Shift+F6"),
        Item("tab.moveEarlier", t("menu.window.moveTabEarlier"), ""),
        Item("tab.moveLater", t("menu.window.moveTabLater"), ""),
        Separator,
        // Back / Forward are ⌘← / ⌘→ and ⌃⌘← / ⌃⌘→ (D102 (14), ADR-0051
        // #36), the page's like ⌘⌫: an accelerator could take ⌘← / ⌘→ from
        // the text fields, where they go to the line's start and end, so the
        // two items show no chord (spec/09 §13.1).
        Item("nav.back", t("menu.window.back"), ""),
        Item("nav.forward", t("menu.window.forward"), ""),
        Item(
            "tab.previous",
            t("menu.window.previousTab"),
            "Ctrl+Shift+Tab",
        ),
        Item("tab.next", t("menu.window.nextTab"), "Ctrl+Tab"),
        // The predefined Close Window carried a second ⌘W beside File ▸
        // Close; closing the one window quits, as its close button does (D19).
        Item("window.close", t("menu.window.close"), ""),
    ];

    vec![
        Group {
            id: None,
            title: t("app.name"),
            entries: app_menu,
        },
        Group {
            id: None,
            title: t("menu.file.title"),
            entries: file,
        },
        Group {
            id: None,
            title: t("menu.edit.title"),
            entries: edit,
        },
        Group {
            id: None,
            title: t("menu.view.title"),
            entries: view,
        },
        Group {
            id: Some(WINDOW_MENU),
            title: t("menu.window.title"),
            entries: window,
        },
        // Only the search field macOS puts into the Help menu: no help pages,
        // no "Report a Bug", no update check — nothing that needs the network
        // (ADR-0051 #6, docs/PRIVACY.md). [`install`] names it the Help menu.
        Group {
            id: Some(HELP_MENU),
            title: t("menu.help.title"),
            entries: Vec::new(),
        },
    ]
}

/// The native item of one predefined entry, with its text.
fn predefined(
    app: &AppHandle,
    cat: &Catalog,
    kind: Predefined,
    text: &str,
) -> tauri::Result<PredefinedMenuItem<Wry>> {
    let text = Some(text);
    match kind {
        Predefined::About => {
            let name = cat.t("app.name");
            PredefinedMenuItem::about(
                app,
                text,
                Some(AboutMetadata {
                    name: Some(name),
                    version: Some(env!("CARGO_PKG_VERSION").to_string()),
                    ..Default::default()
                }),
            )
        }
        Predefined::Services => PredefinedMenuItem::services(app, text),
        Predefined::Hide => PredefinedMenuItem::hide(app, text),
        Predefined::HideOthers => PredefinedMenuItem::hide_others(app, text),
        Predefined::ShowAll => PredefinedMenuItem::show_all(app, text),
        Predefined::Undo => PredefinedMenuItem::undo(app, text),
        Predefined::Redo => PredefinedMenuItem::redo(app, text),
        Predefined::Cut => PredefinedMenuItem::cut(app, text),
        Predefined::Copy => PredefinedMenuItem::copy(app, text),
        Predefined::Paste => PredefinedMenuItem::paste(app, text),
        Predefined::SelectAll => PredefinedMenuItem::select_all(app, text),
        Predefined::Minimize => PredefinedMenuItem::minimize(app, text),
        Predefined::Zoom => PredefinedMenuItem::maximize(app, text),
        Predefined::Fullscreen => PredefinedMenuItem::fullscreen(app, text),
    }
}

/// The native submenu of `title` with `entries`; an item without a target
/// in `targets` is switched off ([`has_target`]).
fn submenu(
    app: &AppHandle,
    cat: &Catalog,
    id: Option<&str>,
    title: &str,
    entries: &[Entry],
    targets: &MenuTargetsDto,
) -> tauri::Result<Submenu<Wry>> {
    let title = cat.t(title);
    let mut menu = match id {
        Some(id) => SubmenuBuilder::with_id(app, id, title),
        None => SubmenuBuilder::new(app, title),
    };
    for entry in entries {
        menu = match entry {
            Entry::Item(id, key, accelerator) => {
                let built = item(app, id, cat.t(key), accelerator)?;
                if !has_target(targets, id) {
                    built.set_enabled(false)?;
                }
                menu.item(&built)
            }
            Entry::Check(id, key, checked, accelerator) => {
                let built = check(app, id, cat.t(key), *checked, accelerator)?;
                if !has_target(targets, id) {
                    built.set_enabled(false)?;
                }
                menu.item(&built)
            }
            Entry::Predefined(kind, key) => menu.item(&predefined(app, cat, *kind, &cat.t(key))?),
            Entry::Submenu(key, entries) => {
                menu.item(&submenu(app, cat, None, key, entries, targets)?)
            }
            Entry::Separator => menu.separator(),
        };
    }
    menu.build()
}

/// Build the whole menu bar for `settings` and `flags`.
pub fn build(
    app: &AppHandle,
    cat: &Catalog,
    settings: &Settings,
    flags: MenuFlags,
) -> tauri::Result<Menu<Wry>> {
    let mut bar = MenuBuilder::new(app);
    for group in layout(settings, flags) {
        bar = bar.item(&submenu(
            app,
            cat,
            group.id,
            group.title,
            &group.entries,
            &flags.targets,
        )?);
    }
    bar.build()
}

/// The tree's context menu (ADR-0021): the File and Edit menus' own items,
/// with their ids, for the row the UI has selected. A board row has its
/// rename and delete in the board pane, so it gets "Show in Finder" alone;
/// a folder has no "Move To…" (folders do not move, ADR-0018). Move to
/// Trash comes last after a separator, as in the card's menu (AKT-10,
/// ADR-0051 #19).
pub fn tree_context(
    app: &AppHandle,
    cat: &Catalog,
    board: bool,
    folder: bool,
) -> tauri::Result<Menu<Wry>> {
    let mut menu = MenuBuilder::new(app);
    for entry in tree_context_entries(board, folder) {
        menu = match entry {
            Some((id, key)) => menu.item(&item(app, id, cat.t(key), "")?),
            None => menu.separator(),
        };
    }
    menu.build()
}

/// [`tree_context`]'s items as `(id, catalog key)`, `None` for a separator:
/// what to show, apart from building it, so a test can read the order.
fn tree_context_entries(board: bool, folder: bool) -> Vec<Option<(&'static str, &'static str)>> {
    let mut entries = vec![Some(("tree.reveal", "menu.file.revealInFinder"))];
    if board {
        return entries;
    }
    entries.push(Some(("tree.openDefault", "menu.file.openInDefaultApp")));
    entries.push(Some(("tree.rename", "menu.file.rename")));
    if !folder {
        entries.push(Some(("tree.moveTo", "menu.edit.moveTo")));
    }
    entries.extend([
        None,
        Some(("file.newNote", "menu.file.newNoteItem")),
        Some(("tree.newFolder", "menu.file.newFolderItem")),
        None,
        Some(("tree.trash", "menu.edit.moveToTrash")),
    ]);
    entries
}

/// The prefix of a card menu's column items (ADR-0032): the rest of the id is
/// the column id, which the UI reads back off the `MenuAction`.
pub const MOVE_TO_COLUMN: &str = "card.moveToColumn:";

/// A card's context menu (ADR-0032), in the order of the card's „Mehr“
/// menu in the pane (AKT-10, ADR-0051 #19, #41): the card's actions, Link
/// Note… among them, its board's columns, and Delete Card last after a
/// separator. The UI remembers which
/// card was right-clicked; the ids say only what to do with it.
pub fn card_context(
    app: &AppHandle,
    cat: &Catalog,
    columns: &[(String, String)],
    current: &str,
    has_note: bool,
) -> tauri::Result<Menu<Wry>> {
    let mut menu = MenuBuilder::new(app);
    if has_note {
        menu = menu.item(&item(app, "card.openNote", cat.t("board.openNote"), "")?);
    }
    menu = menu
        .item(&item(app, "card.rename", cat.t("menu.file.rename"), "")?)
        .item(&item(
            app,
            "card.editDescription",
            cat.t("board.editDescription"),
            "",
        )?)
        .item(&item(app, "card.linkNote", cat.t("board.linkNote"), "")?)
        .item(&item(
            app,
            "card.createNote",
            cat.t("board.createNote"),
            "",
        )?);
    if columns.len() > 1 {
        let mut move_to = SubmenuBuilder::new(app, cat.t("board.moveToColumn"));
        for (id, name) in columns {
            move_to = move_to.item(
                &MenuItemBuilder::with_id(format!("{MOVE_TO_COLUMN}{id}"), name)
                    .enabled(id != current)
                    .build(app)?,
            );
        }
        menu = menu.item(&move_to.build()?);
    }
    menu.separator()
        .item(&item(app, "card.delete", cat.t("board.deleteCard"), "")?)
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
    app.set_menu(menu.clone())?;
    // macOS lists the open windows only in the menu named the Window menu and
    // adds its search field only to the one named the Help menu; both names
    // can be given only once the menu bar is installed (spec/09 §13.1).
    #[cfg(target_os = "macos")]
    {
        if let Some(window) = menu
            .get(WINDOW_MENU)
            .and_then(|kind| kind.as_submenu().cloned())
        {
            window.set_as_windows_menu_for_nsapp()?;
        }
        if let Some(help) = menu
            .get(HELP_MENU)
            .and_then(|kind| kind.as_submenu().cloned())
        {
            help.set_as_help_menu_for_nsapp()?;
        }
    }
    Ok(())
}

/// The check items that are one choice of several: View ▸ Appearance,
/// View ▸ Tone, View ▸ Language and View ▸ Sidebar Width (spec/09 §13.1,
/// ADR-0051).
fn is_choice(id: &str) -> bool {
    id.starts_with("settings.appearance.")
        || id.starts_with("settings.tone.")
        || id.starts_with("settings.language.")
        || SIDEBAR_WIDTHS.iter().any(|&(item, _, _)| item == id)
}

/// Check the item `id` again, wherever it is in `items`. macOS toggles a
/// check item on click, so a click on the choice already checked took its
/// check away; nothing changed, so no rebuild put it back. A click on
/// another choice changes it, and the rebuild that follows unchecks the old.
/// Not yet seen in the built app.
fn check_again(items: Vec<MenuItemKind<Wry>>, id: &str) -> bool {
    items.into_iter().any(|kind| {
        if let Some(check) = kind.as_check_menuitem() {
            check.id().as_ref() == id && check.set_checked(true).is_ok()
        } else if let Some(submenu) = kind.as_submenu() {
            submenu.items().is_ok_and(|items| check_again(items, id))
        } else {
            false
        }
    })
}

/// Forward a menu click to the UI as one `menu-action` event.
pub fn dispatch(app: &AppHandle, id: &str) {
    // Window ▸ Close Window: closing the one window quits, as its close
    // button does (D19), on the same save-first path as ⌘Q.
    if id == "app.quit" || id == "window.close" {
        request_quit(app);
        return;
    }
    if is_choice(id) {
        if let Some(Ok(items)) = app.menu().map(|menu| menu.items()) {
            check_again(items, id);
        }
    }
    let _ = MenuAction { id: id.to_string() }.emit(app);
}

/// How long a quit waits for the UI before the app exits anyway: the UI caps
/// its own flush at two seconds, so this only fires when the page is gone.
const QUIT_FALLBACK: Duration = Duration::from_secs(3);

/// ⌘Q, Quit in the menu and the window's close button (D19): the UI saves
/// every open buffer, then sends its last `state_save` with `quit`, and the
/// shell exits there. Quitting never hangs — after [`QUIT_FALLBACK`] the app
/// exits whatever the page is doing.
pub fn request_quit(app: &AppHandle) {
    let first = app
        .try_state::<AppState>()
        .map(|state| state.begin_quit())
        .unwrap_or(true);
    if !first {
        return;
    }
    let _ = MenuAction {
        id: "app.quit".to_string(),
    }
    .emit(app);
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(QUIT_FALLBACK);
        handle.exit(0);
    });
}

#[cfg(test)]
mod tests {
    use super::{
        has_target, is_choice, layout, sidebar_checked, sidebar_width_step, tree_context_entries,
        Entry, Group, MenuFlags, Predefined, HELP_MENU, MENU_KEYS, SIDEBAR_WIDTHS, WINDOW_MENU,
    };
    use crate::dto::{MenuTargetsDto, UiStateDto};
    use novalis_core::settings::{Appearance, Settings};
    use std::collections::BTreeMap;

    fn bar() -> Vec<Group> {
        layout(&Settings::default(), MenuFlags::default())
    }

    fn group(title: &str) -> Vec<Entry> {
        bar()
            .into_iter()
            .find(|group| group.title == title)
            .unwrap_or_else(|| panic!("no menu {title}"))
            .entries
    }

    /// The ids of a menu's items, a line as `|`, a submenu as its key.
    fn ids(entries: &[Entry]) -> Vec<String> {
        entries
            .iter()
            .map(|entry| match entry {
                Entry::Item(id, _, _) | Entry::Check(id, _, _, _) => (*id).to_string(),
                Entry::Predefined(kind, _) => format!("{kind:?}"),
                Entry::Submenu(key, _) => (*key).to_string(),
                Entry::Separator => "|".to_string(),
            })
            .collect()
    }

    fn submenu<'a>(entries: &'a [Entry], key: &str) -> &'a [Entry] {
        entries
            .iter()
            .find_map(|entry| match entry {
                Entry::Submenu(k, inner) if *k == key => Some(inner.as_slice()),
                _ => None,
            })
            .unwrap_or_else(|| panic!("no submenu {key}"))
    }

    fn every_entry(entries: &[Entry], out: &mut Vec<Entry>) {
        for entry in entries {
            out.push(entry.clone());
            if let Entry::Submenu(_, inner) = entry {
                every_entry(inner, out);
            }
        }
    }

    // DSK-08, spec/02 §4.24, spec/09 §13.1: the app menu, then Ablage ·
    // Bearbeiten · Darstellung · Fenster · Hilfe, and nothing else.
    #[test]
    fn the_groups_are_sebaros_in_their_order() {
        let titles: Vec<&str> = bar().iter().map(|group| group.title).collect();
        assert_eq!(
            titles,
            [
                "app.name",
                "menu.file.title",
                "menu.edit.title",
                "menu.view.title",
                "menu.window.title",
                "menu.help.title"
            ]
        );
        let mut bar = bar();
        let help = bar.pop().expect("a Help menu");
        assert_eq!(help.id, Some(HELP_MENU));
        // macOS lists the open windows under the menu named the Window menu.
        assert_eq!(bar.pop().expect("a Window menu").id, Some(WINDOW_MENU));
        // Only the search field macOS adds: nothing that needs the network.
        assert!(help.entries.is_empty());
    }

    #[test]
    fn each_menu_keeps_sebaros_items_in_sebaros_order() {
        // spec/09 §13.1 `mac_menu`: Über · — · Einstellungen … ⌘, · — ….
        let app = ids(&group("app.name"));
        assert_eq!(app[..4], ["About", "|", "settings.open", "|"]);

        let file = ids(&group("menu.file.title"));
        assert_eq!(file[..3], ["file.newNote", "vault.open", "|"]);
        assert_eq!(file[file.len() - 2..], ["|", "tab.close"]);

        let edit = ids(&group("menu.edit.title"));
        assert_eq!(
            edit[..10],
            [
                "Undo",
                "Redo",
                "|",
                "Cut",
                "Copy",
                "Paste",
                "SelectAll",
                "|",
                "find.open",
                "tree.moveTo"
            ]
        );
        assert_eq!(edit[edit.len() - 2..], ["|", "tree.trash"]);

        let view = ids(&group("menu.view.title"));
        assert_eq!(view[..3], ["sidebar.toggle", "menu.view.sidebarWidth", "|"]);
        let mode = view
            .iter()
            .position(|id| id == "menu.view.appearance")
            .expect("Hell oder Dunkel");
        assert_eq!(
            view[mode - 1..mode + 3],
            [
                "|",
                "menu.view.appearance",
                "menu.view.tone",
                "settings.reduceMotion"
            ]
        );
        assert_eq!(
            view[view.len() - 5..],
            [
                "|",
                "view.fontLarger",
                "view.fontSmaller",
                "|",
                "palette.open"
            ]
        );

        // „Reiter nach vorn / hinten“ are sebaro's, before the line (spec/02
        // §4.21, §4.24, D102 (5)).
        let window = ids(&group("menu.window.title"));
        assert_eq!(
            window[..7],
            [
                "Minimize",
                "Zoom",
                "area.next",
                "area.previous",
                "tab.moveEarlier",
                "tab.moveLater",
                "|"
            ]
        );
    }

    /// Every command item of the bar, with its id.
    fn every_item() -> Vec<&'static str> {
        let mut all = Vec::new();
        for group in bar() {
            every_entry(&group.entries, &mut all);
        }
        all.into_iter()
            .filter_map(|entry| match entry {
                Entry::Item(id, _, _) => Some(id),
                _ => None,
            })
            .collect()
    }

    // D102 (9), spec/02 §4.24: an item whose command has no target is
    // switched off. Without any target only the commands that always act
    // stay on; with every target, all of them are on.
    #[test]
    fn items_without_a_target_are_switched_off() {
        let none = MenuTargetsDto::default();
        let on: Vec<&str> = every_item()
            .into_iter()
            .filter(|id| has_target(&none, id))
            .collect();
        assert_eq!(
            on,
            [
                "settings.open",
                "app.quit",
                "vault.open",
                "view.fontReset",
                "view.fontLarger",
                "view.fontSmaller",
                "palette.open",
                "area.next",
                "area.previous",
                "window.close"
            ]
        );
        let all = MenuTargetsDto {
            vault: true,
            close: true,
            save: true,
            editor: true,
            path: true,
            vault_path: true,
            movable: true,
            back: true,
            forward: true,
            reopen: true,
            cycle: true,
            earlier: true,
            later: true,
            sidebar_overlay: true,
            sidebar_overlay_open: true,
            preview: true,
            previewing: true,
        };
        for id in every_item() {
            assert!(has_target(&all, id), "{id} is off with every target");
        }
    }

    // ADR-0051 #43: View ▸ Preview ⌘E is a check item in the app's own block
    // after Board; its check is the current tab's preview, and a tab without
    // one switches it off. The other checks always act.
    #[test]
    fn the_preview_item_follows_the_current_tab() {
        let preview = |targets: MenuTargetsDto| {
            let flags = MenuFlags {
                targets,
                ..MenuFlags::default()
            };
            let view = layout(&Settings::default(), flags)
                .into_iter()
                .find(|group| group.title == "menu.view.title")
                .expect("Darstellung")
                .entries;
            let at = ids(&view)
                .iter()
                .position(|id| id == "note.togglePreview")
                .expect("View ▸ Preview");
            assert_eq!(ids(&view)[at - 1], "board.toggle");
            view[at].clone()
        };
        let none = MenuTargetsDto::default();
        assert_eq!(
            preview(none),
            Entry::Check(
                "note.togglePreview",
                "menu.view.preview",
                false,
                "CmdOrCtrl+KeyE"
            )
        );
        assert!(!has_target(&none, "note.togglePreview"));
        let shown = MenuTargetsDto {
            preview: true,
            previewing: true,
            ..none
        };
        assert!(matches!(preview(shown), Entry::Check(_, _, true, _)));
        assert!(has_target(&shown, "note.togglePreview"));
        for id in ["sidebar.toggle", "board.toggle", "backlinks.toggle"] {
            assert!(has_target(&none, id), "{id}");
        }
    }

    // spec/02 §4.17, §4.18: the check is what shows. Over the content of a
    // narrow window that is the overlay, whatever `state.json` keeps.
    #[test]
    fn the_sidebar_check_follows_the_overlay_in_a_narrow_window() {
        let docked = MenuTargetsDto::default();
        assert!(sidebar_checked(true, &docked));
        assert!(!sidebar_checked(false, &docked));
        let closed = MenuTargetsDto {
            sidebar_overlay: true,
            ..MenuTargetsDto::default()
        };
        assert!(!sidebar_checked(true, &closed));
        let open = MenuTargetsDto {
            sidebar_overlay_open: true,
            ..closed
        };
        assert!(sidebar_checked(false, &open));
    }

    // D75: one item checked in „Hell oder Dunkel“, whichever is chosen.
    #[test]
    fn light_or_dark_has_one_check() {
        for appearance in [Appearance::System, Appearance::Light, Appearance::Dark] {
            let settings = Settings {
                appearance,
                ..Settings::default()
            };
            let view = layout(&settings, MenuFlags::default())
                .into_iter()
                .find(|group| group.title == "menu.view.title")
                .expect("Darstellung")
                .entries;
            let checked: Vec<&str> = submenu(&view, "menu.view.appearance")
                .iter()
                .filter_map(|entry| match entry {
                    Entry::Check(id, _, true, _) => Some(*id),
                    _ => None,
                })
                .collect();
            assert_eq!(checked.len(), 1, "{appearance:?}: {checked:?}");
        }
    }

    // muda's own texts are English in every language („Toggle Full
    // Screen“): every predefined item is there once, with a catalog key.
    #[test]
    fn every_predefined_item_has_its_text_from_the_catalog() {
        let mut all = Vec::new();
        for group in bar() {
            every_entry(&group.entries, &mut all);
        }
        let kinds: Vec<Predefined> = all
            .iter()
            .filter_map(|entry| match entry {
                Entry::Predefined(kind, key) => {
                    assert!(key.starts_with("menu."), "{kind:?} has no catalog key");
                    Some(*kind)
                }
                _ => None,
            })
            .collect();
        assert_eq!(kinds.len(), 14, "{kinds:?}");
        for kind in &kinds {
            assert_eq!(
                kinds.iter().filter(|k| *k == kind).count(),
                1,
                "{kind:?} twice"
            );
        }
    }

    /// `keymap.ts`' table: command id -> its chords.
    fn keymap() -> BTreeMap<String, Vec<String>> {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../ui/src/lib/keymap.ts");
        let text = std::fs::read_to_string(&path).expect("keymap.ts must be readable");
        let start = text.find("export const KEYMAP").expect("the KEYMAP array");
        let end = text[start..].find("];").expect("its end") + start;
        let mut out: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for entry in text[start..end].split("{ chord:").skip(1) {
            let strings: Vec<&str> = entry.split('"').skip(1).step_by(2).collect();
            out.entry(strings[1].to_string())
                .or_default()
                .push(strings[0].to_string());
        }
        out
    }

    /// A Tauri accelerator in docs/KEYMAP.md notation.
    fn chord_of(accelerator: &str) -> String {
        accelerator
            .split('+')
            .map(|part| match part {
                "CmdOrCtrl" => "Cmd".to_string(),
                "ArrowUp" => "Up".to_string(),
                "ArrowDown" => "Down".to_string(),
                "BracketLeft" => "[".to_string(),
                "BracketRight" => "]".to_string(),
                "Slash" => "/".to_string(),
                "Comma" => ",".to_string(),
                key if key.starts_with("Key") => key[3..].to_string(),
                key if key.starts_with("Digit") => key[5..].to_string(),
                key => key.to_string(),
            })
            .collect::<Vec<_>>()
            .join("+")
    }

    // The menu shows the keymap's chord for its command (the shortcut
    // check's S9): a menu chord the keymap lacks would act only from the
    // menu. Five have none on purpose: the page handles ⌘+ / ⌘− (a key of
    // its own on the German layout), ⌘⌫ (the editor's delete to the line
    // start) and ⌘← / ⌘→ with ⌃⌘← / ⌃⌘→ (the text field's line start and
    // end, ADR-0051 #36), spec/09 §13.1.
    #[test]
    fn the_menu_chords_are_the_keymaps() {
        const PAGE_CHORDS: &[&str] = &[
            "view.fontLarger",
            "view.fontSmaller",
            "tree.trash",
            "nav.back",
            "nav.forward",
        ];
        let keymap = keymap();
        let mut all = Vec::new();
        for group in bar() {
            every_entry(&group.entries, &mut all);
        }
        for entry in all {
            let (id, accelerator) = match entry {
                Entry::Item(id, _, accelerator) | Entry::Check(id, _, _, accelerator) => {
                    (id, accelerator)
                }
                _ => continue,
            };
            let chords = keymap.get(id).cloned().unwrap_or_default();
            if accelerator.is_empty() {
                assert!(
                    chords.is_empty() || PAGE_CHORDS.contains(&id),
                    "{id} has {chords:?} in the keymap but no chord in the menu"
                );
            } else {
                assert_eq!(chords.first(), Some(&chord_of(accelerator)), "{id}");
            }
        }
    }

    // The three widths are written twice, here for the menu and in the UI's
    // store for the divider (sebaro D100); they must not drift apart.
    #[test]
    fn the_sidebar_widths_are_the_uis() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../ui/src/stores/ui.ts");
        let ui = std::fs::read_to_string(&path).expect("stores/ui.ts must be readable");
        let [(_, _, min), (_, _, start), (_, _, max)] = SIDEBAR_WIDTHS;
        let line = format!("SIDEBAR_WIDTH = {{ min: {min}, start: {start}, max: {max} }}");
        assert!(ui.contains(&line), "stores/ui.ts has no `{line}`");
        assert_eq!(UiStateDto::default().sidebar_width, start);
    }

    #[test]
    fn only_the_three_widths_check_a_step() {
        assert_eq!(sidebar_width_step(200), Some(200));
        assert_eq!(sidebar_width_step(240), Some(240));
        assert_eq!(sidebar_width_step(360), Some(360));
        assert_eq!(sidebar_width_step(264), None);
        assert_eq!(sidebar_width_step(256), None);
    }

    #[test]
    fn the_choices_are_checked_again_on_click() {
        for (id, _, _) in SIDEBAR_WIDTHS {
            assert!(is_choice(id), "{id}");
        }
        // Every check of a submenu is a choice, but the spelling's.
        for group in bar() {
            for entry in &group.entries {
                let Entry::Submenu(key, inner) = entry else {
                    continue;
                };
                for check in inner {
                    if let Entry::Check(id, _, _, _) = check {
                        assert_eq!(is_choice(id), *key != "menu.edit.spelling", "{id}");
                    }
                }
            }
        }
        assert!(!is_choice("settings.reduceMotion"));
        assert!(!is_choice("board.toggle"));
        assert!(is_choice("settings.appearance.dark"));
        assert!(is_choice("settings.tone.warm"));
        assert!(is_choice("settings.language.de"));
        assert!(!is_choice("settings.spellcheck"));
        assert!(!is_choice("sidebar.toggle"));
    }

    // AKT-10, ADR-0051 #19: the destructive item last, after a separator,
    // for a note and a folder alike; a board row shows only Show in Finder.
    #[test]
    fn tree_context_ends_with_move_to_trash_after_a_separator() {
        let ids = |board, folder| -> Vec<Option<&str>> {
            tree_context_entries(board, folder)
                .into_iter()
                .map(|entry| entry.map(|(id, _)| id))
                .collect()
        };
        assert_eq!(
            ids(false, false),
            [
                Some("tree.reveal"),
                Some("tree.openDefault"),
                Some("tree.rename"),
                Some("tree.moveTo"),
                None,
                Some("file.newNote"),
                Some("tree.newFolder"),
                None,
                Some("tree.trash"),
            ]
        );
        let folder = ids(false, true);
        assert!(!folder.contains(&Some("tree.moveTo")));
        assert_eq!(folder[folder.len() - 2..], [None, Some("tree.trash")]);
        assert_eq!(ids(true, false), [Some("tree.reveal")]);
        for (_, key) in tree_context_entries(false, false).into_iter().flatten() {
            assert!(MENU_KEYS.contains(&key), "{key} is not in MENU_KEYS");
        }
    }
}
