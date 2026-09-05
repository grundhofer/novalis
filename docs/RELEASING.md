# Releasing

Releases are cut from annotated `vX.Y.Z` tags on `main` and built by
`.github/workflows/release.yml`, which attaches the artefacts to a **draft**
GitHub Release. A person reviews the draft and publishes it. **All releases
until this document is revised ship unsigned** (ADR-0010).

## Versioning

- SemVer. Annotated tags `vX.Y.Z`; pre-releases `vX.Y.Z-alpha.N`, `-beta.N`,
  `-rc.N`. A hyphen in the tag ⇒ the draft is flagged as a pre-release.
- First tag of the rewrite: `v2.0.0-alpha.1`. The old line stays at
  `v0.2.1-rc2` and the `legacy-final` tag; those releases are relabelled, never
  deleted (AGPL corresponding-source obligations attach to shipped binaries).
- One `VERSION` file is the source. `just bump <version>` propagates it to the
  three stamps (`Cargo.toml` workspace version, `package.json`,
  `apps/desktop/src-tauri/tauri.conf.json`) and refreshes `Cargo.lock`
  (`cargo update -w`); `scripts/check-versions.mjs` fails CI when they differ.
- Minimum macOS 14, arm64 only (PLAN.md §4.5).

## Before tagging

1. `docs/FILE-PROVIDER-CHECKLIST.md` executed on OneDrive and on Google Drive
   (Stream and Mirror), Outcome table filled in.
2. `just check` green locally; `perf.yml` numbers on `main` within
   `docs/BUDGET.json`.
3. Release notes drafted in German and English (see the template below).
4. Version bump merged through a PR (`main` is protected):

   ```sh
   git switch -c release/v2.0.0-alpha.1
   just bump 2.0.0-alpha.1
   git commit -am 'chore: release v2.0.0-alpha.1'
   git push -u origin release/v2.0.0-alpha.1
   gh pr create --fill && gh pr merge --merge   # wait for check (macos-latest), check (ubuntu-latest), audit
   ```

## Tag → draft

```sh
git switch main && git pull --ff-only
git tag -a v2.0.0-alpha.1 -m 'v2.0.0-alpha.1'
git push origin v2.0.0-alpha.1
```

`release.yml` then:

1. runs `ci.yml` as a reusable workflow (`workflow_call`) as the gate — the
   build cannot start before every CI job is green, and the gate can never drift
   from the PR gate because it is the same file;
2. builds the app with `tauri-action` v1 (arm64 DMG; ad-hoc signature from the
   bundler) and the CLI tarball `novalis-cli-<ver>-arm64.tar.gz`;
3. runs the signing and notarization steps **only if the secrets exist** (they
   do not this year, see below);
4. writes `SHA256SUMS`, attaches build-provenance attestations, and creates the
   draft release `novalis v2.0.0-alpha.1` with the artefacts and the source
   archive.

Then open the draft, paste the release notes, check the asset list, and
**Publish**. Do not tick "Set as the latest release" on a pre-release.

Asset checklist on the draft:

- `novalis_<ver>_aarch64.dmg`
- `novalis-cli-<ver>-arm64.tar.gz`
- `novalis-<ver>-source.tar.gz` — the git archive plus lockfiles (AGPL section 6
  corresponding source, PLAN.md §11.6). No `cargo vendor` tarball.
- `SHA256SUMS` listing every other asset
- attestations verify: `gh attestation verify <file> --repo grundhofer/novalis`
  (one file per call)

## Unsigned builds: what users see, and the note every release carries

Gatekeeper shows *"novalis" can't be opened because Apple could not verify it is
free of malware* (wording varies by macOS version). Paste this block into
every release's notes, both languages:

> **macOS: erster Start.** Die App ist nicht von Apple beglaubigt. Rechtsklick
> auf `novalis.app` ▸ **Öffnen** ▸ **Öffnen** — einmalig. Alternativ:
> Systemeinstellungen ▸ Datenschutz & Sicherheit ▸ **Trotzdem öffnen**, oder im
> Terminal `xattr -d com.apple.quarantine /Applications/novalis.app`.
> Homebrew: `brew install --cask --no-quarantine grundhofer/novalis/novalis`.
>
> **macOS: first launch.** The app is not notarized by Apple. Right-click
> `novalis.app` ▸ **Open** ▸ **Open** — once. Or: System Settings ▸ Privacy &
> Security ▸ **Open Anyway**, or in Terminal
> `xattr -d com.apple.quarantine /Applications/novalis.app`.
> Homebrew: `brew install --cask --no-quarantine grundhofer/novalis/novalis`.
>
> Every asset carries a build-provenance attestation; verify with
> `gh attestation verify <file> --repo grundhofer/novalis`. That is the proof of
> origin while builds are unsigned.

Never tell users to disable Gatekeeper globally.

## Release-note template (de/en)

```
## novalis v2.0.0-alpha.1

### Neu / New
- …

### Bekannt / Known
- …

### Für Nutzer der alten Novalis-App / For users of the old Novalis
- Der Branch `legacy` und die Releases bis v0.2.1-rc2 werden nicht mehr gepflegt.
- Vor dem ersten Öffnen eines alten Vaults: `novalis migrate --dry-run`, dann
  die alte App auf allen Geräten beenden, warten bis die Synchronisierung ruht,
  dann `novalis migrate --apply`.
- The `legacy` branch and releases up to v0.2.1-rc2 are unsupported.
- Before opening an old vault: `novalis migrate --dry-run`, quit the old app on
  every device, wait until sync is idle, then `novalis migrate --apply`.

### macOS: erster Start / first launch
(paste the block above)
```

## Homebrew tap (optional)

`grundhofer/homebrew-novalis` carries `Casks/novalis.rb` with a `binary` stanza
for the CLI. Update `version` and `sha256` from `SHA256SUMS` after publishing.
The main `homebrew/cask` tap is not used: it rejects un-notarized artefacts and
applies notability criteria this repository does not meet (verified, ADR-0002).

## Re-running a release

Delete and re-push the tag, or use **Run workflow** on the Release workflow
choosing the *tag* (not a branch) as the ref. `tauri-action` only reuses a
release that is still a **draft**; to rebuild a published release, delete it
first or cut a new tag.

## Enabling signing later (a secrets change, not a pipeline change)

When the owner enrols in the Apple Developer Program (ADR-0010 is revisited
before the first non-alpha release in 2027):

1. Create a "Developer ID Application" certificate in the developer account;
   export it as `.p12`.
2. Create an App Store Connect API key with the Developer role (for
   `notarytool`).
3. Add the secrets in the repository (Settings ▸ Secrets and variables ▸
   Actions):

   | Secret | Value |
   |---|---|
   | `APPLE_CERTIFICATE` | base64 of the `.p12` |
   | `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password |
   | `APPLE_SIGNING_IDENTITY` | `Developer ID Application: <name> (<TEAMID>)` |
   | `KEYCHAIN_PASSWORD` | any random string (temporary CI keychain) |
   | `APPLE_API_ISSUER` | App Store Connect issuer id |
   | `APPLE_API_KEY` | key id |
   | `APPLE_API_KEY_PATH` | contents of the `.p8` key (the workflow writes it to a file) |

4. Push the next tag. `release.yml` detects the secrets, signs, notarizes and
   staples; the right-click block is dropped from the notes; amend ADR-0010 with
   the date and team id.
5. Local check of a signed DMG: `spctl -a -vv -t install novalis_<ver>_aarch64.dmg`.

Nothing in `release.yml` changes; the steps are already there behind
`if: ${{ secrets.APPLE_SIGNING_IDENTITY != '' }}`.

## After publishing

- Update the cask in the personal tap (if used).
- Post the README banner on `main` for legacy users if this is the first
  release of the rewrite.
- Record the measured numbers from `perf.yml` as the release's artefact link in
  the notes.
