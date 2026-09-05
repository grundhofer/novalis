---
title: Atlas Overview
created: 2026-05-02T09:14:00+00:00
modified: 2026-08-04T17:22:00+00:00
status: active
project: Atlas
rating: 4
---

# Atlas Overview

Atlas is a weekend map for slow travel. It renders a plain vector basemap, lets you drop
annotated stops, and works with the network switched off — the whole point is the train ride
where the signal drops for forty minutes at a time.

The scope is deliberately small. No routing engine of our own, no accounts, no sync server.
A trip is a single file you can hand to someone else — [[File Over App]] applied to maps. If a feature can't survive being
described in one sentence, it doesn't go in this release.

Three pieces carry most of the risk: the tile pipeline (see [[Atlas Rendering Spec]]), the
offline bundle format ([[Atlas Offline Bundles]]), and the annotation model
([[Atlas Stop Annotations]]). Everything decided so far lives in [[Atlas Decisions Log]];
what happens next is in [[Atlas Next Steps]].

Atlas and [[Harbor Overview]] share a build script and a release habit, so changes to one
tend to leak into the other. That's fine — it's also how the packaging work got done twice
as fast.

## Open work

- [ ] Draft the tile cache eviction policy @project(Atlas) @epic(Rendering) @due(2026-08-12) @status(backlog)
- [ ] Write the first-run map tour @project(Atlas) @epic(Onboarding) @start(2026-08-10) @due(2026-08-19) @status(in-progress)
- [x] Choose a basemap style and freeze it @project(Atlas) @epic(Rendering)

#atlas #project
