# Third-Party Notices

The installers on the Releases page are not only Novalis: they statically link a
substantial amount of third-party code, some of it under licenses whose terms
require the notice to travel with the binary. This file is that notice.

**Novalis is licensed per part, not as a single block.** Novalis's own source is
**AGPL-3.0-only**, together with an additional permission under AGPL section 7
for plugins; [LICENSE](LICENSE) is the authoritative text of both, and the only
place either is stated in full. The third-party portions listed below are *not*
AGPL: each keeps the license its own authors chose, and you keep every right that
license gives you *in that portion*, whatever Novalis's own code carries. Two of
those portions are copyleft — libgit2 under GPL-2.0 with a linking exception, and
LibXDiff under LGPL-2.1-or-later — and each is described individually below.

Why the combination is distributable, since AGPL-3.0 and GPL-2.0-**only** are
otherwise incompatible: libgit2's LINKING EXCEPTION gives "unlimited permission
to link the compiled version of this library into combinations with other
programs, and to distribute those combinations without any restriction coming
from the use of this file"
([`licenses/libgit2-COPYING.txt`](licenses/libgit2-COPYING.txt)), which is
precisely the restriction that would otherwise bite. LibXDiff is
LGPL-2.1-**or-later**, so it may be taken as LGPL-3.0, which AGPL-3.0
accommodates (LGPL-3.0 is GPL-3.0 plus additional permissions, and AGPL-3.0 §13
allows the combination). Everything else in the tree is permissive or MPL-2.0,
both one-way compatible with AGPL-3.0. None of this is checked by a tool:
`cargo deny` reads crate manifests and never sees the vendored C at all. The
per-component sections below are the record.

**Releases up to and including v0.2.0 were published under the MIT License**, and
that grant is irrevocable — those releases stay MIT. This file describes the
current tree. See README.md.

It is not a complete license-text appendix. It names every component with a
non-obvious obligation, gives the aggregate picture for the rest, and states
exactly how each fact was derived so you can re-derive it. The full texts that
have to be *delivered* rather than merely cited live in [`licenses/`](licenses/)
and ship inside every installer — see [Where the license texts
are](#where-the-license-texts-are).

**Last derived:** 2026-08-11, against `Cargo.lock` and `pnpm-lock.yaml` as of
Novalis 0.2.0. The Rust numbers below had drifted by 16 crates before this
re-derivation; see [How this file was derived](#how-this-file-was-derived-and-how-to-regenerate-it)
for the exact bucketing rule, which is now written down so the next re-derivation
is mechanical.

---

## Where the license texts are

Several components below are under licenses that oblige us to hand the recipient
the license *text*, not a link to it: OFL-1.1 condition 2 (Inter),
Apache-2.0 §4(a)–(b) (OpenSSL), GPL-2.0 §1 (libgit2), LGPL-2.1 §6 (LibXDiff and,
on Windows, winhttp), the EDL-1.0 / BSD-3-Clause binary-form notice clause
(`xhistogram.c`), MIT's "included in all copies" (KaTeX), and MPL-2.0 §3.2 (six
crates). Those texts are in [`licenses/`](licenses/) in the
repository, and `bundle.resources` in
`apps/desktop/src-tauri/tauri.conf.json` packages that directory — together with
this file and `LICENSE` — into every bundle target. After installing:

| Platform | Where to find them |
| --- | --- |
| macOS | `Novalis.app/Contents/Resources/licenses/` |
| Windows (`.msi`, `.exe`) | `licenses\` under the install directory, e.g. `C:\Program Files\Novalis\licenses\` |
| Linux (`.deb`, `.AppImage`) | `/usr/lib/Novalis/licenses/` (inside the mounted image, for the AppImage) |

`licenses/README.md` records which file was copied from which on-disk source.
Every one of them was copied from the vendored crate source or the installed npm
package that the build actually compiles against — not fetched from the web and
not retyped — so the text a user receives is provably the text the build used.

---

## Components that need explicit attention

### libgit2 — GPL-2.0 **with a linking exception**

This is the one entry a packager or a license reviewer will look for.

| | |
| --- | --- |
| **What** | libgit2 1.9.4, the C library behind Novalis's git sync |
| **How it ships** | **Statically linked into every Novalis binary.** The root `Cargo.toml` builds `git2` with the `vendored-libgit2` feature, so the C source is compiled in rather than linked against a system library. |
| **License** | **GPL-2.0 with a linking exception** |
| **Derived from** | `libgit2-sys-0.18.5+1.9.4/libgit2/COPYING` in the vendored crate source. The `libgit2-sys` crate's own `license` field says `MIT OR Apache-2.0` — that covers the Rust binding, **not** the vendored C library, which is why `cargo metadata` alone does not surface this. |

The exception reads, verbatim from that `COPYING`:

> **LINKING EXCEPTION**
>
> In addition to the permissions in the GNU General Public License, the authors
> give you unlimited permission to link the compiled version of this library
> into combinations with other programs, and to distribute those combinations
> without any restriction coming from the use of this file. (The General Public
> License restrictions do apply in other respects; for example, they cover
> modification of the file, and distribution when not linked into a combined
> executable.)

**What this means:** the exception is what lets Novalis's own code stay under
its own license instead of being pulled under the GPL by the link. It changes
nothing about libgit2 itself: **the libgit2 portion of the binary you received is
still GPL-2.0 code and you still have the GPL's rights in it** — to its source,
to modify it, and to redistribute it under the GPL. GPL-2.0 §1 requires the
license text to accompany the distributed binary; that is
[`licenses/libgit2-COPYING.txt`](licenses/libgit2-COPYING.txt), a byte-identical
copy of the `COPYING` from the exact vendored source this build compiles.
Copyright: the libgit2 contributors (see `AUTHORS` in the libgit2 source).

**The vendored libgit2 is unmodified**, and that is checked rather than assumed:
`diff -rq` between `libgit2-sys-0.18.5+1.9.4/libgit2/` and upstream
`v1.9.4.tar.gz` reports **zero content differences**. The only entries that
differ are absent directories — `ci/`, `docs/`, `examples/`, `fuzzers/`,
`tests/` — which the crate drops via its own `Cargo.toml` `exclude` list. So
GPL-2.0 §2(a)'s modified-file notice requirement does not bite, and the upstream
tarball *is* the corresponding source.

**Source offer (GPL-2.0 §3).** The complete corresponding source for the libgit2
portion is the upstream release tarball:
https://github.com/libgit2/libgit2/archive/refs/tags/v1.9.4.tar.gz — and, because
GPL-2.0 §3 requires source to be offered "from the same place" as the binary
rather than merely from some other server, a source archive is attached to the
same GitHub Release as the installers. See `RELEASING.md`.

Full license text as shipped: [`licenses/libgit2-COPYING.txt`](licenses/libgit2-COPYING.txt).
Upstream: https://github.com/libgit2/libgit2/blob/main/COPYING

### LibXDiff (`libgit2/deps/xdiff/`) — LGPL-2.1-or-later

> **Prominent notice, per LGPL-2.1 §6:** Novalis uses LibXDiff, a library covered
> by the GNU Lesser General Public License version 2.1, and its use is covered by
> that license. A copy of the LGPL is shipped with every Novalis binary as
> `licenses/LGPL-2.1.txt`.

This is **not** covered by libgit2's linking exception, and it is easy to miss
because libgit2's own `COPYING` never mentions it.

| | |
| --- | --- |
| **What** | LibXDiff — the diff engine libgit2 uses, vendored at `libgit2/deps/xdiff/` |
| **How it ships** | **Statically linked into every Novalis binary, on every platform.** `libgit2-sys` `build.rs` (lines 163–164) adds `libgit2/deps/xdiff` to the compile unconditionally — there is no feature flag and no platform guard. |
| **License** | **LGPL-2.1-or-later** |
| **Copyright** | "LibXDiff by Davide Libenzi ( File Differential Library ) — Copyright (C) 2003 Davide Libenzi" |
| **Derived from** | The file headers themselves: 14 of the 16 source files in `deps/xdiff/` carry that copyright plus "under the terms of the GNU Lesser General Public License … version 2.1 … or (at your option) any later version". The exceptions are `xhistogram.c` (EDL-1.0, next section) and the build glue. |

**Why the linking exception does not reach it.** libgit2's exception is granted
by "the authors" of libgit2. Davide Libenzi is not a libgit2 author; his code is
vendored into the tree, not written for it. libgit2's `COPYING` is consistent
with that reading — where it does attribute LGPL text to a bundled dependency, it
names `deps/winhttp/` explicitly (line 441) and never mentions `deps/xdiff/` at
all. So the xdiff portion is plain LGPL-2.1-or-later.

**What that means for you.** LGPL-2.1 §6 permits distributing a work that links
the library under terms of your choosing, provided the recipient can relink the
combined work against a modified LibXDiff and gets a copy of the LGPL. Novalis's
own code is unaffected. The LibXDiff portion stays LGPL-2.1-or-later and you keep
the LGPL's rights in it: the corresponding source is the `deps/xdiff/` directory
of the libgit2 tarball linked above, unmodified, and it is in the source archive
attached to each release. Since Novalis is AGPL-3.0-only it conveys the complete
source of the surrounding work as well, which satisfies §6(a) outright rather
than by the relinking route in §6(b)–(e).

License text: [`licenses/LGPL-2.1.txt`](licenses/LGPL-2.1.txt).

### `xdiff/xhistogram.c` — Eclipse Distribution License 1.0

One file inside `deps/xdiff/` is not LGPL. `xhistogram.c` (the histogram diff
algorithm, ported from JGit) carries:

> Copyright (C) 2010, Google Inc. and other copyright owners as documented in
> JGit's IP log. … made available under the terms of the Eclipse Distribution
> License v1.0

EDL-1.0 is a three-clause BSD license, and its binary-form clause requires the
copyright notice, the conditions and the disclaimer to be reproduced in the
documentation or other materials shipped with the binary. libgit2's `COPYING`
does not carry the EDL text, so the shipped copy in
[`licenses/EDL-1.0.txt`](licenses/EDL-1.0.txt) — reproduced from that file's own
header, which states the license "is reproduced below" — is the only place a
recipient can get it. It is compiled in on every platform, alongside the rest of
`deps/xdiff/`.

### `libgit2/deps/winhttp/` — LGPL-2.1-or-later (Windows builds only)

The Windows installers additionally contain libgit2's vendored WinHTTP
definition files, "Copyright (C) 2007 Francois Gouget", under
LGPL-2.1-or-later. Unlike xdiff, this one *is* documented in libgit2's `COPYING`
(line 441). The same LGPL notice and relink rights described for LibXDiff apply;
the license text is the same [`licenses/LGPL-2.1.txt`](licenses/LGPL-2.1.txt).
macOS and Linux builds do not compile it.

### OpenSSL 3.6.3 — Apache-2.0

| | |
| --- | --- |
| **What** | OpenSSL 3.6.3, pulled in by `git2`'s `vendored-openssl` feature |
| **How it ships** | Statically linked into every Novalis binary |
| **License** | Apache-2.0 |
| **Derived from** | `openssl-src-300.6.1+3.6.3/openssl/LICENSE.txt` (the vendored source tree). The `openssl-src` crate's own `license` field is `MIT/Apache-2.0`, which again covers the Rust wrapper, not the vendored C code. |

Apache-2.0 §4(a) requires that recipients of the work get a copy of the license
and §4(b) that modified-file notices be carried; OpenSSL is vendored unmodified,
and the license text ships as
[`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt), copied byte-for-byte from
that vendored `LICENSE.txt`.

Note that Novalis's own HTTP clients (`reqwest`, `iroh`, `hf-hub`, `fastembed`)
are configured for rustls, not OpenSSL. OpenSSL nevertheless ships, because
libgit2 is vendored with it. Any source comment in this repository claiming the
app is "openssl-free" is describing the intent of a particular dependency's
feature flags, not the shipped artifact.

### whisper.cpp — MIT

| | |
| --- | --- |
| **What** | whisper.cpp, the on-device speech-recognition engine behind voice/meeting capture |
| **How it ships** | Compiled from vendored C/C++ source into the desktop binary at build time, via `whisper-rs-sys` |
| **License** | MIT — "Copyright (c) 2023-2024 The ggml authors" |
| **Derived from** | `whisper-rs-sys-0.15.0/whisper.cpp/LICENSE` in the vendored crate source |

The Rust bindings themselves (`whisper-rs` 0.16.0, `whisper-rs-sys` 0.15.0)
declare `Unlicense` in their crate manifests.

### ONNX Runtime 1.24.2 — MIT

| | |
| --- | --- |
| **What** | Microsoft ONNX Runtime, the inference engine behind on-device semantic search |
| **How it ships** | A **prebuilt static library** downloaded during `cargo build` from `cdn.pyke.io` by `ort-sys` 2.0.0-rc.12 (SHA-256 pinned), then linked into the desktop binary |
| **License** | MIT — "Copyright (c) Microsoft Corporation" |
| **Derived from** | The upstream repository's `LICENSE` (https://github.com/microsoft/onnxruntime/blob/main/LICENSE), fetched 2026-08-06. **Not** derivable from anything in a local checkout: the downloaded archive contains only `libonnxruntime.a`, with no accompanying license text. The `ort` / `ort-sys` crates that fetch it are `MIT OR Apache-2.0` per their manifests, which describes the Rust bindings only. |

Whoever regenerates this file should re-check that upstream `LICENSE` against the
ONNX Runtime version in `ort-sys`'s distribution table rather than trusting this
line.

### Inter — SIL Open Font License 1.1

| | |
| --- | --- |
| **What** | The Inter variable font, bundled unconditionally (`apps/desktop/frontend/src/main.tsx` imports `@fontsource-variable/inter`; the `.woff2` files end up in `dist/assets` and therefore inside the app) |
| **License** | OFL-1.1 |
| **Copyright** | "Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)" |
| **Derived from** | `node_modules/@fontsource-variable/inter/LICENSE` and that package's `package.json` `license` field |

**The shipped fonts are Modified Versions in the OFL's sense.** fontsource does
not republish upstream's binaries untouched — it subsets and repackages them, and
OFL-1.1 defines any addition, deletion or substitution of *part* of the Font
Software as a Modified Version. An earlier revision of this file claimed the
opposite; it was wrong. Two consequences:

- **Condition 4 applies** (the Inter authors' names may not be used to promote a
  Modified Version without permission). Novalis does not.
- **No renaming is required.** Inter's OFL declares **no Reserved Font Name**, so
  condition 3, the rename obligation, never triggers. An earlier revision of this
  file asserted an RFN provision that does not exist. Grepping the license for
  "Reserved Font Name" does return one hit — it is the OFL's own *definition* of
  the term ("refers to any names specified as such after the copyright
  statement(s)"), and Inter's copyright statement specifies none.

Condition 2 — every copy of the Font Software, whether or not sold, must be
distributed with this license and the copyright notice — is what makes the font
license text a *shipped* file rather than a citation:
[`licenses/OFL-1.1-Inter.txt`](licenses/OFL-1.1-Inter.txt), copied byte-for-byte
from the installed package.

### KaTeX — MIT

| | |
| --- | --- |
| **What** | KaTeX 0.16.47, the math renderer, plus its font families |
| **How it ships** | The JS is bundled into a lazily-loaded chunk, and the **KaTeX font files** — 20 faces across `KaTeX_AMS`, `Main`, `Math`, `Caligraphic`, `Fraktur`, `SansSerif`, `Script`, `Size1`–`Size4` and `Typewriter`, in `.woff2`/`.woff`/`.ttf` — are emitted into `apps/desktop/frontend/dist/assets/` and therefore into every installer. Upstream `katex/dist/fonts/` has 60 files; the current build output carries 59 (Vite does not emit `KaTeX_Size3-Regular.woff2`). Either way the whole set is covered by the one MIT notice below. |
| **License** | MIT — "Copyright (c) 2013-2020 Khan Academy and other contributors" |
| **Derived from** | `node_modules/katex/LICENSE` |

The fonts are covered by KaTeX's own MIT license, not a separate font license.
MIT requires the copyright and permission notice to be included in all copies,
including binary ones; the text ships as
[`licenses/MIT-KaTeX.txt`](licenses/MIT-KaTeX.txt). It was missing entirely from
earlier revisions of this file.

### DOMPurify — MPL-2.0 or Apache-2.0

DOMPurify (3.4.13) is reached as a transitive dependency of Mermaid. Its
`package.json` declares `(MPL-2.0 OR Apache-2.0)`; **Novalis elects
Apache-2.0**, which keeps the whole
JavaScript bundle under permissive terms with no file-level source-disclosure
obligation.

### PDF.js — Apache-2.0

`pdfjs-dist` 6.2.108 (`package.json` `license` field, plus its `LICENSE` file)
powers the PDF reader. That is the version `pnpm-lock.yaml` resolves and the
build ships; `apps/desktop/frontend/package.json` only declares the range
`^6.1.200`, and an earlier revision of this file quoted that floor instead —
read the lockfile, not the manifest, or a minor bump that changes a license goes
unnoticed. Apache-2.0 requires that its `NOTICE` content, where present, be
reproduced — see the package's own `LICENSE` in the published artifact.

---

## Machine-learning models (downloaded at runtime, not bundled)

Neither model is part of any installer. Each is fetched from Hugging Face the
first time you use the feature that needs it, and cached in the app data
directory. If you never enable those features, nothing is downloaded.

| Model | Used by | Source | License |
| --- | --- | --- | --- |
| `ggml-base.en.bin` (Whisper base.en, ~142 MB) | Voice / meeting transcription (`apps/desktop/src-tauri/src/voice/transcribe.rs`) | `huggingface.co/ggerganov/whisper.cpp`, SHA-256 pinned in the source | **MIT** — the repository's model-card `license` field is `mit` (Hugging Face model API, checked 2026-08-06) |
| `bge-small-en-v1.5` (384-dim embeddings, ~130 MB) | On-device semantic search (`apps/desktop/src-tauri/src/ai/embed_local.rs`) | Fetched by `fastembed` from `huggingface.co/Xenova/bge-small-en-v1.5` (the ONNX conversion `fastembed` maps `EmbeddingModel::BGESmallENV15` to) | **Unclear at the distribution point.** The `Xenova/bge-small-en-v1.5` repository publishes **no license field at all** (Hugging Face model API, checked 2026-08-06). The upstream model it converts, `BAAI/bge-small-en-v1.5`, is tagged **MIT**. |

**The embedding model's provenance is a known gap.** Novalis downloads the
conversion, not the upstream model, and the conversion asserts no license. That
should be fixed by pointing at a source with an explicit license (or vendoring
the upstream weights) before the next release; until then this file states the
situation rather than papering over it. Unlike the Whisper download, this one is
also not pinned to a revision.

---

## Everything else, in aggregate

### Rust crates

908 crates in the dependency graph. Every one declares a `license` field — there
are zero unlicensed crates, and **no GPL, AGPL, LGPL-only or SSPL crate anywhere
in the graph**. Read that claim narrowly: it is a statement about Rust crate
*manifests*, and the copyleft code in the product is C source vendored inside
crates whose manifests say `MIT OR Apache-2.0` — libgit2 (GPL-2.0 with linking
exception), LibXDiff (LGPL-2.1-or-later) and, on Windows, winhttp
(LGPL-2.1-or-later), all described above. `cargo metadata` and `cargo deny`
cannot see any of them.

| License | Crates |
| --- | --- |
| MIT and/or Apache-2.0 (incl. dual/triple options such as `MIT OR Apache-2.0`, `Zlib OR Apache-2.0 OR MIT`) | 618 |
| MIT only | 204 |
| Apache-2.0 with no MIT option | 21 |
| Unicode-3.0 | 18 |
| Unlicense, or Unlicense/MIT | 16 |
| BSD-3-Clause | 7 |
| ISC | 7 |
| **MPL-2.0** | **6** |
| Zlib / CC0-1.0 / BSD-2-Clause | 7 |
| CDLA-Permissive-2.0 | 2 |
| BSD-3-Clause AND MIT, BSD-3-Clause/MIT | 2 |

The two buckets worth naming individually:

- **MPL-2.0** (file-level copyleft; unmodified use imposes no obligation on
  Novalis's own source): `attohttpc` 0.30.1, `cssparser` 0.36.0,
  `cssparser-macros` 0.6.1, `dtoa-short` 0.3.5, `option-ext` 0.2.0,
  `selectors` 0.36.1. All six are used unmodified and **none carries an
  Exhibit B "Incompatible With Secondary Licenses" notice** — checked by reading
  each crate's license file, not by grepping, because the phrase also occurs
  inside the body of the MPL text itself and a naive grep returns all six as
  false positives. One shipped copy of the text serves all six:
  [`licenses/MPL-2.0.txt`](licenses/MPL-2.0.txt).
- **Apache-2.0 with no MIT alternative** (so the Apache NOTICE/attribution terms
  apply): `backon`, `blake3`, `clang-sys`, `cpal`, `esaxx-rs`,
  `fastembed`, `hf-hub`, `hound`, `lzma-rust2`, `moxcms`, `pxfm`, `ring`, `ryu`,
  `safetensors`, `similar`, `spm_precompiled`, `sync_wrapper`, `tao`,
  `target-lexicon`, `tokenizers`, `zopfli`.

`ring` 0.17.14 declares `Apache-2.0 AND ISC` and carries its own additional
notices in the crate source.

### JavaScript packages

215 packages in the **production** dependency closure of the three shipping
workspace packages (`@novalis/frontend`, `@novalis/editor`, `@novalis/ui`).
Dev-only tooling — Vite, TypeScript, ESLint, Vitest and their trees — is excluded
because none of it reaches a user.

| License | Packages |
| --- | --- |
| MIT | 163 |
| ISC | 35 |
| BSD-3-Clause | 7 (`highlight.js`, `rw`, and five `d3-*` packages) |
| Apache-2.0 | 2 (`pdfjs-dist`, `@chevrotain/types`) |
| MIT OR Apache-2.0 | 2 (`@tauri-apps/api`, `@tauri-apps/plugin-notification`) |
| OFL-1.1 | 1 (`@fontsource-variable/inter`) |
| MPL-2.0 OR Apache-2.0 | 1 (`dompurify` — Apache-2.0 elected) |
| Python-2.0 | 1 (`argparse` 2.0.1, a transitive dependency of Mermaid's YAML parser) |
| BSD-2-Clause | 1 (`entities`) |
| Unlicense | 1 (`robust-predicates`) |
| No `license` field | 1 (`khroma` 2.1.0 — its `license` file is the MIT license, "Copyright (c) 2019-present Fabio Spampinato, Andrew Maney") |

---

## How this file was derived, and how to regenerate it

No license-scanning tool was installed to produce this. `cargo about` and
`license-checker` are not present in this environment and were deliberately not
installed globally; everything above comes from manifests already on disk.

**Rust side.** `cargo metadata --format-version 1 --all-features`, then group the
`packages[]` array by `license`, excluding the three `workspace_members`:

```bash
cargo metadata --format-version 1 --all-features > /tmp/meta.json
# then group packages[].license, skipping workspace_members
```

"Group by license" is not as self-evident as it reads — SPDX expressions like
`Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` have to land somewhere, and
where they land decides three of the rows. The exact rule, first match wins, is:

| Bucket | Predicate on the `license` string |
| --- | --- |
| MIT and/or Apache-2.0 | contains `Apache-2.0` **and** contains `MIT` |
| MIT only | equals `MIT` |
| Apache-2.0 with no MIT option | contains `Apache-2.0` (so `BSD-3-Clause OR Apache-2.0` counts here) |
| Unicode-3.0 | equals `Unicode-3.0` |
| Unlicense, or Unlicense/MIT | contains `Unlicense` |
| BSD-3-Clause | equals `BSD-3-Clause` |
| ISC | equals `ISC` |
| MPL-2.0 | equals `MPL-2.0` |
| Zlib / CC0-1.0 / BSD-2-Clause | equals one of those three |
| CDLA-Permissive-2.0 | equals `CDLA-Permissive-2.0` |
| BSD-3-Clause AND MIT, BSD-3-Clause/MIT | contains `BSD-3-Clause` and `MIT` |

Two things this rule does that are easy to get wrong, and both were verified by
replaying it against the tree at `0f4cba5` and reproducing that revision's
published numbers (922 / 619 / 219 / 21 / 18 / 14 / 8 / 7 / 6 / 6 / 2 / 2)
exactly: the substring test for MIT also matches `MIT-0`, and the
`Apache-2.0`-only bucket absorbs the multi-option expressions that offer Apache
alongside something other than MIT. If a future re-derivation does not reproduce
the previous revision's numbers on the previous revision's lockfile, the rule has
been mis-implemented — check that before believing the new numbers.

The bucket totals must sum to the headline crate count; if they do not, an
unbucketed license string has appeared and needs a decision, not a silent
default.

Caveat, and it matters: `--all-features` walks build-dependencies,
dev-dependencies and **all** platform-conditional dependencies. 908 is therefore
an upper bound across every target, not the exact set linked into one platform's
binary. It is the right number for a notices file (over-disclosing is safe) and
the wrong number for a size estimate.

Vendored C libraries are **invisible to this method** — `cargo metadata` reports
the Rust binding's license, not the vendored source's. Each such case above was
checked by reading the license file inside the extracted crate under
`~/.cargo/registry/src/*/`. Any future crate with a `vendored-*` feature needs
the same manual check.

**JavaScript side.** `pnpm licenses list` fails on this store
(`ERR_PNPM_MISSING_PACKAGE_INDEX_FILE`). Instead, the production closure was
walked directly: start from the three shipping `package.json` files, follow
`dependencies` (never `devDependencies`) transitively through pnpm's
`node_modules` layout, and read each resolved package's own `license` field.
Packages with no `license` field were resolved by reading their `LICENSE` file.

**Models.** Verified against the Hugging Face model API
(`https://huggingface.co/api/models/<repo>`), reading the `license` tag. Do not
assume a converted/mirrored repository inherits the upstream model's license — as
the embedding model above shows, it may assert nothing at all.

**When to regenerate:** on any dependency bump that changes `Cargo.lock` or
`pnpm-lock.yaml`, and always before cutting a release.

CI now runs `cargo deny check licenses bans sources` on every push and PR
(config in `deny.toml`), against all four shipped targets. A new dependency
whose license is not on that allow-list fails the build, so the Rust half of
this document can no longer drift silently.

That check does **not** replace this file, for one specific reason: cargo-deny
reads crate *manifests*. It sees `libgit2-sys` declare `MIT OR Apache-2.0` and
has no way to know that the C source that crate vendors and statically links is
GPL-2.0 with a linking exception, that `deps/xdiff/` inside it is
LGPL-2.1-or-later with no exception at all, or that one file in that directory is
EDL-1.0. The same blind spot covers `openssl-src` and `whisper-rs-sys`. Those
sections stay hand-derived and hand-checked; treat a green `cargo deny` as
covering everything except them.

**Checking the vendored C by hand.** The claims above were produced by reading
the extracted crate sources under `~/.cargo/registry/src/*/`, not their
manifests:

```bash
LG=~/.cargo/registry/src/*/libgit2-sys-0.18.5+1.9.4
# which vendored deps get compiled, and unconditionally?
grep -n 'add_c_files' $LG/build.rs
# what do the sources of each say about their license?
grep -rl 'Lesser General Public' $LG/libgit2/deps/xdiff/   # -> 14 files
head -45 $LG/libgit2/deps/xdiff/xhistogram.c               # -> EDL-1.0
# is the vendored copy modified?
curl -sL https://github.com/libgit2/libgit2/archive/refs/tags/v1.9.4.tar.gz | tar xz
diff -rq libgit2-1.9.4 $LG/libgit2                         # -> only ci/docs/examples/fuzzers/tests absent
```

Any future crate with a `vendored-*` feature, or any `build.rs` that compiles a
`deps/` directory, needs the same treatment before it ships.
