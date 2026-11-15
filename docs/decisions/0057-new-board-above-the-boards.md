# 0057 — „Neues Board …“ above the boards

**Status:** accepted · **Date:** 2026-11-15 · **Decider:** Sebastian Grundhöfer

## Context

ADR-0056 put „Neues Board …“ after the last board of the boards view. With several boards, or one tall board, the button is only reached by scrolling to the end of the list, and a short last board leaves it alone under a large empty area. The owner, trying v1.4.1: „ich bin aber mit der position der neuen + neues board taste nicht zufrieden. die sollte nicht ganz unten sein“.

## Decision

- „Neues Board …“ stands in a head row above the boards (`boards__head`), outside their scrolling list, so it stays in sight however far the list is scrolled. The row has a board's side padding and the hairline that divides the boards under it.
- Button, command, dialog and the empty state stay as ADR-0056 has them.

No setting, no shortcut, no dependency, no new IPC command, no new string.

## Consequences

- Amends ADR-0056's „after the last board“.
- The list each board measures its height against (`100cqh`) is the view less the head row.

**Owner approval:** 2026-11-15 — asked „Wohin soll der Knopf stattdessen?“, chose „Oben, fest (Empfohlen)“: „Eine schmale Kopfzeile über allen Boards. Sie scrollt nicht weg, der Knopf ist also immer sichtbar.“

## Sources

ADR-0054 · ADR-0056
