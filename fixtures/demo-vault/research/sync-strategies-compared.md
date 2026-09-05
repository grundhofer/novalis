---
title: Sync Strategies Compared
created: 2026-06-11T10:20:00+00:00
modified: 2026-07-25T17:31:00+00:00
---

# Sync Strategies Compared

Four families, roughly in order of how much they ask of you.

**File sync** (a folder that replicates itself) is the cheapest to adopt and the most
honest about failure: you get both copies and a filename ending in "conflicted copy".
**Version control** gives real history and explicit merges, at the cost of asking a writer
to think like an engineer. **Operation logs** ship intents rather than files and rebuild
state on each device; they merge well and debug badly. **Full CRDT replication**, discussed
in [[CRDTs in Practice]], merges automatically but pays in metadata.

The decision is less about correctness than about who absorbs the ambiguity. File sync hands
it to the user, version control hands it to a ritual, CRDTs hide it in the algorithm. A
notes app used daily on three devices probably wants CRDT-ish behaviour for the current
document and file sync for everything else.

Whatever you pick, the interface promises made in [[Offline-First UX]] have to hold while
the sync layer is confused, and the on-disk result must stay readable per
[[Markdown as a Format]]. Nothing here is scheduled for [[Atlas Overview]] this release; it
is the drawer the deferred sync work goes into.

#sync #architecture #local-first
