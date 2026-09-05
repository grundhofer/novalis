---
title: Design system sync
created: 2026-08-06T09:30:00+00:00
modified: 2026-08-06T10:45:00+00:00
status: closed
---

# Design system sync

**Attendees:** Priya Raman, Ana Rivera, Mira Colton

Short and decisive. We have been carrying two colour systems in parallel — semantic tokens in the newer surfaces, raw hex in everything older — and the hybrid was costing more than either approach would alone. Priya's framing settled it: a system that tolerates quiet exceptions is not a system, it's a suggestion.

Decision: one semantic layer. Exceptions require a written argument in the pull request, not a shrug in a chat thread. Mira counted six remaining hard-coded values in the Atlas surfaces ([[Atlas Overview]]) and volunteered the audit for the rest.

We also agreed dark mode stops being a separate review pass and becomes a merge requirement — it goes on the list in [[Harbor Release Checklist]] too.

Same-day notes: [[2026-08-06]].

## Actions

- [ ] Migrate the six hard-coded colours in Atlas to tokens @project(Atlas) @due(2026-08-13) @status(backlog)
- [ ] Audit remaining raw hex across all surfaces @project(Atlas) @due(2026-08-18) @status(in-progress)
- [ ] Add the dark-mode check to the merge checklist @project(Harbor) @due(2026-08-11) @status(todo)

#meeting
