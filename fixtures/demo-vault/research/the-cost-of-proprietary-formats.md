---
title: The Cost of Proprietary Formats
created: 2026-06-25T14:50:00+00:00
modified: 2026-07-21T09:38:00+00:00
---

# The Cost of Proprietary Formats

The bill for a closed format arrives late, which is why it is so easy to sign up for. Year
one it is invisible. Year five you notice the export is lossy. Year eight the company is
acquired and the desktop client stops being updated. Year ten you have a folder of files
that only one dead binary could read.

The costs are worth separating, because they are paid by different people:

- **Switching cost** — you can leave, but the tables, backlinks and embeds do not come with you.
- **Archival cost** — the file survives, the reader does not.
- **Automation cost** — no `grep`, no scripts, no small tools. Every workflow must be a
  feature request.
- **Trust cost** — you write less freely in a place you might not control tomorrow.

Note that "we use SQLite" is not automatically closed and "it's JSON" is not automatically
open. What matters is whether the *schema* is documented and stable enough for someone else
to write a reader. That is the real content of [[Data Ownership]], and the reason
[[Plain Text Durability]] keeps winning arguments it should have lost on features.

The same question decides whether the container in [[Atlas Offline Bundles]] gets a public
spec or stays a private detail.

#markdown #architecture #local-first #idea
