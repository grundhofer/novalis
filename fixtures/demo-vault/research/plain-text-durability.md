---
title: Plain Text Durability
created: 2026-06-04T11:30:00+00:00
modified: 2026-07-29T10:05:00+00:00
status: evergreen
rating: 5
---

# Plain Text Durability

The strongest argument for plain text is boring: it is the only format that has never
required a migration. A UTF-8 file written today opens in every editor on every operating
system, including ones not yet written, because the cost of supporting it is approximately
zero and the incentive to drop it never arrives.

Durability comes from having no dependencies. A proprietary binary needs its reader, the
reader needs its runtime, the runtime needs a vendor, and the vendor needs a business
model — four links, any of which can break inside a decade. See
[[The Cost of Proprietary Formats]] for what that looks like in practice.

Plain text also degrades gracefully. Strip the tooling from a Markdown vault and you still
have readable prose with visible structure; strip the tooling from a database-backed app and
you have a `.sqlite` blob and a weekend of reverse engineering.

The concession is that plain text carries no guarantees about *structure*. That is what
frontmatter and conventions are for, discussed in [[Markdown as a Format]] and made
practical by [[File Over App]]. The cost side of the same ledger is being worked out in
[[Notes on: Walden]].

#markdown #local-first #evergreen
