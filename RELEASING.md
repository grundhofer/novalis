# Releasing Novalis

Novalis releases are built and published by GitHub Actions
(`.github/workflows/release.yml`) when an annotated `v*.*.*` tag is pushed.
The workflow attaches platform installers to a **draft** GitHub release; a
maintainer reviews and publishes it manually.

## Cutting a release

1. **Bump the version** in three places — they must stay in sync:

   - `Cargo.toml` → `[workspace.package] version`
   - `package.json` → `version`
   - `apps/desktop/src-tauri/tauri.conf.json` → `version`

   The bump has to reach `main` through a PR — `main` is protected, and a
   direct push is rejected with `repository rule violations`. Note this is
   FOUR files, not three: `cargo update -w` rewrites the three workspace
   members in `Cargo.lock`, and CI runs `cargo test --locked`, which a stale
   lock fails.

   ```bash
   git switch -c release/v0.2.0
   cargo update -w                      # refreshes Cargo.lock, no dep drift
   git commit -am "chore: release v0.2.0"
   git push -u origin release/v0.2.0
   gh pr create --fill && gh pr merge --merge   # wait for the 4 checks
   ```

2. **Tag the merge commit and push the tag:**

   ```bash
   git switch main && git pull --ff-only
   git tag -a v0.2.0 -m "v0.2.0"
   git push origin v0.2.0
   ```

   Tag `main` only after the bump has merged, or the release builds a tree
   whose version stamps do not match the tag.

3. The `Release` workflow first runs two gates in parallel — **`CI gates`**
   (fmt, clippy, tests, lint, i18n, bindings) and the **`UI gate`**, which
   builds the app and drives it through the OS accessibility APIs on all three
   platforms to check that what a user types reaches disk. Only if BOTH pass
   does it build installers on three runners (macOS, Ubuntu, Windows) and
   creates a draft release named `Novalis v0.2.0` with the artifacts attached.

4. Open the draft on GitHub, edit the release notes, then **Publish**. Before
   publishing, check all three:

   - `novalis-<tag>-source.tar.gz` is among the assets — publishing without it
     breaches GPL-2.0 §3 for the libgit2 code in the installers. See
     [License obligations](#license-obligations--do-not-clean-up-any-of-this).
   - `SHA256SUMS` is among the assets, and lists every other asset. It is
     written by the terminal `source` job, so its absence means that job did
     not finish even though the installers did.
   - The provenance attestations verify. `gh attestation verify` takes exactly
     one file per call — passing a glob fails with `too many arguments` — so
     loop:

     ```sh
     gh release download <tag> --dir /tmp/rel --pattern '*' --clobber
     for f in /tmp/rel/*; do
       gh attestation verify "$f" --repo grundhofer/novalis >/dev/null \
         || echo "UNVERIFIED: $f"
     done
     ```

   The release notes are the *only* thing here a human has to write. Everything
   else on the draft comes from `releaseBody:` in `release.yml` — if a fact
   about the artifacts is wrong there, fix it in the workflow rather than only
   on the draft, or the next tag reproduces it.

   **Pre-release tags mark themselves — but only on a freshly created draft.**
   `prerelease:` is derived from the tag name
   (`contains(github.ref_name, '-')`), so a *new* `v0.2.1-rc1` drafts as a
   pre-release and `v0.2.1` does not. Do not tick "Set as the latest release"
   on an rc: `SECURITY.md` treats the latest release as the supported version.
   See [Re-running a release](#re-running-a-release) for why an existing draft
   does not pick this up.

## The release gate

A tag push does **not** trigger `ci.yml` — its `on:` block covers
`push: branches: [main]`, `pull_request` and a weekly `schedule`, and none of
those fire on a tag. So without a gate, a tag could ship a build with no fmt,
clippy, test, lint, i18n or bindings-drift check behind it.

Of the two ways to fix that, this repo uses the second:

- ~~Add `push: tags: ['v*.*.*']` to `ci.yml`~~ — rejected: CI and the release
  build would run *in parallel*, so the installers could finish and be attached
  to the draft before CI went red.
- **`release.yml` calls `ci.yml` as a reusable workflow** (`gate:` job, then
  `release: needs: gate`). The release build cannot start until every CI job is
  green, and because it calls the same file, the release gate can never drift
  away from the PR gate.

Consequence: a release run is roughly *CI time + build time*, not the longer of
the two. That is deliberate — releases are cut rarely.

## Re-running a release

To re-run a failed release after fixing the cause, delete and re-push the tag,
or use **Run workflow** (`workflow_dispatch`) on the Release workflow; the gate
runs either way. If you use **Run workflow**, pick the *tag* in the ref
dropdown, not a branch: `release.yml` derives both `tagName` and `releaseName`
from `github.ref_name`, so dispatching from `main` would draft a release named
`Novalis main`.

**A re-run only works while the release for that tag is still a draft.** Since
`tauri-action` v1.0.0 the action refuses to reuse a release it did not find in
draft state: it warns, falls through to *create*, and the create fails with a
422 `already_exists`. (v0.6.2 reused a published release and quietly re-uploaded
installers into it, which was worse.) So to rebuild a release that has already
been published, either delete the release first or cut a new tag.

**A re-run onto a surviving draft keeps that draft's original notes and
pre-release flag.** Assets are re-uploaded, `releaseBody:` and `prerelease:` are
not re-applied. `tauri-action` passes both to `createRelease` only; when it
finds an existing release for the tag it sets `isNewRelease = false`, and its
update branch is `else if (!isNewRelease && !release.draft)` — skipped for
drafts by design, because updating one rewrites its tag. Deleting and re-pushing
the git tag does **not** help: the lookup matches on the release list's
`tag_name`, never on a git ref, so the draft object survives it.

The practical consequence: after changing the notes or the pre-release rule in
`release.yml`, a re-run of an existing tag looks completely green while shipping
the *old* text and flag. Delete the release object first, not just the tag:

```sh
gh release delete <tag> --yes
git push origin :refs/tags/<tag>
```

Or cut a new tag (`-rc2`), which has no draft to inherit from. The workflow
re-asserts the pre-release flag after the build for exactly this reason, but it
cannot repair the body — that text only ever reaches a release at creation.

## What gets built

| Platform | Artifacts                             | Architecture          |
| -------- | ------------------------------------- | --------------------- |
| macOS    | `Novalis_<ver>_aarch64.dmg`,          | Apple Silicon only    |
|          | `Novalis_<ver>_aarch64.app.tar.gz`    |                       |
| Linux    | `Novalis_<ver>_amd64.deb`,            | x86_64                |
|          | `Novalis_<ver>_amd64.AppImage`,       |                       |
|          | `Novalis-<ver>-1.x86_64.rpm`          |                       |
| Windows  | `Novalis_<ver>_x64_en-US.msi`,        | x86_64                |
|          | `Novalis_<ver>_x64-setup.exe`         |                       |
| (any)    | `novalis-<tag>-source.tar.gz`         | corresponding source  |
| (any)    | `SHA256SUMS`                          | manifest of the above |

ARM Linux and ARM Windows are not built yet; add a matrix entry when needed.

The macOS bundle declares `minimumSystemVersion: 11.0`
(`apps/desktop/src-tauri/tauri.conf.json`) because Big Sur is where arm64 macOS
starts — an older floor is unsatisfiable for the only macOS artifact shipped.
That is a *bundle* declaration and deliberately not the same number as
`MACOSX_DEPLOYMENT_TARGET = "10.15"` in `.cargo/config.toml`, which exists to
stop Tauri injecting 10.13 and breaking whisper.cpp's `std::filesystem`
compile. Compiling against an older floor than the bundle advertises is fine;
the reverse would not be.

Every asset also carries a signed build-provenance attestation
(`actions/attest-build-provenance`, one step in the `release` matrix job and one
in `source`). These are minted from the job's OIDC identity **at build time**,
so they cannot be added to a release that has already been built — a release cut
before this existed can only gain them by being rebuilt under a new tag.

**Intel macOS cannot be built, and this is not a matrix choice.** A universal
binary compiles an `x86_64-apple-darwin` slice, and `ort-sys` — ONNX Runtime,
pulled in by `fastembed` for on-device embeddings — publishes no prebuilt for
that target:

```
error: ort-sys@2.0.0-rc.13: no prebuilt binaries available for target x86_64-apple-darwin
```

Its `build/download/dist.tsv` lists nine targets; Intel macOS is absent while
`aarch64-apple-darwin` is present (with CoreML). `2.0.0-rc.13` is the latest
release, so there is nothing to bump to. Restoring Intel needs upstream to
publish the binary, or `ort`'s `load-dynamic` with a shipped ORT dylib, or
feature-gating embeddings off for that target.

Found by the first end-to-end release run (`v0.2.1-rc1`): the CI gate passed,
Linux and Windows built, macOS failed. Nothing else could have caught it —
`bundle-smoke` builds **Ubuntu only**, so macOS and Windows bundles are exercised
by the release workflow alone.

Two things in that table are easy to get wrong, and both bite only at release time:

- **The Linux names are PascalCase**, matching `productName`. `tauri-action`
  v0.6.2 also looked for a lowercased spelling (`novalis_…`) as a fallback;
  v1.0.0 removed that, so the bundle filenames now have to match `productName`
  exactly or the ubuntu job ends with `No artifacts were found.`
- **The macOS `.app.tar.gz` is produced by the action itself**, not by the
  updater, so it is attached even though no updater artifacts are configured.
  v0.6.2 named it `Novalis_universal.app.tar.gz` with no version; v1.0.0 stamps
  the version in. A v1.0.0 run over a draft that a v0.6.2 run created will
  therefore match neither the old name nor its label and attach **both** files.

**A failed platform blocks the source archive.** The `source` job is
`needs: release`, so if any one platform fails, the tarball is skipped while the
successful platforms' installers are still attached to the draft. A draft in that
state looks publishable and is not — see below.

## License obligations — do not "clean up" any of this

Two parts of the release exist purely to keep the shipped binaries lawful. Both
look like clutter and neither is. Before removing either, read
`THIRD-PARTY-NOTICES.md`.

### 1. `bundle.resources` in `apps/desktop/src-tauri/tauri.conf.json`

It packages `licenses/`, `THIRD-PARTY-NOTICES.md`, `LICENSE` and
`COMMERCIAL-LICENSE.md` into every bundle target. `LICENSE` is AGPL-3.0-only
plus the section 7 plugin permission and points at `COMMERCIAL-LICENSE.md`, so
that file ships too rather than leaving a dangling reference in a legal document
someone reads offline. Several licenses in the tree oblige us to put the license
*text* into the recipient's hands — OFL-1.1 condition 2 for Inter, Apache-2.0 §4(a)–(b)
for the statically linked OpenSSL, GPL-2.0 §1 for libgit2, LGPL-2.1 §6 for
LibXDiff, and the EDL-1.0 / BSD-3-Clause binary-form notice clause for
`xhistogram.c`. Before those entries existed, `THIRD-PARTY-NOTICES.md` sat in the
repository and shipped nowhere, so every one of those obligations was in breach
on every release.

Two details that are easy to break:

- **The map form is required**, not the array form. `tauri-utils`'
  `resource_relpath()` rewrites each leading `..` in an array entry into a `_up_`
  directory, so `"../../../licenses"` would land in
  `$RESOURCE/_up_/_up_/_up_/licenses`. The map's value is an explicit
  destination, which sidesteps that. Paths are relative to `tauri.conf.json`,
  like `frontendDist` and `icon`.
- **You cannot leave a `//comment` key next to it.** Tauri's config structs are
  `#[serde(deny_unknown_fields)]`; an unknown key fails the build. That is why
  this explanation lives here instead.

Where the files land after install: `Novalis.app/Contents/Resources/licenses/`
on macOS, `$INSTDIR\licenses\` on Windows, `/usr/lib/Novalis/licenses/` on Linux.

### 2. The source archive (`source` job in `release.yml`)

GPL-2.0 §3 requires the source for GPL'd code to be offered "from the same
place" as the binary. This is stricter than the AGPL, whose §6(d) explicitly
permits a *different* server — so linking to github.com/libgit2 does **not**
discharge it. Every installer statically links libgit2 (GPL-2.0 with a linking
exception) and LibXDiff (LGPL-2.1-or-later, and *not* covered by that
exception), so the corresponding source must be an asset on the same release.

Since the relicense there is a second, independent reason for the same asset:
Novalis is AGPL-3.0-only, and §6 requires the Corresponding Source for the
binaries we convey. The `git archive` half of the tarball is what discharges
that — see the npm caveat below, which is now a real gap rather than a note.

The `source` job runs `cargo vendor --locked --versioned-dirs`, drops the result
into a `git archive` of the tagged tree, appends cargo's source-replacement
stanza to the existing `.cargo/config.toml` (appends — that file already pins
`MACOSX_DEPLOYMENT_TARGET`, and overwriting it breaks macOS rebuilds), and
uploads the tarball to the draft with `gh release upload --clobber`.

Properties worth knowing before changing it:

- `cargo vendor` is **target-agnostic**: run on Linux it still vendors the
  Windows- and macOS-only crates, so one job covers all three platforms'
  binaries. Verified by checking `winapi`/`windows-sys` and `gtk`/`webkit2gtk`
  are all present in a vendor run from macOS.
- The result resolves `Cargo.lock` fully offline (`cargo metadata --offline
  --locked` succeeds in the extracted tree).
- Size is ~166 MB gzipped from ~1.3 GB of sources, about 30 s to compress. The
  GitHub per-asset limit is 2 GB, so there is a lot of headroom.
- npm packages are **not** vendored, and under the AGPL that is now an open
  question rather than a settled one. No JS dependency carries a
  source-delivery obligation *of its own* — they are all permissive — but
  AGPL §1 defines Corresponding Source as everything needed to generate and run
  the object code, and third-party JS is bundled straight into
  `dist/assets/*.js`. `pnpm-lock.yaml` pins every package to an exact version
  and integrity hash, so the tarball is reproducible with one `pnpm install`;
  whether "reproducible with a network fetch" is the same as "accompanied by"
  is the part that is unresolved. The Rust/C half has no such gap: `cargo
  vendor` puts every crate source in the archive. **Decide this before the
  first AGPL release** — the fix, if wanted, is a `pnpm fetch` store beside the
  vendor directory.

If a release is published without that asset, the GPL-2.0 §3 obligation is
unmet — treat a failed `source` job as release-blocking, not cosmetic.

## Unsigned-build warnings (what users see)

Until code signing is wired up (Phase B, below), users will see OS warnings on
first launch. They are not malware warnings — they only mean the binary was
not signed with a paid OS-vendor certificate.

- **macOS:** "Novalis can't be opened because Apple cannot check it for
  malicious software." Right-click the app → **Open** → **Open** in the
  dialog. Or: System Settings → Privacy & Security → "Open Anyway".

- **Windows:** SmartScreen blue screen ("Microsoft Defender SmartScreen
  prevented an unrecognized app from starting"). Click **More info** →
  **Run anyway**.

- **Linux:** No warnings. The `.AppImage` needs `chmod +x` before running.

Link to this section from the release notes so users know what to expect.

## Phase B: adding code signing later

When you have certs, add the secrets below to **Settings → Secrets and
variables → Actions** in the GitHub repo. `tauri-action` picks them up
automatically — no workflow code changes needed beyond uncommenting the env
block.

### macOS (Apple Developer ID, ~$99/yr)

| Secret                       | Source                                      |
| ---------------------------- | ------------------------------------------- |
| `APPLE_CERTIFICATE`          | base64-encoded `.p12` of the Developer ID Application cert |
| `APPLE_CERTIFICATE_PASSWORD` | password used when exporting the `.p12`     |
| `APPLE_SIGNING_IDENTITY`     | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID`                   | your Apple ID email                         |
| `APPLE_PASSWORD`             | an **app-specific password** (not your real password) |
| `APPLE_TEAM_ID`              | 10-char team ID from developer.apple.com    |

`tauri-action` runs `codesign` + `notarytool` automatically when these are
present. Notarization adds ~5 min to the macOS job.

### Windows (code-signing cert)

| Secret                          | Source                                     |
| ------------------------------- | ------------------------------------------ |
| `WINDOWS_CERTIFICATE`           | base64-encoded `.pfx`                      |
| `WINDOWS_CERTIFICATE_PASSWORD`  | `.pfx` password                            |

For EV certs (hardware token), CI signing isn't possible without a cloud HSM
(e.g. Azure Key Vault + `azuresigntool`). Stick with an OV cert for CI.

### Linux

No signing required for `.AppImage` / `.deb`. (If you publish to a `.deb`
repo later, you'll want a GPG signing key — out of scope for now.)

## Future: in-app auto-update

The Tauri Updater plugin (free, separate from OS code signing) lets the app
check for new releases and apply them in-place. Not wired up yet. To add:

1. Run `pnpm tauri signer generate -w ~/.tauri/novalis.key`. Store the
   private key as the `TAURI_SIGNING_PRIVATE_KEY` GitHub secret; embed the
   public key in `tauri.conf.json` under `plugins.updater.pubkey`.
2. Add `tauri-plugin-updater` (Rust) + `@tauri-apps/plugin-updater` (JS).
3. Host the update manifest (`latest.json`) on GitHub Pages or release
   assets. `tauri-action` can generate it.
4. Add a "Check for updates" item to the app menu / settings.

This is a separate, larger task; track it as its own follow-up.
