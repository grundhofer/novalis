---
title: Harbor Performance Budget
created: 2026-07-08T10:12:00+00:00
modified: 2026-07-27T13:55:00+00:00
status: active
project: Harbor
rating: 4
---

# Harbor Performance Budget

Numbers, so that "it feels slow" turns into a yes or a no.

| Case | Budget | Now |
| --- | --- | --- |
| Cold start, no work | 200 ms | 310 ms |
| Build, 100 documents | 1 s | 0.7 s |
| Build, 1000 documents | 6 s | 5.4 s |
| Rebuild after one edit | 150 ms | 120 ms |

Only cold start is over budget, and it's over for a boring reason: the theme directory is
walked eagerly whether or not a theme is present. Making that lazy is most of the fix.

The thousand-document number is measured without plugins. With three plugins it roughly
doubles, which is the spawn cost argued about in [[Harbor Plugin API]] and the reason the
streaming protocol exists. That measurement should be in the table too once the protocol is
specified.

Rebuild latency is the one users actually feel, since `harbor serve` is where they live. It
has budget to spare and should be defended, not spent.

- [ ] Make theme directory discovery lazy @project(Harbor) @epic(Performance) @due(2026-08-13) @status(in-progress)
- [x] Set up the benchmark corpus and check it in @project(Harbor) @epic(Performance)

Related: [[Harbor Next Steps]], [[Harbor Overview]], the same discipline applied in
[[Atlas Rendering Spec]], and the budget-not-optimisation framing lifted from
[[Slow Software]].

#harbor #performance #spec
