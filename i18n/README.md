# i18n

`en.json` is the canonical catalog; `de.json` mirrors it key for key. Every
user-visible string of the desktop app lives in these two files: UI text,
native menu labels, banner texts, board notices, palette entries, error
messages. Nothing is inline in components, and nothing is inline in Rust. The
core crate and the CLI carry no strings at all (typed errors; the CLI is
English-only, PLAN.md D9).

## Format

- One flat JSON object per locale. Keys are `namespace.key`; the `key` part may
  contain further dots for grouping (`menu.view.appearance`), but the object is
  never nested. i18next runs with `keySeparator: false` and `nsSeparator: false`;
  the namespace prefix is a naming convention that the parity check enforces.
- Keys sorted alphabetically, 2-space indent, UTF-8 verbatim (no `\uXXXX`),
  trailing newline. `i18next-cli extract` writes the same shape.
- Placeholders are `{{var}}`; escaping is off, values render raw. Both locales
  must use the same set of placeholders per key.
- Plurals: `key_one` and `key_other`, always both, always with `{{count}}`
  passed as `count`. German and English have exactly these two CLDR categories.
  Never build a plural by string concatenation.
- No empty values. A key added to `en.json` is added to `de.json` in the same
  commit.

## Namespaces

| Prefix | Covers |
|---|---|
| `app` | Shared verbs (OK, Cancel, Close), the Open Vault screen, the Install Command-Line Tool dialog |
| `menu` | Native menu bar: `menu.app.*`, `menu.file.*`, `menu.edit.*`, `menu.view.*`, `menu.go.*`, `menu.window.title`. Predefined items (Quit, Hide, Services, Minimize, Zoom, Enter Full Screen) get their system names and have no key |
| `tree` | Sidebar tree: badges (board, online only, conflict copy), context menu, footer counts, relative-day words |
| `editor` | Editor chrome: find/replace bar, goto line, link dialog, completion, backlinks panel, vault search panel, banners that are editor-local states |
| `board` | Kanban pane: columns, cards, switcher, the §8.4 conflict notices |
| `banner` | The external-change banners of PLAN.md §5.3 (both sync cases), read-only/plain-mode/huge-file banners, the legacy-vault prompt of §10 |
| `status` | Status bar: counts, position, cloud hints, conflict-copy list actions, download progress |
| `palette` | Command palette and quick-open: placeholders, footer `kbd` hints, section headers, command labels that have no menu item |
| `settings` | Value labels of the four settings (language names, appearance names, spellcheck, font size) — used by the View/Edit menus and by the palette |
| `errors` | One message per `CoreError` kind plus the few UI-only failures; see the mapping below |

Menu items reuse `menu.*` keys in context menus and in the palette when the
label is identical; `palette.cmd.*` exists only for commands without a menu
item.

## Rules for the text

- German uses the du-form and typographic quotes „…“; English uses straight
  quotes escaped as `\"`.
- macOS menu vocabulary in German: Ablage, Sichern, Widerrufen, Einsetzen,
  Darstellung, Fenster; in English: File, Save, Undo, Paste, View, Window.
- An item that opens a dialog, a palette or a picker ends with an ellipsis
  `…` (U+2026), in both languages.
- Keyboard chords are never part of a string. Menus and the palette footer
  render the chord from `docs/KEYMAP.md`; the catalogs carry only the labels.
  The parity check rejects `Cmd+`, `Ctrl+`, `Shift+`, `Alt+` inside a value.
- Do not translate: file paths, vault-relative paths, brand names (OneDrive,
  Google Drive — pass them as `{{provider}}`), format names (UTF-8, JSON),
  commands in backticks, ids, and the product name `novalis` (lower-case).
- Dates, times and relative times are not strings here; the UI formats them with
  `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat` for the active language.
  Only the two words `tree.today` / `tree.yesterday` are catalog strings.
- Texts that PLAN.md quotes verbatim (the §5.3 banners, the §8.4 board notice,
  the §5.6 search hint, the §10 legacy prompt) keep that wording in German; the
  English is the translation.

## How the shell and the UI read the files

- UI: i18next 26 + react-i18next; `en.json` provides the type-safe key union;
  the inactive locale is loaded lazily. `language: system` follows the macOS
  per-app language; View ▸ Language is the fallback (`docs/SETTINGS.md`).
- Rust shell: `serde_json` reads the same file for native menu labels
  (`menu.*`, `settings.*` value labels) and for error → message mapping
  (`errors.*`). No second catalog exists.

## `CoreError` kind → catalog key → CLI exit code

The core crate owns the enum; this table is the contract the shell and the
CLI map through. If the enum names a kind differently, the key follows the enum
and this table is updated in the same PR.

| Kind | Key | Exit code (PLAN.md §9.2) |
|---|---|---|
| `NotFound` | `errors.notFound` | 3 |
| `AlreadyExists` | `errors.alreadyExists` | 4 |
| `Ambiguous` (stem or heading matches several) | `errors.ambiguous` | 4 |
| `Precondition` (read-time precondition or `--if-match` mismatch) | `errors.precondition` | 4 |
| `CaseCollision` (differs only by case or normalization) | `errors.caseCollision` | 4 |
| `InvalidPath` (outside the vault, hidden, `..`, wrong extension) | `errors.invalidPath` | 2 |
| `InvalidName` (unusable file name) | `errors.invalidName` | 2 |
| `BadRequest` | `errors.badRequest` | 2 |
| `NeedsForce` (dangling backlinks, cloud-only skips) | `errors.cloudOnlySkipped_*` for the cloud case; the UI never reaches the backlinks case | 5 |
| `CacheBusy` | `errors.cacheBusy` | 6 (mutations) / stderr warning `stale_index` (reads) |
| `NoVault` | `errors.noVault` | 7 |
| `CloudOnly` | `errors.cloudOnly` | 8 |
| `MaterializeTimeout` | `errors.materializeTimeout` | 8 |
| `NotUtf8` | `errors.notUtf8` (as a banner: `banner.notUtf8`) | 1 |
| `Parse` (JSON, YAML frontmatter, board or card file) | `errors.parse`, `errors.boardInvalid`, `errors.cardInvalid` | 1 |
| `Io` | `errors.io` | 1 |
| `Database` | `errors.database` | 1 |
| `Internal` | `errors.internal` | 1 |

## Checks

CI (`just check`) runs `eslint-plugin-i18next/no-literal-string` (jsx text,
`placeholder`, `title`, `aria-label`, `alt`) and
`apps/desktop/ui/scripts/i18n-check.mjs` as the `i18n:check` script: catalog
shape (flat `namespace.key` string maps, no empty values), parity (identical key
sets, identical `{{vars}}` per key, complete `_one`/`_other` pairs) and drift
(every key `t("…")` in the UI or `cat.t("…")` in the Rust shell asks for
exists). Keys no caller uses yet are listed, not failed.

That script replaces the plan's `i18next-cli extract --ci` + `status`: the two
checks it performs are the same, and a dependency-free 200-line script needs no
ADR while a new npm tool would (CLAUDE.md, minimalism rule). The trade is that
extraction is not automated — a new `t("…")` key must be added to both catalogs
by hand, which the drift check then enforces.

The dev-only pseudo-locale `en-XA` (accented, ⟦bracketed⟧) that spots strings
which escaped `t()` is approved (docs/DECISIONS.md, §4.4) but **not implemented
yet**: no `en-XA` generator and no language entry exist. Until it lands,
`no-literal-string` and the drift check above are the only guards. It ships no
file either way.

Ad-hoc, without Node:

```sh
python3 - <<'PY'
import json,re
en=json.load(open("i18n/en.json"));de=json.load(open("i18n/de.json"))
v=lambda s:sorted(re.findall(r"\{\{[^}]*\}\}",s))
assert set(en)==set(de),(set(en)^set(de))
assert all(v(en[k])==v(de[k]) for k in en)
assert all(x.strip() for c in(en,de) for x in c.values())
print("ok",len(en))
PY
```

## Adding a string

1. Add the key to `en.json` and `de.json` (both, same commit, sorted position).
2. Use it via `t("namespace.key")` or, in Rust, through the menu/error tables.
3. If the string belongs to a new setting, feature, menu item or shortcut, the
   PR needs the ADR number and the quoted owner yes (PLAN.md §11.5).
