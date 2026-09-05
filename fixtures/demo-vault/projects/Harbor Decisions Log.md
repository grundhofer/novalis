---
title: Harbor Decisions Log
created: 2026-04-21T08:15:00+00:00
modified: 2026-08-02T11:25:00+00:00
status: living
project: Harbor
---

# Harbor Decisions Log

Newest first. Entries are short on purpose; the reasoning lives in the linked spec.

**2026-07-28 — Plugins are processes, not modules.** A subprocess boundary costs milliseconds
and buys us freedom from a stable ABI forever. Batching covers the performance case. See
[[Harbor Plugin API]].

**2026-07-14 — Permissive licence.** The tool is meant to be embedded in other people's build
pipelines; a copyleft licence would quietly disqualify it from exactly those uses.

**2026-06-22 — `harbor watch` merged into `harbor serve`.** Two commands that differed by one
flag confused every early user we watched. Detail in [[Harbor Command Design]].

**2026-06-02 — Zero configuration is a hard requirement, not a goal.** A build that needs a
config file to produce output is a bug. The plugin config file is the single, argued-for
exception.

**2026-05-06 — Share release tooling with [[Atlas Overview]].** Recorded on both sides so
nobody "cleans it up" later without reading this.

- [x] Record the plugin-boundary decision before 0.4 @project(Harbor) @epic(Docs)

#harbor #decision #project
