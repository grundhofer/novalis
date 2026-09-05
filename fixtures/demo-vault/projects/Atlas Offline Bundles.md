---
title: Atlas Offline Bundles
created: 2026-05-21T14:30:00+00:00
modified: 2026-07-26T19:05:00+00:00
status: draft
project: Atlas
---

# Atlas Offline Bundles

A bundle is one file containing every tile a trip needs, plus the stops and notes attached to
them. You pick a region on the map, the app estimates the download, and you either accept it
or shrink the box. Nothing about that flow should require an account. The stops and notes inside travel as
Markdown, so a bundle stays readable without Atlas at all, which is the whole point of
[[Plain Text Durability]].

The container is a flat archive with a small index at the end: offsets, zoom band, tile key.
Reading a tile is a seek and a read, which is fast enough that the renderer described in
[[Atlas Rendering Spec]] doesn't need a separate warm-up pass.

**Size discipline.** A mid-sized city at all three bands lands around 40 MB. A whole country
at the top band is under 8 MB. Anything that would push a typical trip past 250 MB gets a
warning rather than a silent hour-long download.

**Staleness.** Bundles carry the date they were built and nothing else. There is no partial
update: if the data is a year old and you care, you rebuild the bundle. Attempting deltas was
considered and rejected — see [[Atlas Decisions Log]].

- [ ] Add a size estimate to the region picker @project(Atlas) @epic(Onboarding) @due(2026-08-14) @status(todo)
- [ ] Benchmark bundle reads on a cold filesystem @project(Atlas) @epic(Performance) @status(review)

#atlas #spec
