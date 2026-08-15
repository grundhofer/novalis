---
title: Plain
tags: [e2e]
---

# Plain

The same shape as Spike.md and deliberately without a table.

WebKitGTK's accessibility tree is documented to go into continuous
invalidation churn when a page contains `<th>` header cells — the page
"effectively vanishes from AT-SPI". Our tree collapses from ~104 nodes to 6 at
the exact moment Spike.md opens, and Spike.md has a header-row table.

Two notes that differ only in that one respect turn a correlation into a
finding: if this one holds its tree and the other collapses, the table is the
trigger. If both collapse, it is not.
