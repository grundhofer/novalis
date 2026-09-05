---
title: Harbor Docs Plan
created: 2026-06-09T15:10:00+00:00
modified: 2026-08-01T09:02:00+00:00
status: active
project: Harbor
---

# Harbor Docs Plan

Harbor's documentation is built with Harbor. If the docs are painful to write, that is a bug
report about the tool, and it gets filed as one.

Four pages, in the order a newcomer needs them:

1. **Quickstart** — install, run `harbor build` in a folder with two Markdown files, see a
   site. Under three minutes, no config, no explanation of concepts.
2. **Commands** — one section per command, generated from the same help strings the binary
   prints, so they can't drift ([[Harbor Command Design]]).
3. **Writing a plugin** — the ten-line shell script version first, the streaming protocol
   second ([[Harbor Plugin API]]).
4. **Why it works this way** — a readable summary of [[Harbor Decisions Log]], because
   contributors who understand the boundaries stop proposing to cross them.

What we are not writing: a tutorial series, a comparison table, or a page of screenshots. The
quickstart is the marketing. Pages get rewritten in place when they come up again, per
[[Evergreen Notes]], instead of growing a second page that says the same thing.

- [ ] Write the quickstart section @project(Harbor) @epic(Docs) @start(2026-08-10) @due(2026-08-18) @status(todo)
- [ ] Generate the commands page from `--help` output @project(Harbor) @epic(Docs) @due(2026-08-25) @status(review)

#harbor #project
