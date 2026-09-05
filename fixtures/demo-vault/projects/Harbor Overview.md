---
title: Harbor Overview
created: 2026-04-19T13:05:00+00:00
modified: 2026-08-03T10:55:00+00:00
status: active
project: Harbor
rating: 5
---

# Harbor Overview

Harbor is a small command-line tool that turns a directory of Markdown into a static site,
and then gets out of the way. One binary, no configuration required, sensible output on the
first run.

The design brief is narrow: `harbor build` should work in a folder the tool has never seen,
and every flag should be something you could have guessed. Anything that needs a config file
to be usable has failed the brief. One dialect of Markdown, chosen and written down, for the
reasons in [[Markdown as a Format]]. The command surface is worked out in
[[Harbor Command Design]]; the extension story is in [[Harbor Plugin API]].

Harbor is open source and expects contributors, which changes the maths on documentation —
docs are a feature, not an afterthought. The plan for them lives in [[Harbor Docs Plan]], and
the shipping checklist is [[Harbor Release Checklist]].

Shared history with [[Atlas Overview]]: same release script, same habit of writing decisions
down before they're forgotten ([[Harbor Decisions Log]]).

## Open work

- [x] Pick a licence for the CLI @project(Harbor) @epic(Release)
- [ ] Cut the cold-start time below 200 ms @project(Harbor) @epic(Performance) @due(2026-08-24) @status(todo)
- [ ] Tag the 0.4 release candidate @project(Harbor) @epic(Release) @start(2026-08-12) @due(2026-08-14) @status(todo)

#harbor #project
