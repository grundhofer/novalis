# 13. Card description

Date: 2026-09-14

## Status

Accepted.

## Context

ADR-0006 fixed the card file at `{id, title, column, order, notes, created,
updated}` plus the `deleted` tombstone and rejected every extra field —
description, due date, tags, colour, WIP limits, swimlanes — in one row,
because each is a schema addition. PLAN.md §4.4 recorded the same with the
note "description first if anything".

On 2026-09-14 the owner used the board and found that a card holds nothing
but its title and its note links. They asked to be able to put something on
the card. Asked "Karteninhalt auf dem Board" with three forms on the table,
they chose the field.

## Decision

`Card` gains exactly one optional field: **`description`**, a string,
Markdown by convention. The key is absent from the file when the text is
empty, so a card without a description is byte-identical to what every
earlier version wrote, and an older reader that does not know the key
round-trips it untouched through `serde(flatten)` like any other unknown
key (§8.2). Nothing else on ADR-0006's rejected list changes: due date,
tags, colour, WIP limits and swimlanes stay no.

- Core: `Card.description: Option<String>`, `CardChange::Description`,
  `NewCard.description`. The empty string clears the field.
- Shell: `CardDto.description`, `CardOpDto::SetDescription`.
- CLI: `card add --description` and `card set --description`; `""` clears.
- App: the text is shown as plain text under the title on the card, clamped
  to three lines. It is edited through the one dialog the app already has,
  in a multi-line form: `Enter` inserts a newline, `Cmd+Enter` saves, and an
  empty field is saved rather than swallowed, because emptying the field is
  how the text is cleared. No Markdown rendering in v1.

The owner's words, 2026-09-14:

> ich möchte auf dem kanban mode auch die karte etwas befüllen können.

and, asked "Karteninhalt auf dem Board":

> Feld description (Recommended)

whose option text was "Optionales Markdown-Feld in der Kartendatei
(weggelassen wenn leer, alte Leser ignorieren es). Auf der Karte als Text
unter dem Titel, auf 3 Zeilen gekürzt; bearbeiten über den bestehenden
Dialog als Mehrzeiler (Cmd+Enter speichert). CLI: card add/set
--description. Kein Rendering in v1."

## Consequences

- ADR-0006's "No further card fields" now reads "no further card fields
  except `description` (ADR-0013)". `docs/DECISIONS.md` row "Kanban extra
  card fields" says the same. PLAN.md §4.4, §5.3 step 5, §8.2 and §9.2 carry
  the field.
- The card conflict rule (§8.4) is unchanged: whole-card last-writer-wins
  on `updated`, so a description edited on two devices resolves like a
  retitle, with the loser under `conflicts/`.
- The board pane grows by one row per card that has a description. Three
  lines is the clamp; a longer text is read in the dialog.
- What this does not add: rendering of the Markdown, a second field, a
  card detail view, search over descriptions. Each would be its own
  decision.
