# Security Policy

novalis is a local-first desktop app. It holds a user's entire note corpus as
plain files on their own disk. It has no account, no server, and no telemetry;
in v1 it makes no outbound network connection at all
([docs/PRIVACY.md](docs/PRIVACY.md)). Vulnerability reports are taken seriously
anyway: a note vault is exactly the kind of thing people cannot afford to lose.

## Supported versions

Only the latest published release is supported. There are no maintenance
branches — fixes land on `main` and ship in the next release.

| Version | Supported |
| --- | --- |
| Latest [release](../../releases) | Yes |
| Anything older | No — upgrade first |
| The `legacy` branch (the previous app, ≤ v0.2.1-rc2) | No, and it receives no fixes |

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub's private vulnerability reporting:
**[Report a vulnerability](../../security/advisories/new)** (Security → Advisories
→ Report a vulnerability). It creates a private thread visible only to you and
the maintainer.

If that form is unavailable to you, email <sebastiangrundhoefer@gmail.com> with
`novalis security` in the subject. There is no PGP key.

Useful in a report: the version, your macOS version, what an attacker gains, and
the smallest reproduction you have — a vault fixture, a crafted note or a
crafted `board.json` is worth more than a description.

## What to expect

novalis is maintained by one person, part-time. The windows below are what that
realistically supports, not a corporate SLA:

- **Acknowledgement within 7 days.** If you have heard nothing after 7 days,
  assume the report was missed and email the address above.
- **An assessment — confirmed, disputed, or "known, see below" — within 14
  days.**
- **A fix ships in the next release.** No fixed patch deadline is promised; the
  advisory thread stays open until it does, and you will be told the target.

Disclosure is coordinated: a GHSA is published alongside the release that fixes
the issue, crediting you unless you ask otherwise. If a report is still unfixed
90 days after acknowledgement, publish it — that is a failure on the
maintainer's side, not yours.

## Scope

In scope: anything in this repository, and the installers published on the
Releases page.

Out of scope, because they are the documented design rather than defects:

- Anything requiring an attacker who already has code execution or filesystem
  access as your user account. novalis stores plain files under your own uid; it
  is not a defence against a compromised account.
- The known limitations below.
- Reports about the absence of a feature.

## Known limitations

These are the current state of the code, listed so nobody has to discover them
the hard way.

### Releases are unsigned and un-notarized

For the 2026 release year the app ships without a Developer ID signature
([docs/decisions/0010-unsigned-releases-2026.md](docs/decisions/0010-unsigned-releases-2026.md)).
macOS therefore cannot verify the publisher, and the release notes tell users to
bypass Gatekeeper by hand. Anyone who can tamper with the download can tamper
with the app. Build-provenance attestations are published for every asset; check
them if that matters to you.

### A vault is trusted input

novalis reads whatever Markdown, `board.json` and `cards/*.json` files the vault
contains. Path traversal, symlink escapes and malformed frontmatter are guarded
against and tested, but the vault is treated as the user's own data, not as
hostile input. Opening a vault someone else prepared is equivalent to opening
their files.
