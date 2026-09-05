---
title: CRDTs in Practice
created: 2026-06-09T15:40:00+00:00
modified: 2026-07-28T08:55:00+00:00
status: seedling
rating: 4
---

# CRDTs in Practice

A conflict-free replicated data type is a structure whose merge function is commutative,
associative and idempotent, which is a formal way of saying that it does not matter in what
order the updates arrive or how many times you replay them. Everyone converges. That
property is what makes [[Local-First Software]] more than a nice slogan.

The catch is that convergence is not the same as correctness. A text CRDT will happily merge
two edits into a sentence no human wrote — grammatically mangled, but identical on both
machines. Convergence guarantees agreement, not meaning, which is why
[[Conflict Resolution Patterns]] still matters at the product level.

Practical costs worth writing down: tombstones accumulate, so deletion is never quite free;
document history grows faster than document content; and loading a long-lived file means
replaying a log unless you snapshot. For a note-taking tool the pragmatic middle ground is
CRDTs for live co-editing sessions and plain files at rest, which keeps
[[Plain Text Durability]] and [[File Over App]] intact.

- [ ] Re-read the CRDT paper and summarise the merge rules in my own words @due(2026-08-20) @status(in-progress) @project(Atlas)
- [ ] Benchmark tombstone growth on a 5k-edit document @start(2026-08-18) @due(2026-08-25) @project(Atlas) @epic(Sync) @status(todo)

#local-first #sync #architecture #reading
