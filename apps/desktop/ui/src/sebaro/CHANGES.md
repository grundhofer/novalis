# Changes for products (sebaro)

What changed for a product with each release of the sebaro design system, and what to do after an update. Written by
hand for someone who builds a product; the newest release stands first. Every profile copy carries this file, a
release publishes it beside the copies, and `checks/update-copy.mjs` prints the sections between the release a copy
had and the one it fetched. The headings are the release tags.

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
