---
title: Harbor release review
created: 2026-08-05T14:00:00+00:00
modified: 2026-08-05T16:20:00+00:00
status: closed
---

# Harbor release review

**Attendees:** Tomas Feld, Lena Marsh, Owen Dacre

Ninety minutes, most of it on the migration. Harbor ([[Harbor Overview]]) is otherwise ready — the feature work has been frozen for a fortnight and the test suite has been green for longer than that. The open question was never "does it work" but "what happens when it doesn't".

Lena had actually run the rollback rather than reviewing the document describing it, and found two steps in the wrong order. Fixed in the room. Owen argued for a Friday freeze; the counter-argument — that nobody should be babysitting a migration over a weekend — won, and we moved to Monday.

Agreed: no release note ships without a named rollback owner, and it goes into
[[Harbor Release Checklist]] rather than into anyone's memory.

Same-day notes: [[2026-08-05]].

## Actions

- [ ] Rehearse the rollback on a clean external volume @project(Harbor) @due(2026-08-07) @status(todo)
- [ ] Move the freeze to Monday and tell the wider team @project(Harbor) @due(2026-08-06) @status(in-progress)
- [ ] Add the rollback-owner field to the release template @project(Harbor) @due(2026-08-12) @status(todo)

#meeting #review
