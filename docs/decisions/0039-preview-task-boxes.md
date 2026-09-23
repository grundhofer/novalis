# 39. Task boxes are clickable in the preview

Date: 2026-09-23

## Status

Accepted. Amends ADR-0020 (the read-only preview): one kind of click in the
preview writes. No string, no IPC command, no setting, no CSS beyond a
comment.

## Context

The task box is the one click that writes into a note (PLAN.md §4.3), but
in the `Cmd+E` preview the renderer draws it `disabled`, so reading a task
list and ticking an item meant leaving the preview. The owner answered the
feature-gap question on 2026-09-20 (`docs/DECISIONS.md`, "Answered
2026-09-20"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

which says yes, with its own ADR, to `reading-checkbox-toggle-in-preview`
(row A15 of `docs/research/2026-09-20-feature-gaps.md`).

## Decision

- The preview enables the task box of every list item it renders; a click
  flips `[ ]` ⇄ `[x]` on the item's first source line — the list item's
  `data-pos` span, the editor's task rule — through the buffer's
  `setText`, as `Cmd+B` in the preview does (ADR-0020, amended
  2026-09-16). The box's own toggle is prevented; the re-render shows the
  new text, and autosave writes it.
- A read-only note (binary verdict, not UTF-8) is not written; its boxes do
  nothing.
- `Cmd+Enter` in the preview still switches to the editor. Nothing else in
  the preview becomes editable.

## Consequences

- `docs/KEYMAP.md`'s task-box row names the preview; ADR-0020 is amended.
- `previewEdit.test.ts` covers the source rule, `Preview.test.tsx` the
  click, the enabled boxes and the read-only case.
