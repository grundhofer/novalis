# 0058 — Boards live in folders

**Status:** accepted · **Date:** 2026-11-16 · **Decider:** Sebastian Grundhöfer

## Context

Since D6 a board is `<vault>/boards/<slug>/` with `board.json` and `cards/`, and the tree draws every board as the last rows of its top level (ADR-0012). The owner keeps projects in folders and wants a project's board in the project's folder, moved there as a file is. Offered: keep the files under `boards/` and only draw the board elsewhere, or really move the folder. The owner chose the real move, so that a board is found where its project is, also by the CLI and in the Finder.

## Decision

- **A board is a folder with a valid `board.json` anywhere below the vault's top folder.** `boards/<name>/` stays the home of the tree's top level and of every new board; a folder directly in the vault's top folder is never a board (so a key without `/` always means `boards/<key>`). A board's own folder is not searched for boards, hidden folders are skipped. Nothing in `board.json` or the card files changes.
- **The key.** A board in `boards/` keeps its folder name as its slug, as before; a board elsewhere has its vault-relative folder path as its slug (`Projekte/Kunde/plan`). `boards/<name>` is accepted for `<name>`. Every slug existing vaults have keeps its value.
- **Moving.** The board's folder moves under its own name, `board.json`, `cards/` and `conflicts/` with it, in one `rename` (a sync client sees a folder move). Refused into the board itself or into another board, into a folder that is not there, or where the name is taken; nothing is renamed or overwritten. Card `notes[]` are vault-relative and stay valid.
- **In the app.** A board row dropped on a folder moves into it; dropped on another board it goes into that board's folder, after it; dropped on the tree's space it goes to the top level, last. „Verschieben nach …“ is in the board row's context menu and the palette, as for a file, with „Rückgängig“ in its toast. In a folder the boards come after the files, in the boards' own order (ADR-0019). The boards view keeps one order for all boards.
- **CLI.** `board mv <b> <folder>` (`""` the top level; `--dry-run`), answering in the `board show` shape with the new `slug` and `path`. Every `<b>` and `--board` takes a slug or the board folder's path. `board new` still creates in `boards/`.

No setting, no dependency, no new IPC command: `board_write` takes an optional `folder`. A new `invalid_path` reason, `in_board`.

## Consequences

- PLAN.md §5.5, §8.1 and §9.2 and the agent skill describe boards in folders.
- **Older versions do not see a moved board.** novalis 1.4 and earlier, the app or the CLI on another device, look in `boards/` only; a board moved elsewhere is missing there until that device is updated. Its files are untouched either way.
- Listing the boards now walks the vault's folders (directory listings only, `board.json` read where one is listed), not `boards/` alone.
- A note made from a card while a board is chosen in the tree goes beside the board, into its folder, not into the board's folder.

**Owner approval:** 2026-11-16 — „mir gefällt nicht, dass die darstellung im projektbaum immer boards unten untereinander anzeigt. ich hätte die auch gerne in einen ordner vrschoben, so wie die dateien.“ Then, asked how: „wirklich verschieben ist besser damit die boards auch über projektordner richtig zugeordnet gefunden werden.“; where in a folder: „Nach den Dateien“; the CLI: „Ja, board mv (Recommended)“.

## Sources

D6 · ADR-0012 · ADR-0018 · ADR-0019 · ADR-0054 · PLAN.md §8.1, §9.2
