# Changes for products (sebaro)

What changed for a product with each release of the sebaro design system, and what to do after an update. Written by
hand for someone who builds a product; the newest release stands first. Every profile copy carries this file, a
release publishes it beside the copies, and `checks/update-copy.mjs` prints the sections between the release a copy
had and the one it fetched. The headings are the release tags.

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
