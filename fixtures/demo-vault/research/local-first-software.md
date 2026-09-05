---
title: Local-First Software
created: 2026-06-02T09:14:00+00:00
modified: 2026-07-30T11:02:00+00:00
status: evergreen
rating: 5
---

# Local-First Software

Local-first is the claim that the copy of your work living on your own disk should be the
authoritative one, and that the network is an accelerant rather than a prerequisite. Cloud
apps inverted that: the server holds the truth and your laptop rents a view of it. When the
company pivots, the view goes dark and the work goes with it.

The useful part of the idea is that it is testable. Unplug the machine and see what still
functions. Open the files with a text editor from twenty years ago and see what survives.
Hand the folder to a colleague and see whether they need an account.

None of this is anti-collaboration. [[CRDTs in Practice]] exist precisely so that two people
editing the same paragraph on two continents end up with the same document, and
[[Sync Strategies Compared]] walks through the tradeoffs of getting bytes between them. But
collaboration is a feature layered on top of ownership, not a reason to surrender it.

The cultural half of the argument is [[File Over App]]; the legal and practical half is
[[Data Ownership]]. The unplug test is what [[Atlas Overview]] is built around, which is why
a trip there is a file you can hand over rather than a link you have to share.

- [ ] Draft a one-page "unplug test" checklist for evaluating tools @due(2026-08-21) @project(Atlas) @status(in-progress)

#local-first #architecture #evergreen
