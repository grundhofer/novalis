# `licenses/` — the texts a binary recipient is legally owed

**Do not delete this directory, and do not drop it from `bundle.resources` in
`apps/desktop/src-tauri/tauri.conf.json`.** It is not documentation. Several of
the licences below oblige us to put *the licence text itself* — not a link, not a
summary — into the hands of everyone who receives a Novalis installer. Before
this directory existed, `THIRD-PARTY-NOTICES.md` sat in the repository and
shipped nowhere, which put every one of those obligations in breach on every
release.

The specific clauses being satisfied:

| Clause | Requires |
| --- | --- |
| OFL-1.1 condition 2 | each copy of the font "contain[s] the above copyright notice and this license" |
| Apache-2.0 §4(a)–(b) | recipients get the licence, and modified-file notices are retained |
| LGPL-2.1 §6 | "You must supply a copy of this License" with the combined work |
| GPL-2.0 §1 | the licence text accompanies the distributed binary |
| EDL-1.0 / BSD-3-Clause | binary-form redistribution reproduces the copyright notice and conditions |
| MPL-2.0 §3.2 | recipients are informed of the licence covering the covered files |

`THIRD-PARTY-NOTICES.md` (also bundled) explains *which component pulls in which
of these*, and how each fact was derived. This directory holds only the raw
texts.

## Where each file came from

Every file here was copied from a source already on disk — the vendored crate
source or the installed npm package — rather than fetched from the web or
retyped, so the text a user receives is provably the text the build compiled
against.

| File | Copied from | Covers |
| --- | --- | --- |
| `libgit2-COPYING.txt` | `libgit2-sys-0.18.5+1.9.4/libgit2/COPYING`, byte-identical | libgit2 itself (GPL-2.0 **with linking exception**) plus its vendored zlib, PCRE, SHA1DC, wildmatch, ntlmclient, llhttp and winhttp notices |
| `LGPL-2.1.txt` | lines 462–963 of that same `COPYING`, unedited | LibXDiff (`libgit2/deps/xdiff/`), LGPL-2.1-or-later — **not** covered by libgit2's linking exception; also `deps/winhttp/` on Windows |
| `EDL-1.0.txt` | the file header of `libgit2/deps/xdiff/xhistogram.c`, comment markers stripped | `xhistogram.c`, Eclipse Distribution License v1.0. libgit2's `COPYING` never mentions this file, so its header is the only on-disk source of the text |
| `Apache-2.0.txt` | `openssl-src-300.6.1+3.6.3/openssl/LICENSE.txt`, byte-identical | OpenSSL 3.6.3, statically linked via `git2`'s `vendored-openssl` |
| `MPL-2.0.txt` | `cssparser-0.36.0/LICENSE`, byte-identical | all six MPL-2.0 crates: `attohttpc`, `cssparser`, `cssparser-macros`, `dtoa-short`, `option-ext`, `selectors`. One copy serves all six — the text is the same and none of them carries an Exhibit B "Incompatible With Secondary Licenses" notice |
| `OFL-1.1-Inter.txt` | `@fontsource-variable/inter@5.3.0/LICENSE`, byte-identical | the Inter variable font; the file opens with the Inter copyright line and contains the full OFL-1.1 |
| `MIT-KaTeX.txt` | `katex@0.18.4/LICENSE`, byte-identical | KaTeX and the ~60 KaTeX font files in the frontend bundle |

## When to touch this

On any dependency bump that changes which of the above ships, or their versions:
re-copy from the new on-disk source and update the version numbers in this table
and in `THIRD-PARTY-NOTICES.md`. Adding a dependency whose licence obliges text
delivery means adding a file here — a `cargo deny` pass does **not** catch that,
because cargo-deny reads crate manifests and cannot see vendored C source.
