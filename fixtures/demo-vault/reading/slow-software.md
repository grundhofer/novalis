---
title: Slow Software
created: 2026-04-06T13:25:00+00:00
modified: 2026-05-19T17:12:00+00:00
rating: 4
status: finished
author: Dagny Fournier
year: 2023
---

# Slow Software

A short, opinionated book about why modern applications feel worse than the ones they
replaced despite running on far better hardware. Fournier's thesis is that responsiveness is
a *budget*, not an optimisation: once you spend it on network round-trips, no amount of
animation buys the feeling back.

## Takeaways

- Perceived speed is dominated by the worst common interaction, not the average one. Users
  remember the pause before the first keystroke registers.
- Anything above roughly a tenth of a second breaks the illusion of direct manipulation, and
  the fix is architectural, not cosmetic.
- Loading spinners are an admission, not a solution — she is merciless about this.
- Local data is the cheapest performance work available and is usually skipped for reasons
  that have nothing to do with users.

## What I'd apply

I'm stealing her latency budget table wholesale for the editor work: a written target per
interaction, measured on the slowest machine I own rather than the fastest. It pairs with
[[Article: What Latency Costs Attention]] and gives the local-data claim in
[[Local-First Software]] an actual number to argue with.

- [ ] Write the latency budget table @start(2026-08-11) @due(2026-08-20) @project(Atlas) @epic(Performance) @status(review)

#reading #book #summary #idea
