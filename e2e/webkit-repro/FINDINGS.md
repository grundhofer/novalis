# Reduced test case — result: it does not reproduce the app's behaviour

**Do not file the upstream report on the strength of this directory.** The
reduction was built to isolate `<th>` as the trigger, and the first run
falsified that framing rather than confirming it.

## What was measured

ubuntu-24.04, WebKitGTK 2.52.3, Xvfb + dbus + at-spi2, no window manager,
observed with xa11y 0.13.0 sampling every 1.5 s:

| page | header cells | series | result |
| --- | --- | --- | --- |
| `notable.html` | `<td>` | 16 → [5, 5, 5, …] | collapsed |
| `table.html` | `<th>` | 16 → [5, 5, 5, …] | collapsed |

**Both pages collapse, identically.** The control was supposed to hold.

ubuntu-22.04 produced no measurement at all — the job died in the Node client
before reporting. Not diagnosed.

## Why this invalidates the reduction rather than confirming the bug

In the real application a table-FREE note holds its tree at 104 nodes with the
editor still named and addressable, run after run; only the table note
collapses. Here, a table-free page collapses just as fast as the table one. So
this bare `WebKitWebView` host is not behaving like the application, and a
difference measured in it says nothing about the application's defect.

Something about this host makes the page leave the tree regardless of content.
Until that is understood, the `<th>` question cannot even be asked here.

## The most likely cause, and why it matters beyond this file

`AccessibilityAtspi` distinguishes a *client* from something merely reading the
tree. `addClient()` is reached from `Registry.GetRegisteredEvents`,
`EventListenerRegistered` and `Cache.GetItems` — none of which xa11y calls; it
holds a zbus connection and walks `GetChildren`. WebKit also arms a cache-clear
timer that unregisters web objects when a client *leaves*.

If that is what is happening, then the observation tool has been shaping the
observation all along, and the same doubt reaches back into the application
measurements: the collapse there might be WebKit tearing down web-content
objects for a reader it does not consider a client, with the table merely
changing the timing. That would be a different bug — or no bug — and it is not
distinguishable from the data collected so far.

## What a valid reduction needs first

1. Establish why the bare host collapses with no table at all. Compare a client
   that registers properly (Accerciser, or Orca) against xa11y on the same
   page: if Accerciser holds the tree where xa11y does not, the defect is in
   how the tree is read, not in what the page contains.
2. Only then re-run `<th>` vs `<td>`, with a client whose presence WebKit
   acknowledges.
3. Diagnose the ubuntu-22.04 failure, since the version axis is what would turn
   a report into a regression.

Until 1 and 2 are answered, the honest description of the application finding is
narrower than what was written earlier: *opening a note containing a table
coincides with the page leaving the AT-SPI tree, measured with one client whose
registration semantics are not established.* That is worth keeping as probe 8's
non-gating diagnostic. It is not yet worth an upstream bug report.
