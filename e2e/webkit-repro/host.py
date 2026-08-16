#!/usr/bin/env python3
"""A WebKitGTK window showing one local file. Nothing else.

This exists so the accessibility defect can be reproduced without Tauri, without
an editor framework, and without a browser's own UI in the tree. Any WebKit
developer can run it:

    python3 host.py table.html

Requires `gir1.2-webkit2-4.1` and `python3-gi` (Debian/Ubuntu) — the same
WebKitGTK the application under investigation renders in.
"""

import sys

import gi

gi.require_version("Gtk", "3.0")
# 4.1 on 24.04+, 4.0 on 22.04 — the point of the matrix is to compare WebKitGTK
# versions, so the host must not pin one.
for _api in ("4.1", "4.0"):
    try:
        gi.require_version("WebKit2", _api)
        break
    except ValueError:
        continue
from gi.repository import Gtk, WebKit2  # noqa: E402

print(f"WebKitGTK {WebKit2.get_major_version()}.{WebKit2.get_minor_version()}.{WebKit2.get_micro_version()}", flush=True)

if len(sys.argv) < 2:
    sys.exit("usage: host.py <file.html>")

window = Gtk.Window(title="webkit-repro")
window.set_default_size(900, 700)
window.connect("destroy", Gtk.main_quit)

view = WebKit2.WebView()
view.load_uri("file://" + sys.argv[1])
window.add(view)
window.show_all()

Gtk.main()
