---
title: Harbor Next Steps
created: 2026-07-20T08:25:00+00:00
modified: 2026-08-06T19:40:00+00:00
status: active
project: Harbor
---

# Harbor Next Steps

0.4 is the release where Harbor becomes recommendable to someone who hasn't met me. That means
two things must be true: the quickstart works on a machine I've never touched, and
`harbor check` is trustworthy enough to run in CI.

The quickstart is written but untested by a stranger; the clean-container smoke test in
[[Harbor Release Checklist]] is what turns that from hope into evidence. `harbor check` needs
its exit code fixed — right now it reports broken links beautifully and then exits zero, which
is worse than not checking at all.

After 0.4, the streaming plugin protocol ([[Harbor Plugin API]]) is the piece that decides
whether other people build on this. It's also the piece most likely to be over-designed, so
it ships with exactly two example plugins and no speculative hooks.

Deliberately parked: themes, a plugin registry, and anything resembling a web dashboard.

- [ ] Fix the `harbor check` exit code @project(Harbor) @epic(Release) @start(2026-08-08) @due(2026-08-12) @status(backlog)
- [ ] Have a stranger run the quickstart and watch silently @project(Harbor) @epic(Onboarding) @due(2026-08-19) @status(in-progress)

Context: [[Harbor Overview]], [[Harbor Decisions Log]], the four hours booked as
[[Harbor ship window]], and the parallel planning in [[Atlas Next Steps]].

#harbor #project #performance
