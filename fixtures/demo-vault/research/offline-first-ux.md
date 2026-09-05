---
title: Offline-First UX
created: 2026-06-20T08:45:00+00:00
modified: 2026-07-26T14:12:00+00:00
---

# Offline-First UX

Offline-first is mostly an interface problem. The storage layer is solved; the hard part is
telling a person what is true right now without making them anxious.

Three rules I have not been able to argue myself out of:

**Never block on the network.** A spinner over the editor because a sync handshake is slow
is a broken promise. Writing is the product; sync is bookkeeping.

**Show state, not status.** "Saved locally, 3 changes waiting" is information. "Syncing…"
forever is theatre. If a device has been offline for a week, say so plainly in the sidebar.

**Make failure boring.** When the connection dies mid-save, the correct experience is
nothing happening at all, followed later by a quiet reconciliation as described in
[[Sync Strategies Compared]].

Airline mode is the acceptance test. Write a note on a plane, edit the same note on a phone
in a basement, then land and open both — that single flow exercises
[[Conflict Resolution Patterns]], [[Plain Text Durability]] and the whole premise of
[[Local-First Software]] at once. It is also the exact journey [[Atlas Offline Bundles]] has
to survive.

- [ ] Storyboard the "offline for a week" sidebar state @due(2026-08-19) @project(Atlas) @epic(Onboarding) @status(todo)

#local-first #sync #idea
