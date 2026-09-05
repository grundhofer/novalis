# Settings

The complete list of persisted settings. ADR-0004 is the allow-list; nothing
ships beyond this table without a new ADR carrying a quoted owner yes.

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
- No preferences window. Each setting has exactly one place where it changes
  (the "Changed via" column).

<!-- settings-table:start -->
| Key | Kind | Type | Values | Default | Changed via | ADR |
|---|---|---|---|---|---|---|
| `version` | schema | integer | `1` | `1` | code only (schema stamp, bumped with a migration) | 0004 |
| `language` | setting | string | `system` · `de` · `en` | `system` | View ▸ Language (fallback; macOS per-app language is primary) | 0004 |
| `appearance` | setting | string | `system` · `light` · `dark` | `system` | View ▸ Appearance | 0004 |
| `editor.fontSize` | setting | integer | CSS px | `16` | `Cmd+=` / `Cmd+-` / `Cmd+0` | 0004 |
| `spellcheck` | setting | boolean | `true` · `false` | `true` | Edit ▸ Spelling ▸ Check Spelling While Typing | 0004 |
| `lastVault` | state | string or null | absolute path | `null` | Open Vault… (`Cmd+O`) | 0004 |
<!-- settings-table:end -->

## Example

```json
{
  "version": 1,
  "language": "system",
  "appearance": "system",
  "editor": { "fontSize": 16 },
  "spellcheck": true,
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
