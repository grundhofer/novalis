# App icons

The novalis sign from sebaroDesign (ADR-0048): the flower on the petrol tile
of the collaboration group, with the foot every sebaro sign tile has since
D143/D144 (the ink line and the lime band; until then the tile carried the
code `nvs`). Its source is `sebaro-product/desktop/icon-1024.png` at the
repository root, which the sebaro export's product kit draws from
`sebaro.product.json` (docs/sebaro-luecken.md Z14); `app-icon.png` is a
byte-identical copy of it. Every other file here is generated from it:

    cd apps/desktop && cargo tauri icon ../../sebaro-product/desktop/icon-1024.png -o src-tauri/icons

Keep only the files `tauri.conf.json` and this folder already list; the
command also writes `android/` and `ios/`, which this macOS app does not use.
Re-run it after every build of `sebaro-product/` that changes
`desktop/icon-1024.png` (the icon set is in neither the export's
`sebaro-export.json` nor the kit's `sebaro-product.json`).

Generated 2026-11-12 with tauri-cli 2.11.4 from the kit's file (kit 1.1.0,
renderer 1.1.0, Chromium 153.0.8010.12).
