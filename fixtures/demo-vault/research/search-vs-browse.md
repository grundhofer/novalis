---
title: Search vs Browse
created: 2026-07-06T10:40:00+00:00
modified: 2026-07-27T15:50:00+00:00
---

# Search vs Browse

Search assumes you know what you are looking for. Browsing assumes you would recognise it.
Most knowledge tools optimise the first and quietly break the second, then wonder why nobody
finds anything.

The failure is asymmetric. If I remember the phrase "tombstone growth", full-text search wins
instantly and no folder structure could compete. But the more common situation is "there was
something about deletion costs, months ago, while reading about merges" — a memory of
*context*, not of words. That query is answered by a backlink rail, a graph neighbourhood, or
a folder I opened by habit.

So a vault needs both, and they need to be fast enough to be reflexive. Fuzzy search over
titles for jumping, full-text for recall, and links for wandering, per
[[Linking vs Foldering]].

One design consequence: because the index is derived from files, it can be thrown away and
rebuilt at any time. That keeps [[File Over App]] intact and means a corrupt index is an
inconvenience rather than a data-loss event — the same bet that keeps stop notes in
[[Atlas Stop Annotations]] plain.

#pkm #architecture #idea
