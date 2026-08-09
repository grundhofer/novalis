# 0001 — Licensing: AGPL-3.0-only, with a plugin exception and an app store exception

**Status:** accepted · **Date:** 2026-08-09 · **Decider:** Sebastian Grundhoefer (sole copyright holder)

Novalis moves from MIT to **AGPL-3.0-only**, plus two additional permissions under
AGPL section 7: one for plugins, one for app stores. This file records why, and
what was rejected on the way, so the reasoning survives longer than the memory of it.

## The goal, as it actually settled

The starting brief was "nobody may make a product out of Novalis — no sale, no
SaaS — unless they agree terms with me." Over the course of the analysis that
softened to "a bit of restriction," alongside four requirements that never moved:

1. the source stays public,
2. people may modify it for their own needs,
3. freelancers and employees may use it as a note tool during paid work,
4. the copyright holder can grant commercial terms by individual agreement.

Those four are what the decision optimises for. The absolute no-sale rule is the
one that was traded away, deliberately — see [What was rejected](#what-was-rejected).

## What was decided

**AGPL-3.0-only.** Not `-or-later`: the SPDX id records that no future-version
option is granted, so a later FSF license cannot change the terms of code already
shipped.

**The plugin exception** (LICENSE, section 7 permission #1). A plugin that talks
to Novalis only through the documented Plugin API may be proprietary, may be sold,
and need not ship source. Without it, in-process plugins loaded into the same Web
Worker as Novalis's own bootstrap would arguably be derivative works, and the
plugin ecosystem built in 2026-07/08 would have been strangled at birth.

**The app store exception** (LICENSE, section 7 permission #2, plus a covenant).
Waives AGPL section 10 for distribution through an app store, so Novalis — and any
fork — can be listed.

## Why AGPL and not something stricter

Four candidates were examined against the four requirements, each read in its
primary text rather than summarised from commentary.

| | use at work | blocks sale | blocks SaaS | OSI | verdict |
| --- | --- | --- | --- | --- | --- |
| PolyForm Noncommercial 1.0.0 | **no** | partly | yes | no | rejected |
| PolyForm Perimeter 1.0.1 | yes | yes | yes | no | runner-up |
| n8n Sustainable Use License 1.0 | yes | yes | yes | no | runner-up |
| **AGPL-3.0-only** | yes | **no** | **no** | **yes** | **chosen** |

**PolyForm Noncommercial fails requirement 3.** "Noncommercial purposes" plausibly
forbids a freelancer using the app for paid client work — and would forbid the
author using his own app professionally. A separate defect: its Distribution
License is carved out of the purpose limitation and carries no purpose limit of
its own. PolyForm's own issue #87 has asked about that since 2022 and has never
been answered; the 2.0.0 draft collapses the two grants precisely to close it.

**SUL and Perimeter both meet all four requirements** and were genuinely close.
They were rejected on cost, not fit:

- **They are not OSI-approved**, so "open source" in the README becomes a false
  claim. The OSI calls marketing such licenses as open source "deception."
- **Distribution channels close.** Debian and Ubuntu main, Fedora, F-Droid and
  Homebrew *core formulae* all require a DFSG/OSD-compatible license. nixpkgs has
  already classified `SUL-1.0` as `free = false; redistributable = false`.
  (Homebrew *casks*, Flathub, Snap, winget, Chocolatey and the AUR stay open — for
  a desktop app that is most of the reach, which is why this was close.)
- **The compliance burden stays manual.** See the next section — this turned out
  to be the deciding argument.

**MIT, the status quo,** maximises adoption and was never in contention once "a
bit of restriction" was the goal.

**BSL 1.1 and FSL were ruled out early.** Their Change Date is per released
version, so they are a *delayed opening*, not a permanent restriction — the
opposite of what was asked for.

## The argument that actually decided it

Novalis statically links **LibXDiff** (`libgit2/deps/xdiff/`, 14 files,
LGPL-2.1-or-later, Davide Libenzi). It is compiled unconditionally on every
platform by `libgit2-sys` `build.rs:163-164`, it is **not** covered by libgit2's
linking exception — Libenzi is not a libgit2 author — and libgit2's own `COPYING`
never mentions it, attributing its LGPL text only to `deps/winhttp/`.

Under any non-copyleft outbound license, LGPL-2.1 section 6 applies to a static
link and demands a relinking kit or a written offer for one.

Under AGPL that obligation **disappears rather than being satisfied**. Because the
code is LGPL-2.1-*or later*, it can be taken as LGPL-3.0, which incorporates
GPL-3.0; AGPL section 13 then expressly permits combining with GPL-3.0 works. The
xdiff portion is simply no longer governed by LGPL-2.1, so section 6's machinery
never engages.

The rest of the stack clears too: libgit2's linking exception (which is also the
only thing that made the *MIT* binary lawful, since OpenSSL is Apache-2.0 and
GPL-2-incompatible), MPL-2.0 section 1.12 naming AGPL-3.0 as a Secondary License,
EDL-1.0 being BSD-3-equivalent, and the Inter font being aggregated data rather
than linked code.

## What this costs, stated plainly

**AGPL does not block selling Novalis, and does not block SaaS.** Section 4
expressly permits charging any price; section 13 bites only on a *modified*
version offering *remote network interaction*, which a local-first desktop app
does not do. Peer-to-peer sync between a user's own devices does not trigger it
either — no third party interacts with anyone's instance. Anyone may sell a
Novalis fork, provided they ship source under AGPL.

That is a real loss against the original brief. It was accepted because AGPL is a
strong practical deterrent (Google bans AGPL code outright in its own products),
because the alternative cost the four requirements above, and because the license
was never going to be the moat anyway — see the next section.

**The Mac App Store gap is a non-issue in this category.** No desktop PKM app in
the comparison set has a Mac App Store build; Obsidian is proprietary, has no
licensing obstacle, and still is not there. iOS and Google Play are routine:
Signal, Element X, Standard Notes, Bitwarden, Logseq and Threema (a *paid* AGPL
app) are all live today under AGPL-3.0.

## The moat is not the license

Telegram is the instructive case. Its clients are GPL — maximally forkable — and
its protection is a closed server plus a trademark request in the README ("do not
use the name Telegram… do not use our standard logo"). Tailscale, Signal and
Bitwarden all follow the same shape: the moat is a server, a network, or a brand.

Novalis has **no server by design**; git and P2P sync run on the user's own
infrastructure. That lever is absent, which leaves the **name**. Registering
"Novalis" as a trademark (EUIPO ~EUR 900 for two classes, DPMA EUR 290 for up to
three, ten years) is the open follow-up, and probably buys more practical
protection than any license clause would. Note that Brainlab markets radiosurgery
products under the name "Novalis" — a clearance search at tmview.tmdn.org is a
prerequisite, and has not been done.

## Consequences

- **Prospective only.** Tags `v0.1.0` and `v0.2.0` were published under MIT and
  that grant is irrevocable. Those releases stay MIT and may be forked on MIT
  terms, forever. At the time of the change the repo had 0 forks.
- **Contributions need an inbound grant.** Without one, the first third-party PR
  would cost the ability to grant commercial exceptions. `CONTRIBUTING.md` now
  carries that grant; it must not be removed.
- **Never patch the vendored libgit2 C sources.** The linking exception's own
  carve-back preserves plain GPL-2.0-only over modifications, which would make the
  patch GPL-2.0-only and break AGPL compatibility.
- **Source must ship from the same place as the binaries.** GPL-2.0 section 3 has
  no equivalent of AGPL section 6(d)'s "a different server is fine", so a source
  archive is attached to the same GitHub Release. See `RELEASING.md`.
- **A store build must resolve LibXDiff separately.** The app store exception
  cannot reach third-party code. Either satisfy LGPL-2.1 section 6 or build
  without git sync.

## Sources

Primary texts were read rather than summarised. The load-bearing ones:
AGPL-3.0 sections 4, 6, 7, 10, 13 · GPL-2.0 sections 1, 3, 6 · LGPL-2.1 sections 3, 6 ·
MPL-2.0 sections 1.12, 3.3 · OFL-1.1 conditions 2, 4, 5 · the libgit2 linking
exception in `libgit2-sys-0.18.5+1.9.4/libgit2/COPYING` · Apple's Developer Program
License Agreement Schedule 1 sections 3.2/3.3 and Exhibit B · Google Play's
Developer Distribution Agreement section 5.3 · Microsoft's App Developer Agreement
v8.11 sections 4(b)/4(c) and Exhibit G · Nextcloud's `COPYING.iOS` ·
GitHub's Innovation Graph license dataset.
