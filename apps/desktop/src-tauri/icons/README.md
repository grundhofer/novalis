# App icons

The novalis sign from sebaroDesign (ADR-0048): the flower with the code `nvs`
on the petrol tile of the collaboration group. `app-icon.png` is an unchanged
copy of sebaroDesign `systems/sebaro/brand/dist/novalis/tauri/icon-1024.png`;
every other file here is generated from it:

    cd apps/desktop && cargo tauri icon src-tauri/icons/app-icon.png

Keep only the files `tauri.conf.json` and this folder already list; the
command also writes `android/` and `ios/`, which this macOS app does not use.
