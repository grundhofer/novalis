---
title: Data Ownership
created: 2026-06-27T10:15:00+00:00
modified: 2026-07-23T16:02:00+00:00
---

# Data Ownership

Ownership is not a feeling, it is a set of capabilities. You own your data to the degree that
you can *read* it without permission, *copy* it without an API quota, *modify* it with tools
the vendor never blessed, and *leave* without asking.

Terms of service rarely dispute this in words; they dispute it in friction. An export button
that produces a ZIP of HTML with mangled links is technically compliant and practically a
wall. Rate-limited APIs are a wall. "Contact support to request your archive" is a wall with
a doorbell.

Encryption complicates the picture in a good way. End-to-end encrypted sync means the server
holds your bytes but cannot read them — custody without access. That is a reasonable trade
if, and only if, the keys stay on your devices and the plaintext lands on your disk, which
is where [[Local-First Software]] and [[Sync Strategies Compared]] meet.

The cheapest ownership test remains the oldest: can you back the whole thing up with `cp -r`?

The honest version of that test is a ledger of what each tool would cost to leave, which is
the experiment in [[Notes on: Walden]].

#local-first #architecture #pkm
