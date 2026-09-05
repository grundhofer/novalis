---
title: Conflict Resolution Patterns
created: 2026-06-18T13:05:00+00:00
modified: 2026-07-22T09:10:00+00:00
---

# Conflict Resolution Patterns

Every sync system has a conflict policy; most just refuse to say it out loud. Last-write-wins
is a policy. Silently keeping the larger file is a policy, and a bad one.

Four patterns worth naming:

1. **Automatic merge** — the algorithm decides, per [[CRDTs in Practice]]. Invisible when it
   works, unnerving when it produces a sentence nobody wrote.
2. **Both-copies** — write `note (conflict, laptop).md` beside the original. Ugly, ancient,
   and it has never once lost a paragraph.
3. **Three-way review** — show base, mine, theirs, let a human choose. Correct, expensive,
   and unusable on a phone at a bus stop.
4. **Field-level rules** — merge structured properties automatically, escalate prose. Works
   because a `status:` field has a defensible winner and a paragraph does not.

The rule I keep coming back to: never resolve a conflict by deleting data the user can no
longer reach. Losing an edit is survivable; losing it *quietly* destroys trust in the whole
tool, which is the real subject of [[Local-First Software]] and [[Data Ownership]]. The habit of
making failure visible early rather than rarely comes from [[The Quiet Machine]].

#sync #architecture #idea
