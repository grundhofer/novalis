# 19. Boards keep an order; a card moves between boards

Date: 2026-09-15

## Status

Accepted. Amends ADR-0006's `board.json` schema (an optional `order`) and
ADR-0018's "board rows are neither" (board rows drag among themselves and
take a card). Boards stay under `boards/`.

## Context

The tree lists boards as root-level rows (ADR-0012) in the order the core
returns them — by slug, which nobody chose. A card lives on one board; to put
it on another one had to create it again and delete the old one. Testing the
sidebar branch on 2026-09-15, the owner wrote:

> also man sollte auch boards per drag and drop bewegen.

Asked "Boards per Drag & Drop — was genau soll bewegt werden?" (several
answers allowed):

> Reihenfolge der Boards im Baum, Karten zwischen Boards ziehen, Board in
> einen Ordner verschieben

The third answer would take a board out of `boards/`. That costs more than a
drop target: ADR-0006 and PLAN.md §8.1 find a board only under `boards/`, the
CLI addresses one by its folder name there, `doctor` checks that folder, the
tree draws it from that folder, and moving a folder is the directory-aware
relink ADR-0018 left open. Asked "Boards an beliebigen Orten im Vault (statt
nur unter boards/)? …" with that named:

> Nein, Boards bleiben unter boards/ (Recommended)

So the third option is withdrawn; the first two are built.

## Decision

- **`board.json` gains an optional `order`** — a fractional-index key of the
  §8.3 scheme, the same kind a card has. It is absent until the user drags a
  board; only the dragged board is ever keyed, never another one on its
  behalf. The list order is: keyed boards first, by key, then the boards
  without a key, by name; the slug breaks every tie, so two devices that
  chose the same key agree. The core's `list_boards` returns that order and
  `move_board(slug, first | last | after slug)` computes the key between the
  keyed neighbours and writes `board.json` under its read-time precondition,
  replayed once on a conflict; `updated` is bumped, as for any user edit. A
  board without a key next to the drop stays without one — the new key is
  chosen against the keyed boards only, and the unkeyed ones keep following
  them.
- **The shell's `board_write` gains a `place`** (`first`, `last`, `after`
  slug), the key is computed in Rust and never sent by the UI. No new IPC
  command.
- **A card can move to another board**: `CardOpDto::moveToBoard { id, board }`
  on the existing card command, `move_card_to_board` in the core. The card
  keeps its id, title, notes, description and `created`; `updated` is now.
  It lands last in the target's first column as a new file — `RENAME_EXCL`,
  so a copy already there is an error, never a clobber — and the source card
  is tombstoned like a deletion: ADR-0006's sync-safe way for a file to
  vanish, purged after 30 days.
- **In the UI**, board rows drag among themselves: dropped after another
  board row, or on the tree's empty space, which means last. A card dragged
  from the open board onto a board row in the sidebar moves to that board.
  Board rows still take no file drop, and a file row still cannot be dropped
  on a board (ADR-0018).
- **`order` is a board field, not a card field.** ADR-0006's "no further
  card fields" (as ADR-0013 amended it) stands; this changes the
  `board.json` sentence only.
- **The CLI does not write `order` yet.** `board ls` lists boards in the
  display order and carries no `order` field; `board columns --set`
  round-trips the key untouched, like any other key. A flag to place a board
  from the CLI is an add, later, and needs no contract change.

## Consequences

- PLAN.md §8.2's `board.json` example shows `order` with one sentence; §9.2 is
  unchanged.
- Two gestures for `docs/KEYMAP.md`'s mouse-gesture table (`tree` scope): a
  board row dragged after another board row or onto the tree's empty space;
  a card dragged from the board pane onto a board row.
- Two devices dragging different boards offline edit different files and do
  not conflict. The same board dragged on both is a `board.json` conflict and
  resolves as ADR-0006 says: last writer wins, columns unioned; the winner's
  `order` stands.
- A cross-board move is two files, the tombstone at the source and the new
  card at the target. A device that receives one before the other shows the
  card on both boards, or on neither, until the second file arrives — the
  same window a delete-and-recreate has, and the reason the source is
  tombstoned rather than removed.
- Until the tombstone is purged, the id exists on two boards. The CLI's
  `card mv`, `card set` and `card rm` look a card up by id across boards;
  when exactly one of the hits is live, that one is the card and the
  tombstone is not counted (two live copies still exit 4 with `candidates`).
  `card ls` never lists tombstones and shows the card once.
- No new dependency, setting, menu item or shortcut: the WebView's own drag
  events over the existing commands.
- Not part of this decision: boards outside `boards/`, a board dropped into a
  folder, reordering cards across boards in one drag, a CLI flag that places
  a board.
