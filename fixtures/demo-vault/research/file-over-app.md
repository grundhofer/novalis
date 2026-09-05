---
title: File Over App
created: 2026-06-13T09:00:00+00:00
modified: 2026-07-24T15:26:00+00:00
status: evergreen
rating: 4
---

# File Over App

The principle in one line: the app is temporary, the files are not. Choose tools that leave
behind artefacts which outlive them.

It is a surprisingly sharp test. Does the tool store your work in a folder you can open in
any file browser? Can you rename a file without the app noticing? If you delete the application
tomorrow, is anything lost besides convenience? Most software fails this quietly — it will
export, but export is a one-way ceremony, and anything that requires ceremony does not get
done.

The corollary is that features should be expressed *in* the files where possible. A tag is
`#pkm` in the text, not a row in a hidden index. A link is `[[Evergreen Notes]]`, not a
foreign key. Indexes are then caches: derivable, disposable, rebuildable — which is exactly
the property that makes [[Search vs Browse]] cheap to implement well.

This is the practical face of the argument in [[Local-First Software]], resting on
[[Plain Text Durability]] and paid for by accepting the ambiguity of
[[Markdown as a Format]]. It is also the whole premise of [[Harbor Overview]]: a directory
in, a site out, nothing kept anywhere else.

#local-first #pkm #markdown #evergreen
