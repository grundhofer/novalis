---
title: Atlas Stop Annotations
created: 2026-06-03T10:45:00+00:00
modified: 2026-07-22T12:18:00+00:00
status: draft
project: Atlas
---

# Atlas Stop Annotations

A stop is a coordinate, a title, and a body of Markdown. That's the entire data model, and
resisting additions to it has been most of the design work.

People wanted categories, ratings, opening hours, photos, and a "visited" flag. Each of those
is a schema migration and a settings screen. Instead the body is plain text, so a stop can
say `closed Mondays` or `#worth-the-detour` and the search index picks it up without the app
knowing what those words mean. That is the cheap half of [[Search vs Browse]], bought for
nothing. The one concession is a colour, because colour is the only
thing you can read at a glance while walking.

**Editing.** Stops are edited in place on the map, in a small panel, not a modal. Losing your
map position to write two sentences is the kind of paper cut that makes people stop using a
tool. The panel reuses the editor component from [[Harbor Overview]]'s docs preview, which is
the second time that borrowing has paid off.

Rendering of stop markers is the renderer's problem, not this note's — see
[[Atlas Rendering Spec]].

- [ ] Ship the inline stop editor panel @project(Atlas) @epic(Onboarding) @start(2026-08-11) @due(2026-08-17) @status(todo)
- [x] Cut categories from the stop model @project(Atlas) @epic(Onboarding)

#atlas #spec
