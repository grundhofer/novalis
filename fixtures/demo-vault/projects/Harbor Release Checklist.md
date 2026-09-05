---
title: Harbor Release Checklist
created: 2026-06-30T12:00:00+00:00
modified: 2026-08-05T20:31:00+00:00
status: active
project: Harbor
---

# Harbor Release Checklist

The same list every time, in the same order. Deviating from it is how the 0.2 tarball shipped
without the licence file.

1. `harbor check` on the docs directory, clean, no warnings ([[Harbor Docs Plan]]).
2. Full test run on the two oldest supported platforms, benchmarked against
   [[Harbor Performance Budget]].
3. Build the four binaries, verify each one prints the right version.
4. Regenerate the commands page so the docs match the binary ([[Harbor Command Design]]).
5. Write the release notes from the decisions added since the last tag
   ([[Harbor Decisions Log]]).
6. Tag, publish, then install from the published artefact in a clean container and run the
   quickstart end to end. If that fails, the release is withdrawn, not patched.

Step six has caught something in three of the last five releases, which is either an argument
for the checklist or an argument that something upstream is fragile. Probably both.

The same script drives [[Atlas Overview]]'s releases, so a change here needs a moment's thought
about the other side.

- [x] Automate the four-platform build step @project(Harbor) @epic(Release)
- [ ] Add a clean-container smoke test to CI @project(Harbor) @epic(Release) @due(2026-08-11) @status(backlog)

#harbor #project
