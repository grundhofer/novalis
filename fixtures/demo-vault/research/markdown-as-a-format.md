---
title: Markdown as a Format
created: 2026-06-06T16:22:00+00:00
modified: 2026-07-27T12:44:00+00:00
---

# Markdown as a Format

Markdown succeeded for an unromantic reason: it looks like what people were already typing
in email. Asterisks around emphasis and hyphens for lists were conventions before they were
syntax, so the format had a user base before it had a spec.

That origin is also its weakness. There is no single Markdown — there is CommonMark, plus a
dozen dialects that added tables, footnotes, callouts and wikilinks in mutually incompatible
ways. Round-tripping a document through two tools can silently rewrite it: a
`*` bullet becomes `-`, hard line breaks vanish, a nested list re-indents.

For a vault this argues for restraint. Pick one dialect, write files the same way every
time, and treat the serializer as a correctness-critical component rather than a formatting
detail. If your editor cannot reopen its own output byte-identically, the durability promise
of [[Plain Text Durability]] is thinner than it looks.

Frontmatter is the pragmatic escape hatch: typed properties in YAML at the top, prose below,
and wikilinks in the body to carry the structure discussed in
[[Linking vs Foldering]]. [[Harbor Overview]] takes the restrained line on purpose: one
dialect, one serializer, and a checker that refuses to guess.

#markdown #architecture #local-first
