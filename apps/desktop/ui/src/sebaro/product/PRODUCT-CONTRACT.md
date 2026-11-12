# Product declaration contract (sebaroDesign)

Status: v1.2, 2026-11-12 (stage 6c of the export rework, D147, D148, after the first website and desktop app moved:
`check` compares the declaration by what it says, the small tile for web and desktop, `NOTICE.md` with the terms of
the folder, `share` finds Playwright as the raster files do; previous v1.1, 2026-11-12, stage 6a: every profile copy
brings the kit in `product/`, the kit writes the start of an Android app and one SVG per raster file, a renderer draws
the raster files; v1.0, 2026-11-11, stage 2: built in the workshop, not shipped in a copy). Machine-readable twin:
[`product.schema.json`](product.schema.json). Tools: `product_kit.py` 1.2.0 with `sign_geometry.py` (Python 3.10+,
standard library) and `render.mjs` 1.2.0 (Node 20+, the product's own Playwright, or one a product without a
Node project names: section 6). In sebaroDesign they are
`tools/product_kit.py`, `tools/sign_geometry.py` and `tools/product_render.mjs`, and this text is
`shared/PRODUCT-CONTRACT.md`; a profile copy carries all of them in `product/` (section 1).

A product declares itself in one file of its own repository, `sebaro.product.json`. The kit draws the product's sign
tile, launcher layers, notification icon, the start of an Android app, favicon SVG, web manifest and head snippet
from that file and from one data file of the system, and the renderer draws the raster files. The system then no
longer needs to know the product. Until the product list leaves the system (stage 8), `tools/brand_assets.py` draws
the same outputs from `brand/signs.json` and `brand.config.json` through the kit's functions, and
`tools/tests/test_product_kit.py` `Golden` compares the two for every product.

## 1 Commands

```sh
python3 <copy>/product/product_kit.py build sebaro.product.json --copy <copy> --out <folder> [--render]
python3 <copy>/product/product_kit.py check sebaro.product.json --copy <copy> --out <folder> [--no-raster]
node <copy>/product/render.mjs <folder>                    # the raster files alone (what --render runs)
node <copy>/product/render.mjs share <folder> --pages … --out …   # share images of a profile copy (section 6)
```

A product needs these four and nothing of the workshop. The kit's third command, `tiles`, is the maintainers'
(section 9).

- `<copy>` is the folder of the system's copy; the kit reads `product/tiles.json` there (section 4) and writes nothing
  into it, no `__pycache__` either. `<folder>` belongs to the product and lies outside the copy; the kit refuses a
  folder inside the copy or around it.
- `build` writes the text outputs and the record, replaces the files it wrote before and removes those that are no
  longer outputs (by the record). `--render` then runs the renderer beside the kit, which draws the PNG and ICO
  files (section 6); its exit code is the command's. Without `--render` the build names the raster files that wait.
- `check` writes nothing and needs Python alone: exit 1 when an output is missing, edited or stale, raster files
  included (section 7). `--no-raster` leaves the raster files out and says so in a note: for a product that keeps
  none of them. It compares the declaration by what it says (kit 1.2.0): a formatter may change its white space and
  the order of its keys.
- Exit codes of the kit: **0** ok · **1** `check` found a missing, edited or stale output, or a file could not be
  written · **2** usage or input (an invalid declaration, no `product/tiles.json`, `--render` without the renderer
  or without Node). Of the renderer: **0** ok · **1** a file could not be drawn or the browser could not run ·
  **2** usage or input (no record, an SVG that is not the one the build wrote, no Playwright in the product).
- **In a copy** (every profile copy of `tools/export_system.py` 1.27.0 on, core of each profile): `product/product_kit.py`,
  `product/sign_geometry.py`, `product/render.mjs`, `product/tiles.json`, `product/product.schema.json` and this
  text as `product/PRODUCT-CONTRACT.md`. The first three, the schema and the text are the workshop's files byte for
  byte; `tiles.json` is generated at the export. They are listed in the copy's `sebaro-export.json` like every other
  file, so the copy's `checks/verify-export.mjs --strict` and the workshop's `--verify` cover them. A `--target`
  export has no `product/`.
- **In a product's CI, without the workshop**, three commands at most: `check` above, `node
  <copy>/checks/verify-export.mjs <copy> --strict` (the copy is unchanged) and the copy's lint script.

## 2 `sebaro.product.json` (unknown keys are an error)

```json
{
  "schemaVersion": "1.0",
  "id": "beispiel",
  "name": "Beispiel",
  "shortName": "Beispiel",
  "tile": "tools",
  "sign": {
    "glyph": [
      {"d": "M4 12 H20", "paint": "stroke"},
      {"d": "M12 4 V20", "paint": "stroke"}
    ]
  },
  "web": {
    "manifest": {"lang": "de", "dir": "ltr", "id": "/", "start_url": "/", "scope": "/", "display": "browser"}
  },
  "outputs": ["android", "web"]
}
```

| Key | Rule |
|---|---|
| `schemaVersion` | `"1.0"` |
| `id` | kebab-case. The value of `data-sb-product`, part of the Android resource names (`sb_sign_<id>`, other characters become `_`) and the id in `SebaroProductInfo.kt` |
| `name` | the product's name as it writes it: the title of the sign and tile SVGs and the manifest's `name` |
| `shortName` | optional, default `name`: the manifest's `short_name`. Launchers cut labels longer than about 12 characters |
| `tile` | one of the eight tile groups: `studio`, `collaboration`, `everyday`, `learning`, `tools`, `media`, `money`, `system` (palette `signTiles.groups`, D50, D51). The group gives the tile's ground and the sign's colour, the same in light and dark |
| `sign.glyph` | the sign: a non-empty list of paths on the 24-unit grid, the format of `products[].glyph` in a `signs.json` (SIGNS-GUIDE section 2): `d` (SVG path data, arcs allowed), `paint` `"stroke"` or `"fill"`; strokes may set `width`, `cap`, `join`, fills `fillRule`. A stroke without `width` has the system's base stroke |
| `sign.glyphSmall` | optional simpler drawing for 24 px and below (favicon, notification icon, the small tile). Drawn at the base stroke like `glyph`: the kit applies the heavier stroke of the small sizes |
| `web` | optional, only with `"web"` in `outputs`: `name` (the manifest's `name` where it differs from `name`), `themeColor` and `backgroundColor` (`#rrggbb`; default the system's light ground), `headThemeColor` (default `true`: the head snippet carries the two `theme-color` tags) and `manifest` |
| `web.manifest` | Web App Manifest members written as they are (`lang`, `dir`, `id`, `start_url`, `scope`, `display`, `description`, …). Not `name`, `short_name`, `theme_color`, `background_color` or `icons`. Nothing is added: a site that is not installable says `"display": "browser"` itself |
| `outputs` | one or more of `android`, `web`, `desktop`, each once (section 5) |
| `$schema`, `$comment` | optional strings |

**Why the sign is a glyph list and not an SVG file.** The geometry code draws exactly this list
(`sign_geometry.glyph_from_json`), so nothing is lost on the way in. An SVG would pass through `signs.py glyph`, which
drops what a sign cannot have without saying so (colours, `<defs>`, a miter limit), rounds shape coordinates to three
decimals and refuses a `transform`. A stroke without `width` also could not say "the system's base stroke", which the
stroke masters of the small sizes scale. `.venv/bin/python tools/signs.py glyph sign.svg` turns a drawn SVG
(`viewBox="0 0 24 24"`) into the list; that command is a tool of the maintainers and in no copy: a product writes
the list by hand, or asks for it.

## 3 Rules the schema cannot say (the kit checks them)

- `tile` is a group of the copy's `product/tiles.json`. The schema lists sebaro's eight.
- A stroke's `width` is greater than 0. `width`, `cap` and `join` belong to strokes, `fillRule` to fills.
- Every `d` parses and draws something.
- The ink of `glyph` and of `glyphSmall`, stroke included, stays inside the 24-unit box at the base stroke (tolerance
  0.01).
- `web` needs `"web"` in `outputs`.
- `"android"` needs `kotlin.package` in `product/tiles.json`.

The kit reports every problem of a declaration at once. It does **not** compare the sign with other products' signs
(the 16-px distance of D33) and does not screen it against `shared/sign-references.json`: both need the registry and
Pillow and stay with `tools/signs.py check` in the workshop.

## 4 `product/tiles.json` (generated, shipped with a copy)

What the kit needs of a system, written by `product_kit.py tiles` (`tiles_doc`). It names no product.

| Key | From |
|---|---|
| `format` | `"1.1"` |
| `system` | `meta.slug` of `dist/tokens.json` |
| `groups.<id>` | `signTiles.<id>` of `dist/tokens.json`: `tile`, `glyph`, `css` (the custom property of the ground; the sign's is `<css>-glyph`), `kotlin`. Not the group's product list |
| `foot` | `band` and `line`: the `signFoot` tokens that `signs.foot` of `brand.config.json` names |
| `grounds` | `color.bg` light and dark (the splash ground, `theme_color`) |
| `tones` | per tone variant whose ground differs (`variants.<tone>.<mode>.bg`): `light`, `dark` |
| `tile.radius` | `signs.tile.radius` of `brand.config.json` |
| `sign` | `grammar.stroke` and `grammar.strokeBySize` of `brand/signs.json` |
| `notification.paddingDp` | `signs.notification.paddingDp` |
| `raster` | the measures of the raster files (section 6), from `brand.config.json` with the defaults of `tools/brand_assets.py`: `viewports` (`any`, `play`, `appleTouch`, `maskable`, `desktop`: the dp of the 108-dp launcher canvas each file shows; `desktop` is the config's `tauri`), `desktopBodyPx` (`tauriBodyPx`) and `squircleExponent` (`masks.squircleExponent`) |
| `kotlin.package` | the package of `dist/SebaroTheme.kt` |

`format` is `"1.1"` since kit 1.1.0 (`raster` is new); the kit reads the format it was shipped with.

The kit draws one form only: the tile with the fixed foot of D143/D144, tile colours by group, the tile favicon.
`tiles` refuses a system whose brand config says otherwise (`signs.tile.source` not `signTiles`, no `signs.foot`, a
`signs.code`, a glyph favicon). The radius, the padding and the stroke are read as written, without defaults.

## 5 Outputs

All paths are relative to `--out`. Every file below is text and is produced without a browser.

| Output | With | What |
|---|---|---|
| `android/res/drawable/ic_launcher_background.xml`, `…_foreground.xml`, `…_monochrome.xml` | `android` | the adaptive launcher layers on the 108-dp canvas: the tile's ground with line and band, full bleed; the sign; sign and band in one colour |
| `android/res/mipmap-anydpi-v26/ic_launcher.xml`, `ic_launcher_round.xml` | `android` | the adaptive icon of the three layers |
| `android/res/drawable/ic_stat_notify.xml` | `android` | the notification small icon: the sign alone, 24-px stroke master, white |
| `android/res/drawable/sb_sign_<id>.xml`, `sb_sign_<id>_small.xml` | `android` | the complete tile in its fixed colours, 72 dp, base form and the form below 32 px (`SbSignTile`) |
| `android/res/values/sebaro_splash.xml`, `values-night/sebaro_splash.xml` | `android` | `@color/sebaro_splash_background`: the system's ground per scheme |
| `android/res/drawable/sb_symbol_<id>.xml` | `android` | the start symbol: the bare sign in the sign colour of its tile group, 96 dp, no tile and no foot. `SbStartSymbol` reads it by this name from the app's resources |
| `android/res/drawable/sb_splash_symbol_<id>.xml` | `android` | the same sign in the middle third of a 288-dp field, for the platform splash of API 31 and later |
| `android/res/values/sebaro_start.xml` | `android` | `@color/sebaro_start_background`: the tile colour of the product's group |
| `android/res/values-v31/sebaro_start.xml`, `android/res/values/sebaro_start_theme.xml` | `android` | `Theme.Sebaro.Start` on the copy's `Theme.Sebaro`: with the platform splash (ground and splash symbol) from API 31, the ground alone before |
| `android/kotlin/SebaroProductInfo.kt` | `android` | `val AppProduct = SebaroProduct("<id>", SebaroSignTile.<Group>)` in `<package>.product` |
| `web/icon.svg` | `web` | the favicon: the small tile, drawn for 16 px |
| `web/manifest.webmanifest`, `web/manifest.snippet.json` | `web` | the manifest (names, `web.manifest`, colours, icons) and its short form for merging |
| `web/head.snippet.html` | `web` | four link tags and, unless `headThemeColor` is false, the two `theme-color` tags with `data-sb-tone-<tone>` |
| `web/theme-color.json` | `web` | the grounds and tone grounds the tags are made from; `headTags` says whether the snippet carries them |
| `sign/sign.svg`, `sign/sign-small.svg` | `web` or `desktop` | the sign alone in `currentColor`: base master, and the 16-px master for 16 to 24 px |
| `sign/tile.svg` | `web` or `desktop` | the tile, 72 × 72, fixed colours: its base form, **for 32 px and above** |
| `sign/tile-small.svg` | `web` or `desktop` | the tile's small form, **for below 32 px** (kit 1.2.0): the small sign (`glyphSmall` where the declaration has one) with the 16-px stroke master and the heavier foot, in the same 72 × 72 frame. The drawing of the favicon and of Android's `sb_sign_<id>_small` |
| `sign/product.css` | `web` or `desktop` | `[data-sb-product="<id>"]` with `--sb-product-tile` and `--sb-product-glyph` set to the group's custom properties |
| `render/android/…svg`, `render/web/…svg`, `render/desktop/…svg` | the platform of the raster file | one SVG per raster file of section 6 (three for `favicon.ico`): what the renderer draws. Not for a site or an app |
| `NOTICE.md` | every platform | under what terms the files of the folder stand (kit 1.2.0; below) |

- `android/res/` mirrors `res/`: an app adds the folder to its resource directories, and `android/kotlin` to its
  Kotlin sources. **Splash (Android 12+):** an app that shows the sebaro start names `Theme.Sebaro.Start` in its
  manifest (spec/03 of the system) and gets the bare sign on its group's tile colour; `sebaro_splash.xml` is the
  ground of an app that keeps the platform's own splash with the adaptive launcher icon (BRAND-ASSETS section 2).
- **The start files are the target's.** `tools/export_system.py --target android --product <id>` writes the same five
  files for a listed product, from `brand/inline/sign-<id>.svg`. The kit's are those bytes, except the tool the head
  of the two drawables names; the three values files have no head in either (`test_product_kit` `Golden`, all 17
  products). The symbol's name is the one `SbStartSymbol.kt` of the copy looks up (`sb_symbol_` + the id with `_`
  for `-`) and the copy's `res/raw/sebaro_symbols_keep.xml` keeps under resource shrinking (`@drawable/sb_symbol_*`);
  the splash symbol is named by the theme.
- `web/` goes to the site root as it is. The README of a web copy has a table of every file with where a static
  site and an app built by a bundler serve or import it, and the icon step of a desktop app.
- **Which tile at which size.** The rule is the system's (the same on every platform): the base form at 32 px and
  above, the small form below 32 px. Android has both since kit 1.0.0 (`sb_sign_<id>`, `sb_sign_<id>_small`); web
  and desktop have both since kit 1.2.0 (`sign/tile.svg`, `sign/tile-small.svg`). Neither SVG carries a class: the
  stylesheet sizes the tile by `.sb-sign-tile > svg` and has no rule for a class on the `<svg>`.
- **The terms of the folder** (kit 1.2.0). The licence file of the system (`LICENSE.md` of a copy) puts app signs,
  app icons and every file derived from them under „all rights reserved“, not under MIT. So the drawings of the
  folder (every SVG, Android drawable and adaptive icon, PNG and ICO: the sign, its tile, the icons, and the sources
  under `render/`) are marks of the product, and its code and data (`sign/product.css`, the Android values files and
  `SebaroProductInfo.kt`, the manifest, the head snippet, `theme-color.json`, the two records) are MIT like the kit.
  The kit writes this into the folder as `NOTICE.md`, with every file in one of the two lists. A product in a
  repository under an open licence states the first kind as not covered by it (a REUSE `.license` file, or an entry
  in the repository's notice); nothing else has to be stated.
- **The same as the workshop's files.** `android/res/…` equals `brand/dist/<id>/android/…`, `web/…` equals
  `brand/dist/<id>/web/…`, `sign/sign.svg` and `sign/sign-small.svg` equal `sign/glyph.svg` and `sign/glyph-small.svg`,
  and `sign/tile.svg` equals both `sign/tile-light.svg` and `sign/tile-dark.svg` (one pair of colours for both
  modes). `sign/tile-small.svg` has no file of its own there: its drawing is that of `web/icon.svg` and of the
  workshop's inline `tile-<id>-small.svg`, in the frame of `sign/tile.svg` (`test_product_kit` `Golden`). Byte for byte, except the notice in a file's head: the kit's files say `generated by product/product_kit.py`,
  the workshop's `generated by tools/brand_assets.py`, and a launcher layer names the file its drawing comes from.
- `SebaroProductInfo.kt` calls the constructor of the class `SebaroProduct(id, tile)` that `dist/SebaroTheme.kt`
  declares from token contract 1.14 on (stage 3; TOKEN-CONTRACT section 10.2). `test_product_kit` compares the call
  with the generated constructor, and `test_extract_compose.Compile` compiles the two together. With a theme of
  contract 1.13 or older, where `SebaroProduct` is an enum of the system's product list, the file does not compile.
- `product.css` maps the product's id. Markup can also name the group itself, `data-sb-tile="<group>"`, which
  `dist/tokens.css` scopes from token contract 1.14 on (TOKEN-CONTRACT section 10.1); `dist/tokens.css` still carries
  the scope of every listed product.

## 6 Raster files, the renderer, share images

The kit writes text only. The renderer, `render.mjs`, draws the raster files in headless Chromium, which it takes
from **the product's own** Playwright (the working folder, or the folders above `<folder>`; `npm install --save-dev
playwright`, then `npx playwright install --only-shell chromium`), never from the copy. Without one it says so in one
sentence and exits 2. It uses Node 20 built-ins and nothing else, and no network.

**A product without a Node project** (renderer 1.1.0) names a folder that holds `node_modules/playwright` in the
environment variable `SEBARO_PLAYWRIGHT`: any folder in which `npm install playwright` ran, on the machine that
draws. Named, that folder is the only place the renderer looks in (a folder without Playwright is exit 2 and named
in the message); `product_kit.py build --render` passes the variable on. An **Android app** is the case: it needs
the renderer for one file, the Play icon. Its CI runs `check` with `--no-raster` (Python alone), and the icon is
drawn once by hand, and again when the sign changes:
`SEBARO_PLAYWRIGHT=<folder> node <copy>/product/render.mjs <product folder>`.

| Raster file | With | Drawn from | Form |
|---|---|---|---|
| `android/play-store-512.png` | `android` | `render/android/play-store-512.svg` | 512 px, the middle `viewports.play` dp of the launcher icon, full square, 32-bit RGBA with every pixel opaque. For the Play listing: **the app itself needs no raster file** (adaptive icon and vectors, API 26; the apps are at 29) |
| `web/favicon.ico` | `web` | `render/web/favicon-32.svg`, `-16.svg`, `-48.svg` | an ICO of three PNG entries in this order, each the favicon drawn for its own size (16 px: the small form, the same SVG as `web/icon.svg`) |
| `web/apple-touch-icon.png` | `web` | `render/web/apple-touch-icon.svg` | 180 px, `viewports.appleTouch`, full square, 24-bit RGB |
| `web/icon-192.png`, `web/icon-512.png` | `web` | `render/web/icon-192.svg`, `icon-512.svg` | `viewports.any`, cut to the tile's rounded square, RGBA |
| `web/icon-mask.png` | `web` | `render/web/icon-mask.svg` | 512 px, `viewports.maskable`, full square, 24-bit RGB |
| `desktop/icon-1024.png` | `desktop` | `render/desktop/icon-1024.svg` | 1024 px, transparent, with the icon at `desktopBodyPx` in the middle, cut to a superellipse (`squircleExponent`); the input of `tauri icon` or an asset catalogue |

- **One SVG per raster.** Each source is the launcher icon as one drawing (background and foreground, the same
  geometry as the Android layers) with the viewBox of its middle, or the favicon. The renderer draws it at exactly
  the size the record names, alone on a transparent page at device scale 1, and writes 8-bit PNG with an sRGB chunk
  and no other metadata; the ICO is written by hand, a directory of PNG entries. A file with `body` in the record
  (the desktop icon) is drawn at that size and set into the middle of its transparent field. Nothing is written
  until every file is drawn. The same input gives the same bytes on the same Chromium.
- **Against the workshop's own files** (`brand/dist/<id>/`, drawn by `tools/brand_assets.py` with Chromium and
  Pillow): the same pixel sizes and colour types. The favicon entries and the three full-square files have the
  workshop's pixels (at most 1 level apart, the entries not at all). The three cut files differ on the outline: the
  workshop cuts with a Pillow mask, the renderer with a clip path. `tools/tests/test_product_render.py` measures
  this for three products of three tile groups; the numbers are in the system's CHECKS.md.
- **The record of the renderer** is `sebaro-product-raster.json` (section 7). A raster file of an earlier run that
  the kit's record no longer lists is removed.
- **Share images.** A copy of the profile `website` or `webapp` with the pack `share-images` holds the generator
  `brand/og/render.mjs` (spec/09 §18.1), which reads the sign tile of the page list's product from
  `brand/inline/tile-<id>.svg` beside itself; a profile copy has no product's tile, so the generator alone exits 2.
  `node <copy>/product/render.mjs share <folder> --pages og-pages.json --out public/og …` copies what the generator
  reads into a temporary folder, adds `sign/tile.svg` of `<folder>` there under the id of its record, runs the
  generator from it with the arguments after `<folder>` and removes the folder. Nothing is written into the copy.
  The generator looks for Playwright from its own file, which then stands in the temporary folder; `share` links
  the `node_modules` folder of the Playwright the raster files are drawn with into it (renderer 1.2.0), so the
  product's own Playwright and `SEBARO_PLAYWRIGHT` hold for `share` as for the raster files (a named folder without
  Playwright: exit 2). Before 1.2.0 `share` found Playwright from the working folder alone.
  `site.product` of the page list is the declaration's id; a page that names another product's tile is refused. The
  pictures are those the target `web` draws for the same product (`test_product_render` `ShareImages`).
- **Not in the kit's plan:** the legacy launcher PNGs `mipmap-*dpi/ic_launcher*.png` (the adaptive icon needs API 26),
  `social/avatar-1024.png` and the Play feature graphic.

## 7 The records and `check`

`build` writes `sebaro-product.json` into the output folder:

| Key | Meaning |
|---|---|
| `format` | `"1.2"` (`declaration.meaning`; 1.1: `raster` in place of the `notProduced` of 1.0) |
| `kit` | the kit's version |
| `product`, `outputs` | the declaration's `id` and `outputs` |
| `declaration` | `file` (the name, no path), `sha256` of the declaration's bytes as it was read, and `meaning`: the sha256 of its JSON with sorted keys and no white space, which `check` compares |
| `tiles` | `file`, `system` and `sha256` of the copy's `product/tiles.json` |
| `files` | path → sha256 of every file written, the SVGs under `render/` among them |
| `raster` | `renderer` (`product/render.mjs`), `record` (`sebaro-product-raster.json`) and `files`: raster path → `width`, `height`, `alpha` (false: 24-bit RGB) and `source`, with `body` where the drawing is smaller than the file; for the ICO `entries`, each with `size` and `source` |

The renderer writes `sebaro-product-raster.json` beside it: `format` `"1.0"`, `renderer`, `playwright`, `chromium`
(the versions that drew) and `files`: raster path → `sha256` of the file and `sources`, the sha256 of every SVG it was
drawn from. Before it draws, it refuses an SVG that is not the one the kit's record lists.

`check` draws the text outputs again and prints one line per finding:

| Finding | When |
|---|---|
| `missing` | an output, or the record, is not there; a raster file, or its entry in the renderer's record, is not there |
| `edited` | a file differs from what the build wrote (its sha256 is not the recorded one), or the record lists another hash than the file has; a raster file is not the one the renderer wrote |
| `stale` | the file is as built, but the declaration, the copy or the kit give another one now; a recorded file that is no longer an output; the declaration says something else than the record's `meaning`, or `product/tiles.json` has another sha256 than the record says; a raster file was drawn from another SVG than the build gives now, or is no longer an output |

**The declaration is compared by what it says** (kit 1.2.0): its JSON with the keys sorted and without white space.
A formatter that changes white space, indentation, the escaping of a string or the order of keys leaves the build up
to date; a changed value, a `$comment` among them, is reported. One order is not free: the manifest the kit writes
has the members of `web.manifest` in the order the declaration gives them, so sorting those changes
`web/manifest.webmanifest`, and `check` names that file (not the declaration). **A record of kit 1.1 or 1.0** has no
`meaning`: `check` reads it as before, by the sha256 of the bytes, and says in the finding that a build by this kit
compares what the declaration says. One `build` writes the record of this kit.

Any finding gives exit 1. A build by another kit version whose outputs are still the same is a note, not a finding.
Files in the folder that the kit did not write are not looked at. **Raster files are compared by sha256 only**, of the
file and of its sources: `check` draws nothing and compares no pixel, so it needs no browser, and a raster drawn by
another Chromium is up to date as long as its sources are. With `--no-raster` they are not compared at all.

## 8 Versions

`schemaVersion` `"1.0"` · `product/tiles.json` `format` `"1.1"` · record `format` `"1.2"` · raster record `format`
`"1.0"` · kit 1.2.0 · renderer 1.2.0 (1.2.0: `share` finds Playwright as the raster files do; 1.1.0:
`$SEBARO_PLAYWRIGHT`, section 6). A change that makes a valid declaration fail is a major version (D16); new
optional keys and outputs are minor. A changed output changes the kit's version, and `check` then reports the
product's files as stale until `build` runs again.

- **1.2 (2026-11-12, kit 1.2.0, renderer 1.2.0):** `check` compares the declaration by what it says (record 1.2,
  `declaration.meaning`; a record of 1.1 is still read); `sign/tile-small.svg` for web and desktop; `NOTICE.md`;
  `share` finds Playwright as the raster files do. A declaration is valid unchanged; a folder built by kit 1.1.0 is
  stale until it is built again (two new outputs).
- **1.1 (2026-11-12, kit 1.1.0):** the kit, the renderer, the schema and this text ship in every profile copy
  (`product/`); the start of an Android app (five files); one SVG per raster file and the renderer `render.mjs`
  1.0.0, so `--render` works; `check` reads the renderer's record and has `--no-raster`; share images of a profile
  copy through `render.mjs share`; `tiles.json` 1.1 (`raster`), record 1.1 (`raster` replaces `notProduced`). A
  declaration of 1.0 is valid unchanged; a folder built by kit 1.0.0 is stale until it is built again (new outputs).
- **1.0 (2026-11-11, kit 1.0.0):** first version.

## 9 For the maintainers of sebaro

A product needs nothing of this section. `python3 tools/product_kit.py tiles sebaro --out <copy>` writes
`<copy>/product/tiles.json` (section 4) from the sources of a system: `dist/tokens.json`, `brand/brand.config.json`
and `brand/signs.json`. No copy holds those sources; the export writes the file into every profile copy, and a
product never runs the command (in a copy it ends with exit 2 and says so).
