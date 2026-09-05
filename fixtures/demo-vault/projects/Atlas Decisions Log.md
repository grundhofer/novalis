---
title: Atlas Decisions Log
created: 2026-05-04T08:00:00+00:00
modified: 2026-08-05T09:30:00+00:00
status: living
project: Atlas
---

# Atlas Decisions Log

One entry per decision, newest first. A decision goes here once it has cost something to
reverse.

**2026-07-30 — Three zoom bands, not four.** A fourth band improved legibility slightly and
raised peak memory by roughly a third on the oldest test device. Legibility won't sell the
app; running on an old phone on a train might. Detail in [[Atlas Rendering Spec]].

**2026-07-11 — No delta updates for offline bundles.** Deltas need a manifest, a version
history, and a merge path, all for data that changes a few times a year. Rebuilding is one
button and no new failure modes. See [[Atlas Offline Bundles]].

**2026-06-14 — Stops stay plain text.** Structured fields were dropped in favour of Markdown
plus one colour. Reasoning in [[Atlas Stop Annotations]].

**2026-05-28 — No routing engine.** Atlas shows where things are; it does not tell you how to
walk there. This is the boundary that keeps the project finishable, and it will be the first
thing someone asks us to break.

**2026-05-06 — Same release tooling as [[Harbor Overview]].** One script, two projects. The
maintenance tax is real but smaller than two half-maintained scripts.

- [x] Write down the zoom band decision before anyone forgets it @project(Atlas) @epic(Rendering)

#atlas #decision #project
