---
title: Atlas Field Test Notes
created: 2026-07-05T16:20:00+00:00
modified: 2026-07-29T21:04:00+00:00
status: active
project: Atlas
rating: 3
---

# Atlas Field Test Notes

Two days of carrying the build around instead of reading about it. Rough notes, kept rough on
purpose.

**Day one, city centre.** Panning at the street band stutters roughly every fifteen seconds —
almost certainly the eviction pass described in [[Atlas Rendering Spec]]. Nobody would call it
broken, but you notice it, and noticing is the problem.

**Battery.** Ninety minutes of continuous map use cost about eleven percent. Acceptable.
Screen-on time dominates; the renderer is not the villain here.

**The thing I got wrong.** I assumed people would download a bundle before leaving. Ana Rivera,
who tried it cold, opened the app on the platform with two minutes to spare and no idea a
download was needed. The region picker has to be reachable from the first screen, and the size
estimate has to be there before the download starts — that's now a task in
[[Atlas Offline Bundles]]. The general form of the mistake is in [[Offline-First UX]]: never
assume the user prepared.

**Small delight.** Writing a stop note in the panel and having it searchable immediately felt
better than expected. Keeping the model plain was right ([[Atlas Stop Annotations]]).

- [ ] Move the region picker onto the first screen @project(Atlas) @epic(Onboarding) @due(2026-08-15) @status(todo)

#atlas #performance #project
