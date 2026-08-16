# Result: there is no WebKitGTK bug here. The collapse is xa11y's.

**Do not file anything upstream to WebKit.** The reduced test case was built to
confirm that a `<th>` table empties the AT-SPI accessibility tree. It did the
opposite, twice over, and the second run identified the cause.

## The measurement

One CI job, ubuntu-24.04, WebKitGTK 2.52.3, Xvfb + dbus + at-spi2, no window
manager. Same host, same page, back to back, sampling every 1.5 s:

| reader | page | series | result |
| --- | --- | --- | --- |
| xa11y 0.13.0 (Node) | `notable.html` (`<td>`) | 16 → [5, 5, 5, …] | collapsed |
| xa11y 0.13.0 (Node) | `table.html` (`<th>`) | 16 → [5, 5, 5, …] | collapsed |
| pyatspi, no listener | `table.html` (`<th>`) | [18, 18, 18, … 18] | **held** |
| pyatspi, listener registered | `table.html` (`<th>`) | [18, 18, 18, … 18] | **held** |

pyatspi is the client library Orca uses. It holds the tree for the full
eighteen seconds on the page that xa11y says vanishes.

## What that means, in order of how wrong the earlier claims were

1. **The page does not leave the accessibility tree.** WebKitGTK exposes it and
   keeps exposing it. There is no page-content defect and nothing to report to
   WebKit.
2. **`<th>` is not the trigger.** Both pages behave identically under xa11y, and
   neither misbehaves under pyatspi.
3. **It is not about client registration either.** That was the leading
   hypothesis after the first reduction — WebKit's `AccessibilityAtspi` only
   counts a client via `Registry.GetRegisteredEvents`, `EventListenerRegistered`
   or `Cache.GetItems`. But pyatspi held the tree with the listener explicitly
   **off**, so merely not registering is not sufficient to cause this. Something
   else in xa11y's AT-SPI backend is.
4. **The screen-reader impact claimed earlier does not exist.** Orca uses
   pyatspi. pyatspi is fine here.

## What this retracts

Everything in `../README.md` that attributed a defect to WebKitGTK, and every
statement in this repository's history that a Linux screen-reader user loses the
page when opening a note containing a table. Those were measured with one
instrument, and the instrument was the fault.

The application-level observation stands as a fact about the tooling: driving
Novalis with xa11y on Linux, the tree collapses shortly after a note with a
table is opened. That is a real obstacle to a Linux UI suite. It is not a bug in
Novalis and not a bug in WebKit.

## Where a report does belong

To **xa11y** (github.com/xa11y/xa11y), with this directory as the reproduction —
it is small, self-contained, and contains its own control in pyatspi. Their own
documentation currently attributes this symptom to WebKitGTK and works around it
by removing `<th>` from their Tauri fixture; this data suggests the cause is in
their AT-SPI backend instead. That is worth telling them, carefully and without
overclaiming: we have one environment, one version, and no diagnosis of the
mechanism.

## Reproducing

```sh
sudo apt-get install -y python3-gi gir1.2-webkit2-4.1 python3-pyatspi \
                        xvfb dbus dbus-x11 at-spi2-core
# Xvfb :99, dbus-launch, at-spi-bus-launcher, at-spi2-registryd — see
# .github/workflows/webkit-atspi-repro.yml

node   e2e/webkit-repro/watch.mjs         e2e/webkit-repro/table.html
python3 e2e/webkit-repro/watch_pyatspi.py e2e/webkit-repro/table.html off
```

## Still unexplained, and worth saying so

- ubuntu-22.04 produced no measurement in either run; the Node client died
  before reporting. Undiagnosed.
- Why xa11y's walk causes the teardown is not established. "It is not listener
  registration" is a negative result, not a mechanism.
