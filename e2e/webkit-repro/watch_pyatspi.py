#!/usr/bin/env python3
"""Does the page leave the AT-SPI tree because of what it contains, or because
of how we are reading it?

WebKit's `AccessibilityAtspi` distinguishes a registered CLIENT from something
that merely walks `GetChildren`. `addClient()` is reached from
`Registry.GetRegisteredEvents`, `EventListenerRegistered` and `Cache.GetItems`,
and WebKit tears down web-content accessibles when it believes no client is
present. Our Node reader calls none of those — so every measurement taken with
it may say more about the reader than about the page.

This runs the same walk twice, differing in exactly one thing:

    listener=off   walk the tree, register nothing        (what xa11y does)
    listener=on    register an event listener FIRST, then walk

pyatspi is the library Orca uses, so `listener=on` is the closest thing to
"a real screen reader is attached" that can be scripted.

    python3 watch_pyatspi.py <page.html> {on|off}

If the tree holds with the listener and collapses without it, the collapse is an
artefact of the reader and there is no page-content bug to report.
"""

import subprocess
import sys
import time
from pathlib import Path

import gi

gi.require_version("Atspi", "2.0")
import pyatspi  # noqa: E402

HERE = Path(__file__).parent
SAMPLES = 12
EVERY_S = 1.5

if len(sys.argv) < 3:
    sys.exit("usage: watch_pyatspi.py <page.html> {on|off}")
page = str(Path(sys.argv[1]).resolve())
listener = sys.argv[2] == "on"

host = subprocess.Popen([sys.executable, str(HERE / "host.py"), page])
time.sleep(3)


def count(node, depth=0):
    """Total accessible nodes under `node`. Depth-capped: a defunct object can
    raise, and a cycle would hang the sampler."""
    if depth > 25:
        return 0
    total = 1
    try:
        for i in range(node.childCount):
            child = node.getChildAtIndex(i)
            if child is not None:
                total += count(child, depth + 1)
    except Exception:
        pass
    return total


def find_app():
    desktop = pyatspi.Registry.getDesktop(0)
    for i in range(desktop.childCount):
        app = desktop.getChildAtIndex(i)
        try:
            if app is not None and app.get_process_id() == host.pid:
                return app
        except Exception:
            continue
    return None


events = []
if listener:
    # THIS is the whole experiment. Registering a listener is what makes WebKit
    # call addClient(); the callback itself is irrelevant.
    pyatspi.Registry.registerEventListener(
        lambda e: events.append(e.type), "object:children-changed", "object:state-changed"
    )

try:
    app = None
    for _ in range(20):
        app = find_app()
        if app is not None:
            break
        time.sleep(1)
    if app is None:
        print("RESULT: application never appeared in the AT-SPI desktop")
        sys.exit(2)

    series = []
    for _ in range(SAMPLES):
        series.append(count(app))
        time.sleep(EVERY_S)

    peak, last = max(series), series[-1]
    print(f"\n  page:     {Path(page).name}")
    print(f"  listener: {'on' if listener else 'off'}")
    print(f"  nodes:    {series}")
    print(f"  peak {peak} -> final {last}   (events seen: {len(events)})")
    if last < peak / 2:
        print("  RESULT: collapsed")
        sys.exit(3)
    print("  RESULT: held")
finally:
    host.terminate()
