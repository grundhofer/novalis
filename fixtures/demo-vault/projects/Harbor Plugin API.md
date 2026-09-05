---
title: Harbor Plugin API
created: 2026-05-15T11:40:00+00:00
modified: 2026-07-28T16:09:00+00:00
status: draft
project: Harbor
---

# Harbor Plugin API

A plugin is an executable that reads a document on standard input and writes one back. No
plugin loader, no language runtime, no ABI to keep stable across releases. If you can write a
shell script, you can extend Harbor.

The document is JSON: frontmatter, body, and a path. A plugin may change any of the three.
The file on disk stays the source of truth throughout — [[File Over App]] enforced by the
architecture rather than promised in the README.
Harbor runs plugins in the order they appear in the config file — the one place a config file
is allowed, because by definition you've already left the zero-config path described in
[[Harbor Overview]].

**Cost.** Every plugin is a process spawn per document. On a thousand-post site that is
noticeable, which is why the pipeline batches documents into a single invocation when a
plugin declares it can handle a stream. Most can. This is the main reason the performance work
in [[Harbor Next Steps]] matters.

**What plugins cannot do.** They cannot add commands, register routes, or reach the file
system through Harbor. They transform documents. Enlarging that boundary is how small tools
turn into frameworks; the decision is recorded in [[Harbor Decisions Log]].

- [ ] Specify the streaming plugin protocol @project(Harbor) @epic(Performance) @due(2026-08-20) @status(todo)
- [ ] Ship two example plugins with the docs @project(Harbor) @epic(Docs) @start(2026-08-17) @status(review)

#harbor #spec #performance
