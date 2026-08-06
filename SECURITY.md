# Security Policy

Novalis is a local-first desktop app. It holds a user's entire note corpus and,
once the optional AI/sync features are switched on, their API keys and git
tokens. Vulnerability reports are taken seriously.

## Supported versions

Only the latest published release is supported. There are no maintenance
branches — fixes land on `main` and ship in the next release.

| Version | Supported |
| --- | --- |
| Latest [release](../../releases) | Yes |
| Anything older | No — upgrade first |

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub's private vulnerability reporting:
**[Report a vulnerability](../../security/advisories/new)** (Security → Advisories
→ Report a vulnerability). It creates a private thread visible only to you and
the maintainer.

If that form is unavailable to you, email <sebastiangrundhoefer@gmail.com> with
`novalis security` in the subject. There is no PGP key.

Useful in a report: the version, your OS, what an attacker gains, and the
smallest reproduction you have — a vault fixture, a crafted note, or a config
file is worth more than a description.

## What to expect

Novalis is maintained by one person, part-time. The windows below are what that
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
  access as your user account. Novalis stores plain files under your own uid; it
  is not a defence against a compromised account.
- The known limitations below.
- Reports about unsigned installers, missing hardening flags on a build you
  produced yourself, or the absence of a feature.

## Known limitations

These are real, they are the current state of the code, and they are listed here
so nobody has to discover them the hard way.

### Android stores AI/git secrets in plaintext

Desktop builds keep every secret — AI provider keys, calendar OAuth tokens, git
tokens, the P2P vault key — in the OS keychain via the `keyring` crate (macOS
Keychain, Windows Credential Manager, Linux Secret Service).

The `keyring` crate has no Android backend. The Android build therefore writes
those secrets as a plain JSON file inside the app-private data directory
(`apps/desktop/src-tauri/src/secrets.rs`). App-private storage is sandboxed from
other apps, but it is *not* a secret store: it is readable on a rooted device and
through any enabled backup path. This is a deliberate alpha tradeoff, recorded in
[MOBILE.md](MOBILE.md); an Android Keystore backend is the planned fix. Android
is not a published release today — if you build it yourself, treat any key you
put in it as recoverable from the device.

### An enabled plugin is trusted code

A plugin is arbitrary JavaScript that you place in your vault. It runs in a Web
Worker — no DOM, no direct filesystem, no network — and reaches the app only
through the `novalis` host API, where every call is capability-checked.

What that does **not** buy you: capabilities are coarse. There is no per-folder
or per-note scope, so a plugin allowed to write notes can write any note, and one
allowed to read them can read all of them. The sandbox constrains the *kind* of
access, not its reach.

In practice: **enabling a plugin gives it your vault.** Read its source before
enabling it, exactly as you would a shell script someone sent you. See
[PLUGINS.md](PLUGINS.md).

### A vault is trusted input

Novalis assumes the vault belongs to you. Preferences, calendar subscriptions and
other app state live inside the vault and are read on open, so a vault you
obtained from someone else — a shared cloud folder, a cloned git remote, an
imported archive — is a way to influence app behaviour, not just a pile of
Markdown. Point Novalis at a copy first if you do not control the source.

Related: HTML export reproduces raw HTML embedded in a note's body. An export of
notes you did not write yourself should be reviewed before it is published or
opened in a browser.

### Vault contents are not encrypted at rest

Notes are plain `.md` files on disk — that is the product, not an oversight.
Anyone with your disk has your notes. Use full-disk encryption. The P2P sync
transport *is* end-to-end encrypted; the files it syncs are not encrypted once
they land.

### Releases are unsigned

macOS and Windows installers are not code-signed, so both OSes warn on first
launch (see
[RELEASING.md](RELEASING.md#unsigned-build-warnings-what-users-see)). The
practical consequence: you cannot distinguish an official installer from a
tampered one by the OS warning alone. Download only from the
[Releases](../../releases) page of this repository.

### AI "CLI provider" connections launch a local program

The Claude Code / Codex CLI provider kinds run a binary on your machine, at the
path configured for that connection. That path is machine-local — it is not
stored in the vault and does not sync — but it is code execution by design.
Only point it at a binary you installed.
