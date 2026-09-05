---
title: "Article: What Latency Costs Attention"
created: 2026-04-11T08:35:00+00:00
modified: 2026-04-11T09:20:00+00:00
rating: 5
status: finished
source: Northwind Labs Review, issue 12
---

# Article: What Latency Costs Attention

A six-page write-up of an experiment where participants did the same structured writing task
under artificially injected delays of 40ms, 250ms, and 900ms per keystroke-to-render. The
interesting result isn't that the slow condition was slower — it's *how* people compensated.
At 900ms they stopped editing mid-sentence and started composing whole paragraphs elsewhere
before pasting them in, which the authors call "tool avoidance in place".

## Takeaways

- Users don't complain about latency; they route around it, and the routing looks like normal
  behaviour to anyone watching usage metrics.
- The 250ms condition produced the worst self-reported frustration — fast enough to keep
  trying, slow enough to keep failing.
- Recovery from an interruption cost more than the interruption itself, by roughly a factor
  of four in their task.

## What I'd apply

The tool-avoidance finding is a warning about our own analytics: if people paste large blocks
instead of typing, that's a symptom, not a preference. Worth instrumenting. Direct evidence
for the budget argument in [[Slow Software]] and for the interruption rules in
[[Offline-First UX]].

#reading #article #summary #idea
