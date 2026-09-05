# Contributing

novalis is a one-person project. A bug report with steps to reproduce is worth
more than a patch, and a patch that arrives without an issue first is a gamble
with your own evening.

Before a large change, open an issue and describe it.

Security problems go through [SECURITY.md](SECURITY.md), never a public issue or
pull request.

## What this repository is

A Tauri v2 desktop app for organizing, writing and editing Markdown, with a
small Kanban board whose data lives outside the notes, plus a headless CLI for
AI agents. One Rust core, a thin shell, one web UI.

```
crates/novalis-core/       UI-free Rust core: vault, atomic saves, cache, search, links, boards
crates/novalis-cli/        the `novalis` binary: the same core, headless, --json
apps/desktop/src-tauri/    Tauri v2 shell: the IPC surface, the native menu, the watcher
apps/desktop/ui/           React 19 + CodeMirror 6
packages/tokens/           the design tokens the UI is allowed to use
i18n/                      en.json and de.json — the only place user-visible strings live
docs/                      the plan, the decisions, the settings and keymap contracts
```

Read [CLAUDE.md](CLAUDE.md) before touching anything: it lists the only commands
you should run and the files that are generated rather than written.

## The rules that get a pull request rejected

1. **A new setting, feature, menu item, shortcut, dependency or outbound network
   call needs a decision record first.** `docs/decisions/` holds them, and each
   one carries the owner's own words approving it. This project is deliberately
   small; "it was only a few lines" is why the last one stopped being small.
2. **User-visible strings live in `i18n/en.json` and `i18n/de.json`**, never in
   a component. The lint enforces it.
3. **Colours, fonts and radii come from the tokens**, never as literals.
4. **`just check` must be green**, and it must be green because the tests pass,
   not because they were skipped.

## Working on it

```sh
just setup     # tool versions, dependencies
just dev       # the app, with the Vite dev server
just check     # everything CI runs
just test-cli  # the CLI golden tests
```

## Licensing of contributions

novalis is AGPL-3.0-only. Contributions are accepted under a sign-off plus the
relicensing grant below, for the reasons the grant itself explains.

### The grant

> By signing off a contribution you grant Sebastian Grundhoefer a perpetual,
> worldwide, non-exclusive, royalty-free, irrevocable license — sublicensable,
> and transferable together with the project — to reproduce, modify, prepare
> derivative works of, publicly display, publicly perform and distribute your
> contribution and derivative works of it, **under any license terms, including
> proprietary terms**. You further grant him and every recipient of the software
> a perpetual, worldwide, non-exclusive, royalty-free, irrevocable patent license
> to make, have made, use, offer to sell, sell, import and otherwise transfer
> your contribution, limited to the patent claims licensable by you that are
> necessarily infringed by the contribution alone or by its combination with
> Novalis. You represent that you are legally entitled to grant this: the
> contribution is your own work, or you have permission from whoever owns it —
> your employer, usually.

Three things it does **not** do, because they are what people worry about:

- **You keep your copyright.** The grant is non-exclusive. Your contribution
  stays yours to relicense, reuse, or publish anywhere else you like.
- **It takes nothing away from the public.** Your contribution ships under
  AGPL-3.0-only with the rest of Novalis. The grant lets the maintainer license
  it *additionally* on other terms; it cannot retract the AGPL copy anyone
  already has.
- **It is not a transfer of ownership** and not an assignment.

### Why this exists

Novalis is AGPL-3.0-only and the maintainer sells commercial exceptions to it
([COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)). Selling an exception means
licensing the code on terms other than the AGPL, which only the copyright holder
can do. Merge one outside patch without a relicensing grant and that stops being
possible for every file it touched — permanently, and with no fix short of
tracking the contributor down or reimplementing the change. The grant is what
keeps that door open; it is not paperwork for its own sake.

**Why not a CLA.** A signed contributor licence agreement would do the same job
and is the usual instrument for it, but it puts a form, an identity check and a
countersignature in front of a two-line typo fix — for a one-person project that
mostly buys friction. A DCO sign-off plus a published grant is enforceable
against the same problem, costs a `-s` flag, and leaves the record in the commit
where an auditor can find it. If a contribution ever arrives that is large enough
to be worth a real signature, the maintainer will ask for one then.

**If you are not willing to give the grant,** say so in the PR rather than
signing off anyway. It cannot be merged as-is, but the idea can still be
discussed, and a bug report costs you nothing.

### Developer Certificate of Origin 1.1

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```
```

## Further reading

- [LICENSE](LICENSE) — AGPL-3.0-only, plus the section 7 permissions
- [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md) — terms the AGPL does not give
- [docs/decisions/0001-licensing.md](docs/decisions/0001-licensing.md) — why
