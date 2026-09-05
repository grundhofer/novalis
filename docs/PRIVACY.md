# Privacy

novalis contains **no telemetry, no analytics, no crash reporting, and no
update check**. There is no build in which the app contacts the developer,
because there is nothing for it to contact (ADR-0002).

## Outbound connections

Every connection the app or the CLI can open, by feature. In Sync Mode 1 (the
only mode in v1) the table is empty on purpose:

| Feature | Talks to | What is sent |
|---|---|---|
| — | — | — |

Sync works by putting the vault into the OneDrive or Google Drive folder. The
vendor's own client moves the bytes; novalis only reads and writes local files
and never talks to a server. Fonts are bundled, never loaded from a CDN.

If Sync Mode 2 (in-app login, PLAN.md §5.7) is ever approved, it gets its own
ADR and its rows appear here before the code merges.

## How to verify

- No HTTP client of ours: `grep -rniE 'reqwest|hyper|ureq|isahc|curl' crates/*/Cargo.toml apps/desktop/src-tauri/Cargo.toml` finds nothing, and neither does the same grep over the Rust sources or `fetch(`/`XMLHttpRequest`/`WebSocket` over `apps/desktop/ui/src`. `pnpm ls --depth 0` lists no fetch wrapper.
- `Cargo.lock` *does* contain `reqwest`, `hyper` and `http`: `tauri` itself depends on them unconditionally (`cargo tree -i reqwest --target all` names `tauri` as their only parent). They are compiled in and never called by novalis; removing them would mean forking Tauri.
- The webview cannot reach the network even if a dependency tried: the CSP in `tauri.conf.json` is `default-src 'none'` with `connect-src ipc: http://ipc.localhost` — the Tauri IPC endpoint and nothing else. Fonts are `font-src 'self'`, bundled, never from a CDN.
- No updater: `apps/desktop/src-tauri/tauri.conf.json` has no `updater` block and no `plugins.updater` entry.
- `sudo lsof -i -a -c novalis` while the app runs shows no sockets.
- **Not yet enforced by CI:** PLAN.md §11.5 wants a check that compares this table with a grep for HTTP-client crates. It does not exist, because the naive grep is now noise (see the `tauri` row above); the gate has to look at our own manifests and sources, not at `Cargo.lock`. Until it is written, this section is checked by hand at release time.

## What is stored, and where

| Data | Location | Notes |
|---|---|---|
| Your notes, boards, other files | The vault folder you chose | Plain files; novalis never rewrites bytes you did not type (PLAN.md Rule 3) |
| `.novalis/vault.json` | Inside the vault | `{"format": 1}` plus a `migrated` timestamp after migration; the only file v1 writes there |
| Settings (four keys + last vault) | `~/Library/Application Support/io.github.grundhofer.novalis/settings.json` | See `docs/SETTINGS.md` |
| Window state, tabs, sidebar width | `…/io.github.grundhofer.novalis/state.json` | Disposable |
| Note cache (paths, mtimes, sizes, hashes, titles, tags, links) | `…/io.github.grundhofer.novalis/cache/<vaultkey>-s<schema>.sqlite` | Disposable; never inside the vault, never contains note bodies |
| Conflict copies | Next to the original note, or `boards/<slug>/conflicts/` | Created only when two versions collide; never deleted automatically |
| Trash | macOS Trash | Deleting in novalis moves to the system Trash, never deletes |

No keychain items are created in v1. No data leaves the machine through
novalis.

## Diagnostics

There is no crash reporter. If something goes wrong, the error dialog offers
"Copy details"; the text stays in your clipboard until you decide to paste it
somewhere.
