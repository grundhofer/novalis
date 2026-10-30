# App icons

The novalis sign from sebaroDesign (ADR-0048): the flower with the code `nvs`
on the petrol tile of the collaboration group. Since ADR-0051 its source is
the sebaro export, `ui/src/sebaro/tauri/icon-1024.png`; `app-icon.png` is a
byte-identical copy of it. Every other file here is generated from it:

    cd apps/desktop && cargo tauri icon ui/src/sebaro/tauri/icon-1024.png -o src-tauri/icons

Keep only the files `tauri.conf.json` and this folder already list; the
command also writes `android/` and `ios/`, which this macOS app does not use.
Re-run it after every re-export that changes `tauri/icon-1024.png` (the icon
set is not in the export's `sebaro-export.json`).

Checked 2026-10-24 against the export of sebaroDesign `0f40a10` with
tauri-cli 2.11.4: every PNG and `icon.ico` came out byte-identical, and
`icon.icns` held the same twelve images with the same bytes in another order,
so nothing was replaced.
