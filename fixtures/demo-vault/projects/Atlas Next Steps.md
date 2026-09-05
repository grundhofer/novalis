---
title: Atlas Next Steps
created: 2026-07-18T07:50:00+00:00
modified: 2026-08-06T18:12:00+00:00
status: active
project: Atlas
---

# Atlas Next Steps

The goal for August is a build that a stranger can install, download one city, and use on a
train without asking anyone a question. Everything below is measured against that sentence.

The blocking piece is memory behaviour under sustained panning. Eviction works but runs at
the worst possible moment, and on the old test device you can feel it. That fix, plus the
region-size estimate, gets us to "installable". The first-run tour is polish and can slip a
week without hurting the demo.

After that the interesting question is whether the offline bundle format should be readable
by anything other than Atlas. Making it a documented format costs a weekend and might make
the project worth other people's time — the same bet [[Harbor Next Steps]] is making about
its plugin API, and the argument against staying closed is in
[[The Cost of Proprietary Formats]].

Not doing this month: routing, sharing, any sync. Those live in the drawer with the other
good ideas.

- [ ] Profile pan performance on the old test device @project(Atlas) @epic(Performance) @start(2026-08-08) @due(2026-08-13) @status(todo)
- [ ] Decide whether the bundle format gets a public spec @project(Atlas) @epic(Docs) @due(2026-08-28) @status(in-progress)

See also [[Atlas Overview]], [[Atlas Decisions Log]], and the end-to-end run booked as
[[Atlas onboarding walkthrough]].

#atlas #project #performance
