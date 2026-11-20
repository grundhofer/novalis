# Changes for products (sebaro)

What changed for a product with each release of the sebaro design system, and what to do after an update. Written by
hand for someone who builds a product; the newest release stands first. Every profile copy carries this file, a
release publishes it beside the copies, and `checks/update-copy.mjs` prints the sections between the release a copy
had and the one it fetched. The headings are the release tags.

## v2.0.4

A flatter action zone in a window (D152, CHECKS.md §136). Nothing else changed for a product.

**A desktop app**

- Changed: from 480 px of window width the counter line (`__counts`) and below it the state sentence or the message
  stand in one column beside the primary action, instead of the counter line taking a row over the whole width; the
  zone has 8 px above and below instead of 12. With a counter line it is 72 px high at 100 % (was 108), without one
  72 (was 80). The action stays 56 px. Nothing to change in the markup; if your app measures the zone or reserves
  its height, take the new height. spec/02 §4.17.

## v2.0.3

The web twin of the icon toggle (CHECKS.md §135). Nothing else changed for a product.

**A web app, a website or a desktop app**

- New: an icon button with an on/off state shows the filled form of its icon while it is on, as `SbIconToggle` does
  in Compose (D150 (2)). Put both icons into the button, `<svg class="sb-icon sb-icon-button__off">` with the outline
  (`#flash`) and `<svg class="sb-icon sb-icon-button__on">` with the filled form (`#flash--filled`); the stylesheet
  shows the one of the state from `aria-pressed`, so your script only flips `aria-pressed`. A toggle with one icon
  stays as it was (its colour alone). spec/02 §1.5.

## v2.0.2

A fix for the Android lint of v2.0.1 (CHECKS.md §134). Nothing else changed.

**An Android app**

- Fixed: `checks/lint-android.sh` A2 reported every `import …AppProduct`, so every Android app failed it with the
  v2.0.1 copy, the guide's starter too. A2 now also lets pass an `import` line, the named argument
  `product = AppProduct` (the product handed on: a Hilt provider, a call of the sign tile, product area or start over
  several lines, an about state) and test sources (`src/test/`, `src/androidTest/`). Any other use of `AppProduct`
  outside those calls still fails. Nothing to change in the app: take the copy and run the lint again.

## v2.0.1

The open items of the workshop are worked off (CHECKS.md §132): the owner's answers of D149, a stricter Android lint,
a password field and a sign tile by id in Compose, larger targets and fixes in the web parts, the facts contract in
the `facts` pack, and a rule that keeps a copy on its major version. Then six points from two Android products (D150,
CHECKS.md §133): a placeholder tile group, new icons, one part for the appearance settings and an icon toggle in
Compose; core rules 7 and 14 of the guide say when a code stays dark on light and that Android 13 confirms a copy
itself. The token contract stays 2.0. In short:

**Every product**

- Do first, if your scheduled job runs the update right after `checks/update-copy.mjs --check`: the updater (1.3.0)
  keeps a copy on its major version. Without `--release` it no longer writes a release of a newer major than the
  copy's (exit 5, nothing changed, the command named); `--check` still exits 1 and says so. To take a new major, read
  its section here, then `node sebaro/checks/update-copy.mjs --release <tag>`.
- The README's *Keep in sync* says what the updater trusts: the index over HTTPS from the guide's releases, sizes and
  sha256 from the index, no signature. Keep the copy in git and read each update as a diff.
- `LICENSE.md` names the scripts a copy ships (the product kit's `product_kit.py`, `sign_geometry.py` and `render.mjs`,
  `brand/og/render.mjs`, the scripts in `checks/`) as MIT and where `sign_geometry.py`'s third-party code comes from.
- `product/product_kit.py` 1.3.1: `--help` shows `build` and `check` only; `tiles` is the maintainers' command and ends
  with exit 2 in a copy. Outputs unchanged: no product folder turns stale.
- `product/PRODUCT-CONTRACT.md`: a new product's sign passes the maintainers' 16-px distance check once before its
  first release (section 3, D149 (7)); section 5 names the three Android lint warnings of the kit's folder and a
  `lint.xml` that scopes them.
- The copy's files name the maintainers' repository sebaro-foundry where they said sebaroDesign
  (`checks/verify-export.mjs`, `checks/update-copy.mjs`, `product/`, `brand/og/render.mjs`); nothing drawn changes.
- The label „provisional (agent)“ is gone from comments and texts (D149: the owner confirmed those choices); no rule
  changed with it.
- **A ninth tile group, `placeholder` (Graphit `#514946`, D150).** The tile of the guide's starters until a product
  picks its own group: a neutral that no purpose group and no role uses, so a new product's tile and product area
  no longer look like the cobalt of the selected place, links and focus. The copy has it everywhere a group is:
  `--sb-tile-placeholder` / `--sb-tile-placeholder-glyph` and `[data-sb-tile="placeholder"]` in `tokens.css`,
  `--color-tile-placeholder` in the Tailwind bridge, `SebaroSignTile.Placeholder` in Compose, `signTiles.placeholder`
  in `tokens.json` and `groups.placeholder` in `product/tiles.json`. White sign 8.78 : 1, so small text is allowed in
  its product area. Nothing to do for a product that already names one of the eight purpose groups.
- **`product/product_kit.py` 1.4.0** (PRODUCT-CONTRACT 1.4) takes `"tile": "placeholder"` and draws it like any
  group; `build` and `check` then print `warning: tile "placeholder" is the starters' placeholder, not a purpose
  group: set "tile" in sebaro.product.json to the product's own group (…) before its first release, then run build
  again`. The warning does not change the exit code. A product started from a starter sets `tile` to its own
  group before its first release.
- **Every product runs the kit's `build` once after taking this copy** (with `--render` where it keeps raster files):
  `product/tiles.json` has a ninth group, so `check` reports the folder as stale (`product/tiles.json of the copy
  changed since the build`) although no output of an existing group changes.
- `checks/sb-colour-count.js` counts the placeholder's tile colours as the product area's own, like the other
  groups'.
- New icon `wifi` (WLAN, „WLAN verbinden“): three signal arcs over a base dot, the arcs of the `offline` spot at 24 px.
  Outline only, always beside its word; it names the network or joining it, never a signal strength. Sprite id `wifi`,
  Compose `SebaroIcons.Outline.Wifi` (also `Outline16`, `Outline20`, `Outline32`), Android `ic_sb_wifi_24.xml`.
- New filled forms for a selected bottom-navigation place: `scan--filled`, `qr-code--filled`, `microphone--filled`
  (Compose `SebaroIcons.Filled.Scan`, `.QrCode`, `.Microphone`, also in `Filled16`; Android
  `ic_sb_scan_filled_24.xml`, `ic_sb_qr_code_filled_24.xml`, `ic_sb_microphone_filled_24.xml`). Each keeps its
  outline's box, so switching does not move the icon. A product that drew its own filled form or showed the outline
  when selected switches to these: `if (selected) SebaroIcons.Filled.Scan else SebaroIcons.Outline.Scan`.

**A website, a web app, a desktop app**

- The pack `facts` now also brings `facts/`: the facts contract, its schema and the checker
  (`facts/tools/check_facts.py` 1.3.1 with `check_palette.py` and `color.py`). Check `facts.json` in CI with
  `python3 sebaro/facts/tools/check_facts.py facts.json --ci …`. Nothing to do for a copy without the pack.
- `.sb-chip__remove` is a 48 × 48 px target (was 40 × 48), also under touch in a window; under a fine pointer in a
  window it stays 32 × 32.
- `.sb-code__copy` draws its focus ring inside the key (the block's `overflow: hidden` cut it).
- `.sb-progress-ring__value` at 100 % (`stroke-dasharray="100 100"` or `"100"`) has no hairline seam at twelve o'clock.
- After a `.sb-list-header--sticky` and a window's sticky `.sb-doc-tabs` row, focus stops below the head instead of
  behind it (`scroll-margin-block-start`); the bottom block's scroll room works without `:has` too.
- `.sb-dialog__body` shows D142's scroll sign while it holds more than it shows (`sb-controls.js`); the body reaches
  12 px into the dialog's end padding, its words keep their width.
- `sb-menu.js` places an open menu again when its size changes and keeps a menu taller than the room inside the window.
- `theme-button.js` and `sb-tone.js` announce a key a further language lacks in German, as the other scripts do.
- `.sb-stale-notice`'s warning glyph is centred on its first line at every text size.
- The web READMEs' table „Which pack has a class“ lists every class a pack's rules name and, in a new column, the
  classes its scripts use, so a pack of scripts alone has a row.
- spec/09: right to left is not supported until a product needs it (D149 (11)); §3.1 states D148's large-text floor
  (one check per view at 200 % page zoom at desktop width, „…“ allowed). spec/02, spec/09: `data-sb-tile="<group>"`
  names the tile group where a page has no `product.css` for its id. Spec references in comments are corrected.

**An Android app**

- Do first: `checks/lint-android.sh` is stricter. A2 catches `SebaroProduct(` and `AppProduct` outside the sign tile,
  product area, start, frame and template (a `val … = SebaroProduct(` declaration and the kit's `SebaroProductInfo.kt`
  pass); A4 also refuses the stock M3 `TextField`, `OutlinedTextField`, the `TabRow` family, the `SegmentedButton`
  family and `ExposedDropdownMenuBox` outside `/designsystem/`. A screen of the product's own that uses one fails the
  lint until it takes `SbTextField`, `SbTabs`, `SbSegmented` or `SbSelectField`.
- New: `SbPasswordField(value, onValueChange, label, …)` masks a password (one dot per character, password keyboard
  without suggestions). The account template's reference filling passes it.
- New: `SbSignTile(product, contentDescription, size = …)` without a painter reads the app's own `sb_sign_<id>`
  (32 dp and above) or `sb_sign_<id>_small` by the product's id and fails with the resource's name when one is
  missing; `res/raw/sebaro_symbols_keep.xml` keeps `@drawable/sb_sign_*` under strict resource shrinking.
- `SbStart` shows the start once per start of the activity: it keeps that it ended (`rememberSaveable`), so a rotation
  does not show it again. The README's `savedInstanceState == null` recipe is gone; an app that kept it may leave it.
- `SbNotesJson.parse` and `SbActionHints.parse` take `words: SbFactsWords` (default `SbFactsWords.forLang(lang)`), so
  an app in a further language passes its own words; calls without it behave as before.
- The warning glyph of `SbStaleNotice` and of `SbFactsLine`'s stale notice is centred on the first line at every text
  size.
- The profile `android` has a new pack `facts` with the same `facts/` as the web packs (`--packs <yours>,facts`).
- `templates/android/res/values-en/sb_view_templates.xml`: the read sample says „Saturday, 9:00“ (24 h). Only matters
  if the app copied the sample strings.
- Comments only: every Kotlin file's head names `extract_compose.py` 1.6.0; `res/values*` name export 1.35.0;
  `SbWrapText`'s KDoc no longer says „never clipped“.
- New `SbAppearance(mode, tone, reduceMotion)`: the three appearance settings as one value, defaults System, Cool and
  off (the system's „Remove animations“ still counts, `sbReduceMotion()`). Store `modeId` („system“, „light“, „dark“)
  under `SbAppearance.KEY_MODE` (`"sb-theme"`), `toneId` („cool“, „warm“) under `KEY_TONE` (`"sb-tone"`) and
  `reduceMotion` under `KEY_REDUCE_MOTION` (`"sb-reduce-motion"`, a boolean) in your own DataStore or
  SharedPreferences; read them back with `SbAppearance.fromStored(mode, tone, reduceMotion)`. A missing or unknown
  value gives the default, and case is ignored, so the enum names you stored before („Dark“, „Warm“) still read. You
  can drop your own enums and their mapping to `SbThemeMode` and `SebaroTone`; keep your store (spec/08 §12.4 has the
  few lines with DataStore). Nothing to do if you keep your own code: the three parts are unchanged.
- New `SbAppearanceSettings(appearance, onChange)`: „Hell oder Dunkel“, „Farbton“ and „Bewegung immer reduzieren“ as one
  section, words from the table in German and English; put your own `SbListHeader` („Darstellung“) above it.
  `SebaroAppTheme(appearance) { … }` takes the value whole.
- New `SbIconToggle(checked, onCheckedChange, label, icon, checkedIcon)`: an icon button with an on/off state (a
  scanner's light). Same 48 dp, fills and focus ring as `SbIconButton`; on shows the filled icon in the link colour;
  TalkBack hears the switch role and on/off. If you swap icon and description of an `SbIconButton` by hand, replace it
  and name the thing („Licht“), not the act („Licht einschalten“); your two strings for on and off can go. The camera
  view's photo flash stays `SbFlashMenu`.
- `templates/android/`: `SbViewTemplateData` takes `appearance` and `onAppearance` instead of `theme`, `onTheme`,
  `tone`, `onTone`, `reduceMotion` and `onReduceMotion`, and `SbSettingsTemplate` shows `SbAppearanceSettings`. Only
  matters when you copy the templates again: fill the two new fields from your store.
- `SbMetaList(items, labels = true)` puts every label above its value also once the widest word of a label or a value
  (a file name's widest part) does not fit its column, as the plain list does (D99 (1), D150 (7)): „Stadtbibliothek“
  or an e-mail address at font scale 1.3 on 360 dp no longer break inside the word. Still one arrangement per list. If
  you measured this yourself and passed `stacked = true`, you can drop that code.
- Core rule 14 (D150): on Android 13 and later the system confirms a copy to the clipboard itself; show your toast
  „In die Zwischenablage kopiert“ only below (`Build.VERSION.SDK_INT < 33`). Core rule 7 (D150): a QR code or bar
  code stays dark on light in dark mode too, inside `SebaroAppTheme(SbThemeMode.Light)` with a light margin.

## v2.0.0

The design system lists no product any more: no product's id, tile group or sign is part of it, in any copy. A
product that declares itself, as every copy since `v1.14.0` asks, has little to do. The release is a new major
version because the token contract is 2.0 now, and because three things an Android app could still call are gone.
In short:

**Every product**

- The kit is 1.3.0 and its `product/tiles.json` 1.2 (it brings the font of the Play feature graphic's name, below),
  so the kit's check (`product/product_kit.py check`) names the product's folder stale after the update: run `build`
  once, render the raster files the product keeps, commit the folder, and check again, as after every update.
- `checks/update-copy.mjs --check` belongs to a scheduled job once a week, no longer to every build (README, *In
  the product's CI*): move it there, so a release does not turn the product's next build red.
- Keep this folder and the product's folder out of the product's formatter, linter and commit hooks: a reformatted
  file fails the checks (README, the same section).
- The token contract is 2.0: the first lines of `tokens.css` and `tokens.tailwind.css`, `meta.contract` of
  `tokens.json` and `SebaroBuildInfo.CONTRACT` of `SebaroTheme.kt` say "2.0"; a check of the product's own that
  expects "1.14" there moves along. The rules are the ones they had, and nothing changes in `sebaro.product.json` or
  in the markup: the product's own `product.css`, loaded after `tokens.css`, still gives its id its tile colours; so
  does `data-sb-tile="<group>"` on the element that carries the id.
- The guide is now `grundhofer/sebaro-blueprint` (renamed from `sebaro-guide`): `checks/update-copy.mjs` 1.2.0 reads
  its releases there. GitHub forwards the old address, so a copy of `v1.14.0` still finds this release.
  `LICENSE.md` names the guide by its visible name, sebaro Blueprint.
- The workshop is now the private `grundhofer/sebaro-foundry` (until 2026-11-14 `grundhofer/sebaroDesign`): `LICENSE.md`
  names it sebaro Foundry, and the README says the copy is made there. Nothing else in the copy changes.

**A website, a web app, a desktop app**

- `css/runtime-names*.json` (format 1.1) no longer list the static state classes (`is-hover`, `is-focus`,
  `is-pressed`, `is-visited`, `is-active`, `is-target`). The README's cut therefore keeps a rule with one only where a
  page names that class: a site that shows no specimen keeps about 1 KB less (the guide's website starter: 1,111
  bytes of its cut, 1,061 minified). A page that sets one by its own script names it as a word there, or the cut
  drops the rule.
- A website or web app: the share-image generator (`brand/og/render.mjs` 1.3.0, pack `share-images`) takes any
  language: `site.lang` is a language tag, and a language other than `de` and `en` gives the words its pages need in
  `site.words` (page list 1.1). Its message for a missing tile now says that the tile comes from the product's folder
  through `product/render.mjs share`.
- The scripts' words for a further language: the README (section *Scripts*) says how a product gives them in
  `window.sbMessages`, without touching the copy.
- Below 640 px the four words of the site header have 5 px beside each word instead of 6 px, so four short English
  words and „DE / EN“ stay on one row at 390 px in dark mode too, whose type is wider. Nothing to do; the header
  from 640 px on is unchanged.
- The heatmap's column of week heads is as wide as its widest head where that is wider than 4.5rem
  (`js/sb-fit.js` measures it into `--sb-heatmap-heads`), so an English head („from 28 Sep“) no longer runs into the
  first day; German heads keep 4.5rem, and without `js/sb-fit.js` the column stays 4.5rem. Nothing to do; a page
  that changes the heads after load without a change of size calls `sbFit.refresh()`.

**A desktop app**

- The window opens in the product's colour (the owner's decision), and the app's own Rust code does it: no file of
  the copy can. `src-tauri/build.rs` reads the tile colour of the product's group (`signTiles.<group>.tile` of
  `tokens.json`, the group from `sebaro.product.json`) where it reads the four grounds, the window is created with it
  as its ground, and when the start is over (`sb-start-done`) the window takes the stored light or dark ground. The
  README (section *Moving a product here*, item 1) says where the colour comes from; the guide's desktop starter
  (`templates/desktop-tauri`) has the code (its command `start_ended`). Until now the window stood briefly in the
  neutral ground before the start.
- `tokens.json` has no `products` key and no `products` list under `signTiles.<group>` (both were empty in a copy).
  Code that read them finds nothing; the product's own values are in its declaration.

**An Android app**

- `SebaroProduct` is a class with its constructor (`name`, equality and `toString()` stay) and no companion:
  `SebaroProduct.Studio`, `SebaroProduct.entries` and `SebaroProduct.fromId(…)` no longer compile. Pass the kit's
  `AppProduct` (`android/kotlin/SebaroProductInfo.kt` of the product's folder) wherever a product is asked for.
- `SbStart(ready, tile, content)`, the call without a product, is gone. Write
  `SbStart(ready, AppProduct, tile, content)`; the start then has the product's colour, not the umbrella's.
- `SebaroSignTile.forProduct(key)` and `SebaroSignTile.products` are gone. The product's group is `AppProduct.tile`;
  `SebaroSignTile.fromId("<group>")` still finds a group by its id.
- The kit draws the Play feature graphic: `android/play-feature-1024x500.png` (1024 × 500, a 24-bit PNG without
  alpha) beside the Play icon, in the look the owner accepted for the hand-made ones: the tile colour of the group,
  the line and the band of the Play icon at the bottom, the sign and the app's `name` in sebaro Sans 600 at 92 px, no
  other text. Draw it with the renderer, as the Play icon (README, *Product files*), again whenever the sign or the
  name changes (`check` names it stale), upload it as the listing's feature graphic and stop making it by hand. A
  name too long for the row is set smaller, down to 64 px; still too long, or with a character sebaro Sans does not
  draw, the renderer refuses the file and says why.
- The README's CI step that searched the app's Kotlin for `SebaroProduct.fromId(` is gone: the compiler finds that
  call now. A product that copied the step can drop it.
- A missing start symbol now names the file in its message: `sb_symbol_<id>`, which the kit writes.
- The head comment of `res/values*/sebaro_colors.xml` and `sebaro_theme.xml` names the updater instead of a file of
  the workshop; the README's *Not exported* no longer lists the launcher, sign and start files, which the kit writes.
- `SbHeatmap`: the column of the week heads is as wide as the widest head as it is drawn, at the current font
  scale, and never narrower than before (72 dp × the text scale), so an English head („from 14 Sep“) stays on one
  line; German heads keep the width they had. Nothing to do.

## v1.14.0

The first release as public copies: one copy per kind of product (`website`, `webapp`, `desktop`, `android`), fetched
and kept current by `checks/update-copy.mjs`, with packs to choose. A new product starts with the copy's `README.md`.
A product that used an older copy (a `--target` export, the npm or the Maven package) moves once; the README of the
new copy has the steps and the markup under *Moving a product here* (web and desktop) and *Moving an app here*
(Android). A copy of a probe release (`v1.14.0-probe`) is updated by the probe's own updater, which does not print
these notes and records the size of the stylesheet with every pack; run the updater once more with the same packs
(`checks/update-copy.mjs --packs <the packs of the copy>`) and the record is right. In short:

**Every product**

- The copy knows no product. The product declares itself in `sebaro.product.json`, and the kit in `product/` of the
  copy writes its files into a folder of the product: sign, tile, favicons, manifest, head snippet, launcher icon,
  the start of an Android app. The files an older copy brought for one product (`brand/site-root/`,
  `brand/inline/sign-<id>.svg`, `launcher/<id>/`, `tauri/icon-1024.png`) come from that folder now.
- CI runs the copy's own checks: `checks/verify-export.mjs --strict`, `checks/update-copy.mjs --check`, the lint
  script, and `product/product_kit.py check` (Python 3.10 or newer). The README's table *What needs what* names what
  each needs.
- The sign tile has two forms: the whole tile for 32 px and above, a small form below. A product shows the small one
  where the tile is smaller than 32 px.

**A website, a web app, a desktop app**

- One stylesheet: the imports of `css/parts/` become `css/sebaro.css`, which holds the core and the packs the copy
  was fetched with. Name the packs whose parts the pages use.
- The start is a full screen in the product's colour with its bare sign. Put the product's id on it,
  `<div class="sb-start" data-sb-product="<id>">`, inline `sign/sign.svg` of the product's folder in
  `.sb-start__tile`, and load the product's `product.css` after `tokens.css`. With the old markup the start is
  transparent.
- A page budget: the stylesheet is larger than 90 KB before any pack. The README's section *Cut the stylesheet to
  what the pages use* has a build step that cuts it and the icon sprite to the pages; the copy lists what exists only
  at run time, so a site's own safelist of sebaro names is not needed. A purge script of the product's own gives way
  to that step.
- `checks/lint-web.sh` takes every CSS source file of the product and then the folder of its pages, searches that
  folder with its subfolders, and ends with a usage line and exit 2 when an argument is missing. It is for source
  files, not for the built bundle. Every finding is one line: rule, file, line, text.

**An Android app**

- The copy is the source of one Gradle library module of the app, with the fixed packages
  `de.sebaro_ventures.design`. The README has the module's build file.
- Three calls compile and go wrong on the screen: `SbSignTile` wants the whole tile drawable `sb_sign_<id>`,
  `SebaroProduct.fromId` throws (use the kit's `AppProduct`), and the `SbStart` without a product shows the
  umbrella's colour. The README has each call before and after.
