---
title: Harbor Command Design
created: 2026-04-27T09:35:00+00:00
modified: 2026-07-31T14:47:00+00:00
status: draft
project: Harbor
---

# Harbor Command Design

Four commands, and a rule that a fifth needs an argument for why the fourth couldn't grow.

`harbor build` reads the current directory and writes `_site`. `harbor serve` does the same
plus a watcher and a local server. `harbor new` scaffolds a post with today's date in the
frontmatter. `harbor check` validates links and frontmatter without writing anything, which
is what continuous integration should run.

**Flags.** Every flag has a long form; short forms exist only for the three you'd type daily
(`-o`, `-p`, `-q`). No flag changes the meaning of another flag. Where a flag would have
needed a mode enum, it became a separate command instead.

**Errors.** An error names the file, the line, and what was expected — never just "parse
error". Broken wikilinks reported by `harbor check` print the source file and the target that
was missing, which is the single most useful thing the tool does — links are the structure
([[Linking vs Foldering]]), so a broken one is an error, not a warning.

Output layout and the theme hook are where plugins attach; see [[Harbor Plugin API]]. The
rationale for keeping the surface this small is in [[Harbor Decisions Log]].

- [ ] Add file and line numbers to every parse error @project(Harbor) @epic(Onboarding) @due(2026-08-16) @status(in-progress)
- [x] Collapse `harbor watch` into `harbor serve` @project(Harbor) @epic(Docs)

#harbor #spec
