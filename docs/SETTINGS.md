# Settings

The complete list of persisted settings. ADR-0004 is the allow-list, ADR-0049
added `reduceMotion`, ADR-0051 added `tone`; nothing ships beyond this table
without a new ADR carrying a quoted owner yes.

- File: `~/Library/Application Support/io.github.grundhofer.novalis/settings.json` (ADR-0003).
- Written by an atomic read-modify-write; the Rust `Settings` struct uses
  `serde(deny_unknown_fields)`.
- **Parity test:** the settings-parity test parses the table between the two
  HTML comment markers below and compares it with the `Settings` struct: same
  set of keys (dotted path for nested fields), same type, same default. A key in
  the struct that is missing here fails CI, and so does a row without a field.
- Not in this file, by design: window size and position, open tabs, sidebar
  width and every other transient value. Those live in `<app-data>/state.json`,
  free-form, disposable, and are never documented here.
- Where they are shown: the settings view in the main window (ADR-0051 #1,
  sebaro DSK-02) holds exactly the settings of this table, each with one help
  sentence, and applies a change at once. `Cmd+,`, App menu ▸ Settings …,
  the palette's „Einstellungen …“ and the sidebar's place „Einstellungen“
  open it in the content area; `Escape`, `Cmd+W` and „Zurück zu <Ort>“ leave
  it. It is never a second window. Each setting has exactly one persisted
  place (`settings.json`); the menu item in the "Changed via" column, the
  palette's rows (ADR-0012) and the view are launchers for the same command
  ids, not more places. The view offers every `editor.fontSize` the shell
  keeps, 9–32 px.

<!-- settings-table:start -->
| Key | Kind | Type | Values | Default | Changed via | ADR |
|---|---|---|---|---|---|---|
| `version` | schema | integer | `1` | `1` | code only (schema stamp, bumped with a migration) | 0004 |
| `language` | setting | string | `system` · `de` · `en` | `system` | View ▸ Language (fallback; macOS per-app language is primary) | 0004 |
| `appearance` | setting | string | `system` · `light` · `dark` | `system` | View ▸ Light or Dark (ADR-0051) | 0004 |
| `tone` | setting | string | `cool` · `warm` | `cool` | View ▸ Tone | 0051 |
| `editor.fontSize` | setting | integer | CSS px, 9–32 | `16` | `Cmd+Plus` / `Cmd+Minus` / `Cmd+0` (ADR-0051) | 0004 |
| `spellcheck` | setting | boolean | `true` · `false` | `true` | Edit ▸ Spelling ▸ Check Spelling While Typing | 0004 |
| `reduceMotion` | setting | boolean | `true` · `false` | `false` | View ▸ Always Reduce Motion | 0049 |
| `lastVault` | state | string or null | absolute path | `null` | File ▸ Open Vault … (`Cmd+O`) | 0004 |
<!-- settings-table:end -->

## Example

```json
{
  "version": 1,
  "language": "system",
  "appearance": "system",
  "tone": "cool",
  "editor": { "fontSize": 16 },
  "spellcheck": true,
  "reduceMotion": false,
  "lastVault": "/Users/…/OneDrive-Persönlich/Notizen"
}
```

## Notes

- `editor.fontSize` is the one nested key; the dotted path in the table is the
  struct path `editor.font_size` in Rust and `editor.fontSize` on disk.
- `language: system` follows the macOS per-app language (System Settings ▸
  Language & Region). Whether that mechanism works inside a Tauri bundle is
  ASSUMED until Spike C; the View ▸ Language menu is the fallback either way.
- `lastVault` is state that happens to live in this file so the app has one
  file to read at boot. It is not a setting: there is no menu for it and no
  recent-vaults list (PLAN.md §4.4).
- Hard-coded defaults that would otherwise be settings are listed in PLAN.md
  §4.2 and are not persisted anywhere.
- `tone` is sebaro's „Farbton: Kühl · Warm“ (FAR-15). `warm` stamps
  `data-sb-tone="warm"` on the root element; `cool` removes it. Unlike
  sebaro's web key `sb-tone`, which keeps only „warm“, the file always names
  the value, like `appearance`; a file without the key loads as `cool`. It
  changes the window ground before the page paints (DSK-14) and, through
  the export's `--sb-*` grey roles, every view.
- `spellcheck` applies to prose — Markdown, plain text and the prose formats
  (ADR-0022); a code or data file is never checked, whatever the setting says.
- The tree's file order (`treeSort`: by name, or by modified time newest
  first, chosen in the sidebar legend, ADR-0012) is state in `state.json` next
  to the sidebar width, not a setting: losing it costs one click.
