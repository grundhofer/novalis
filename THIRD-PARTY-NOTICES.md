# Third-Party Notices

Novalis itself is MIT-licensed (see [LICENSE](LICENSE)). The installers on the
Releases page are not only Novalis: they statically link a substantial amount of
third-party code, some of it under licenses whose terms require the notice to
travel with the binary. This file is that notice.

It is not a complete license-text appendix. It names every component with a
non-obvious obligation, gives the aggregate picture for the rest, and states
exactly how each fact was derived so you can re-derive it.

**Last derived:** 2026-08-06, against `Cargo.lock` and `pnpm-lock.yaml` as of
Novalis 0.2.0.

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

**What this means:** Novalis does **not** become GPL by linking libgit2, and
Novalis stays MIT. The GPL's terms still cover libgit2 itself, and GPL-2.0 §1
requires the license text to accompany the distributed binary — which is what
this section does. Copyright: the libgit2 contributors (see `AUTHORS` in the
libgit2 source).

Full license text: https://github.com/libgit2/libgit2/blob/main/COPYING

### OpenSSL 3.6.3 — Apache-2.0

| | |
| --- | --- |
| **What** | OpenSSL 3.6.3, pulled in by `git2`'s `vendored-openssl` feature |
| **How it ships** | Statically linked into every Novalis binary |
| **License** | Apache-2.0 |
| **Derived from** | `openssl-src-300.6.1+3.6.3/openssl/LICENSE.txt` (the vendored source tree). The `openssl-src` crate's own `license` field is `MIT/Apache-2.0`, which again covers the Rust wrapper, not the vendored C code. |

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

OFL-1.1 permits bundling in software. The Reserved Font Name provision means a
modified copy must be renamed; Novalis ships Inter unmodified.

### DOMPurify — MPL-2.0 or Apache-2.0

DOMPurify (3.4.13) is reached as a transitive dependency of Mermaid. Its
`package.json` declares `(MPL-2.0 OR Apache-2.0)`; **Novalis elects
Apache-2.0**, which keeps the whole
JavaScript bundle under permissive terms with no file-level source-disclosure
obligation.

### PDF.js — Apache-2.0

`pdfjs-dist` 6.1.200 (`package.json` `license` field, plus its `LICENSE` file)
powers the PDF reader. Apache-2.0 requires that its `NOTICE` content, where
present, be reproduced — see the package's own `LICENSE` in the published
artifact.

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

922 crates in the dependency graph. Every one declares a `license` field — there
are zero unlicensed crates, and **no GPL, AGPL, LGPL-only or SSPL crate anywhere
in the graph** (the only GPL code in the product is the vendored libgit2 C source
described above, which `cargo metadata` cannot see).

| License | Crates |
| --- | --- |
| MIT and/or Apache-2.0 (incl. dual/triple options such as `MIT OR Apache-2.0`, `Zlib OR Apache-2.0 OR MIT`) | 619 |
| MIT only | 219 |
| Apache-2.0 with no MIT option | 21 |
| Unicode-3.0 | 18 |
| Unlicense, or Unlicense/MIT | 14 |
| BSD-3-Clause | 8 |
| ISC | 7 |
| **MPL-2.0** | **6** |
| Zlib / CC0-1.0 / BSD-2-Clause | 6 |
| CDLA-Permissive-2.0 | 2 |
| BSD-3-Clause AND MIT, BSD-3-Clause/MIT | 2 |

The two buckets worth naming individually:

- **MPL-2.0** (file-level copyleft; unmodified use imposes no obligation on
  Novalis's own source): `attohttpc` 0.30.1, `cssparser` 0.36.0,
  `cssparser-macros` 0.6.1, `dtoa-short` 0.3.5, `option-ext` 0.2.0,
  `selectors` 0.36.1.
- **Apache-2.0 with no MIT alternative** (so the Apache NOTICE/attribution terms
  apply): `backon`, `blake3`, `borsh-derive`, `clang-sys`, `cpal`, `esaxx-rs`,
  `fastembed`, `hf-hub`, `hound`, `lzma-rust2`, `moxcms`, `pxfm`, `ring`, `ryu`,
  `safetensors`, `similar`, `spm_precompiled`, `sync_wrapper`, `tao`,
  `target-lexicon`, `tokenizers`.

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

Caveat, and it matters: `--all-features` walks build-dependencies,
dev-dependencies and **all** platform-conditional dependencies. 922 is therefore
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
`pnpm-lock.yaml`, and always before cutting a release. If a future change adds a
license-scanning step to CI (`cargo-deny` with a `[licenses]` allow-list is the
obvious candidate, and would also catch a new copyleft dependency automatically),
this file should become its output rather than a hand-derived document.
