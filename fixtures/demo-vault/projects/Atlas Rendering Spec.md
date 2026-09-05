---
title: Atlas Rendering Spec
created: 2026-05-09T11:02:00+00:00
modified: 2026-07-30T08:41:00+00:00
status: draft
project: Atlas
---

# Atlas Rendering Spec

The renderer draws vector tiles at three zoom bands and nothing in between. Bands were chosen
by what a traveller actually looks at: the country shape, the city, and the street you're
standing on. Interpolating a fourth band cost more memory than it bought in legibility, so it
was cut — the reasoning is recorded in [[Atlas Decisions Log]].

**Tile lifecycle.** A tile is fetched, decoded into geometry buffers, kept in an LRU cache,
and dropped when the cache exceeds its budget. The budget is a byte count, not a tile count,
because a dense city tile can be forty times the size of an ocean tile. Eviction currently
runs on every insert; batching it into an idle callback is on the list.

**Label placement.** Labels are laid out once per band and cached with the tile. Collisions
are resolved by priority: place names beat road names, road names beat points of interest.
Nothing shivers when you pan, which was the whole complaint about the first prototype.

The per-interaction budget the bands are measured against is borrowed wholesale from
[[Slow Software]]: a written target, checked on the slowest device we own.

Offline behaviour is defined separately in [[Atlas Offline Bundles]] — the renderer must not
know whether a tile came from the network or from a bundle on disk.

- [ ] Batch cache eviction into an idle callback @project(Atlas) @epic(Performance) @due(2026-08-21) @status(todo)
- [x] Freeze the label collision priority order @project(Atlas) @epic(Rendering)

#atlas #spec #performance
