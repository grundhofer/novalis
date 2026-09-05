# 0010 — Releases ship unsigned for the coming year

**Status:** accepted · **Date:** 2026-09-05 · **Decider:** Sebastian Grundhöfer

## Context

Only an "Apple Development" signing identity exists on this Mac; distributing outside the App Store without Gatekeeper warnings needs a "Developer ID Application" certificate plus notarization, which requires the paid Apple Developer Program (99 USD/year). `codesign`, `notarytool` and `stapler` are installed, so nothing but the enrolment is missing. The owner decided not to enrol for the coming year. The old releases already shipped unsigned with a documented right-click-open note, so users of the legacy line know the procedure.

## Decision

- Every release until this ADR is revisited — **before the first non-alpha release in 2027** — ships **unsigned**: the DMG is ad-hoc signed by the Tauri bundler, attached as a draft GitHub Release together with `novalis-cli-<ver>-arm64.tar.gz`, `SHA256SUMS` and build-provenance attestations, which are the only proof of origin.
- Release notes (de/en) carry the right-click ▸ Open instruction and the `xattr -d com.apple.quarantine` alternative, as `docs/RELEASING.md` specifies.
- `release.yml` keeps the signing and notarization steps behind the documented secrets (`APPLE_SIGNING_IDENTITY`, `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`), so enabling signing later is a secrets change, not a pipeline change.
- Optional distribution through a personal tap `grundhofer/homebrew-novalis` with an unsigned cask; the main `homebrew/cask` tap is not attempted (ADR-0002).

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Enrol now (99 USD/yr) | Owner decision for the coming year; alpha users are the owner and agents |
| Sign with the existing "Apple Development" identity | Gatekeeper does not accept it for distribution; users would see the same warning |
| Tell users to disable Gatekeeper globally | Harmful advice; the per-app right-click ▸ Open is enough |
| Mac App Store distribution | Needs the same programme, plus the store build would have to resolve ADR-0001's store exception in practice |

## Consequences

- First launch shows "Apple could not verify … is free of malware"; the release note text in `docs/RELEASING.md` tells users what to do.
- No auto-update either way (ADR-0002), so unsigned builds cost nothing extra there.
- Provenance attestations and `SHA256SUMS` must be published with every release; `gh attestation verify` is the documented check.
- Revisit trigger: the first release without an `-alpha`/`-beta`/`-rc` suffix, or the owner's enrolment, whichever comes first; the amendment records the date and the certificate's team id.

**Owner approval:** 2026-09-05 — "i won't start apple developer enrolment for the upcomming year." (docs/DECISIONS.md, "Apple Developer Program: no enrolment for the coming year; releases unsigned; revisit before the first non-alpha release in 2027").

## Sources

PLAN.md §1 (premise 2), §4.5, §11.4, §14 · docs/DECISIONS.md · docs/RELEASING.md · old repository `RELEASING.md` "Unsigned-build warnings (what users see)"
