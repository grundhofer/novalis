//! End-to-end encryption of vault file contents with the **vault key**.
//!
//! The vault key is a 32-byte symmetric secret shared only between paired
//! devices (it travels once, inside the pairing [`ticket`](super::ticket), and
//! otherwise lives in the OS keychain). File bytes are sealed with
//! XChaCha20-Poly1305 — an AEAD with a 192-bit random nonce, so we can pick
//! nonces randomly without a counter and never worry about reuse across the
//! many small messages a sync produces. Any relay or backup that carries the
//! resulting blob sees only ciphertext; without the vault key it cannot read a
//! single note. This is the property that makes the sync zero-knowledge.
//!
//! Distinct from the *device identity* ([`super::identity`]), which
//! authenticates the transport (who you're talking to) but does not by itself
//! grant the ability to read vault contents.

use chacha20poly1305::aead::{Aead, Generate, KeyInit};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
// rand 0.10 removed `rngs::OsRng` and dropped `RngCore` from the crate root.
// The OS CSPRNG is now `SysRng`, and it only implements the FALLIBLE `TryRng`,
// so an infallible `fill_bytes` has to come from an explicit adapter.
//
// `UnwrapErr` is the right adapter and the choice is security-relevant, not
// stylistic: its docs say it "implements `Rng` by panicking on potential
// errors". That reproduces rand 0.8's `OsRng::fill_bytes` semantics exactly,
// and it is what `XNonce::generate()` below already does via crypto-common.
//
// Do NOT "fix" a future compile error here with `let _ = SysRng.try_fill_bytes(..)`
// or `.ok()`. On failure that leaves the buffer ALL ZERO and mints an all-zero
// nonce or vault key — no compile error, no clippy warning, no failing test.
// A key must never be built from a short read; crashing is the correct outcome.
use rand::rand_core::UnwrapErr;
use rand::rngs::SysRng;
use rand::Rng;

use crate::error::{CoreError, CoreResult};

/// Length of the XChaCha20-Poly1305 nonce, prepended to every sealed blob.
const NONCE_LEN: usize = 24;
/// Length of the symmetric vault key.
pub const KEY_LEN: usize = 32;
/// Length of a pairing challenge nonce (see [`challenge_nonce`]).
pub const CHALLENGE_LEN: usize = 32;

/// A fresh random nonce for the proof-of-vault-key challenge an unknown peer
/// must answer before it sees a manifest. This is *application payload* the
/// peer seals — distinct from (and never reused as) the AEAD nonce that
/// [`VaultKey::seal`] generates internally per call.
pub fn challenge_nonce() -> [u8; CHALLENGE_LEN] {
    let mut n = [0u8; CHALLENGE_LEN];
    UnwrapErr(SysRng).fill_bytes(&mut n);
    n
}

/// The symmetric key that seals a vault's file contents. Shared only between
/// paired devices. `Clone` is intentional (the transport hands copies to the
/// session), but it must never be serialized into anything that leaves the
/// device except the pairing ticket.
#[derive(Clone)]
pub struct VaultKey([u8; KEY_LEN]);

impl VaultKey {
    /// Generate a fresh random vault key from the OS CSPRNG.
    pub fn generate() -> Self {
        let mut k = [0u8; KEY_LEN];
        UnwrapErr(SysRng).fill_bytes(&mut k);
        VaultKey(k)
    }

    /// Reconstruct a vault key from its raw 32 bytes (e.g. read back from the
    /// keychain or decoded from a ticket).
    pub fn from_bytes(bytes: [u8; KEY_LEN]) -> Self {
        VaultKey(bytes)
    }

    /// The raw key bytes — for persisting to the OS keychain only.
    pub fn as_bytes(&self) -> &[u8; KEY_LEN] {
        &self.0
    }

    /// Seal `plaintext`, returning `nonce || ciphertext||tag`. A fresh random
    /// nonce is generated per call, so encrypting the same bytes twice yields
    /// different blobs (and reusing a nonce is astronomically unlikely).
    pub fn seal(&self, plaintext: &[u8]) -> CoreResult<Vec<u8>> {
        let key: &Key = (&self.0).into();
        let cipher = XChaCha20Poly1305::new(key);
        let nonce = XNonce::generate();
        let ciphertext = cipher
            .encrypt(&nonce, plaintext)
            .map_err(|_| CoreError::Internal("sync: encryption failed".to_string()))?;
        let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        out.extend_from_slice(nonce.as_slice());
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }

    /// Open a blob produced by [`VaultKey::seal`]. Fails (never silently
    /// returns garbage) if the key is wrong or the ciphertext was tampered
    /// with — the Poly1305 tag is verified before any plaintext is returned.
    pub fn open(&self, blob: &[u8]) -> CoreResult<Vec<u8>> {
        if blob.len() < NONCE_LEN {
            return Err(CoreError::BadRequest(
                "sync: sealed blob is too short to contain a nonce".to_string(),
            ));
        }
        let (nonce, ciphertext) = blob.split_at(NONCE_LEN);
        let key: &Key = (&self.0).into();
        let cipher = XChaCha20Poly1305::new(key);
        // 0.11 dropped the panicking `XNonce::from_slice`. The length is already
        // guaranteed by the `blob.len() < NONCE_LEN` check plus `split_at`, so
        // this conversion cannot fail — but it is fallible in the type system,
        // and a malformed blob is a caller error, not an internal one.
        let nonce = XNonce::try_from(nonce).map_err(|_| {
            CoreError::BadRequest("sync: sealed blob has a malformed nonce".to_string())
        })?;
        cipher.decrypt(&nonce, ciphertext).map_err(|_| {
            CoreError::BadRequest(
                "sync: decryption failed (wrong vault key or corrupted data)".to_string(),
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_arbitrary_bytes() {
        let key = VaultKey::generate();
        for body in [
            &b""[..],
            b"hello",
            &[0u8; 4096][..],
            "# Note\n\ncontent".as_bytes(),
        ] {
            let sealed = key.seal(body).unwrap();
            assert_eq!(key.open(&sealed).unwrap(), body);
        }
    }

    #[test]
    fn nonce_is_prepended_and_ciphertext_differs_from_plaintext() {
        let key = VaultKey::generate();
        let body = b"secret note body";
        let sealed = key.seal(body).unwrap();
        assert!(
            sealed.len() > NONCE_LEN + body.len(),
            "must carry nonce + tag"
        );
        assert!(
            !sealed.windows(body.len()).any(|w| w == body),
            "plaintext must not appear in the sealed blob"
        );
    }

    #[test]
    fn same_plaintext_seals_to_different_blobs() {
        let key = VaultKey::generate();
        let a = key.seal(b"same").unwrap();
        let b = key.seal(b"same").unwrap();
        assert_ne!(a, b, "random nonce must make repeated seals differ");
    }

    #[test]
    fn wrong_key_cannot_open() {
        let sealed = VaultKey::generate().seal(b"top secret").unwrap();
        let err = VaultKey::generate().open(&sealed).unwrap_err();
        assert!(matches!(err, CoreError::BadRequest(_)), "got: {err:?}");
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let key = VaultKey::generate();
        let mut sealed = key.seal(b"authentic").unwrap();
        // Flip a bit in the ciphertext body (past the nonce).
        let last = sealed.len() - 1;
        sealed[last] ^= 0x01;
        assert!(key.open(&sealed).is_err(), "AEAD tag must reject tampering");
    }

    #[test]
    fn from_bytes_reconstructs_a_usable_key() {
        let key = VaultKey::generate();
        let sealed = key.seal(b"persisted").unwrap();
        let restored = VaultKey::from_bytes(*key.as_bytes());
        assert_eq!(restored.open(&sealed).unwrap(), b"persisted");
    }

    #[test]
    fn too_short_blob_is_a_bad_request_not_a_panic() {
        let key = VaultKey::generate();
        assert!(key.open(&[0u8; 8]).is_err());
    }

    #[test]
    fn challenge_nonces_are_random_per_call() {
        assert_ne!(challenge_nonce(), challenge_nonce());
    }

    /// Guards the one failure mode the rand 0.10 migration introduces the
    /// opportunity for: `SysRng` is fallible now, and swallowing the error
    /// (`let _ = …try_fill_bytes(..)`, `.ok()`) leaves the buffer untouched —
    /// i.e. an all-zero vault key, with no compile error and no clippy warning.
    /// `DeviceIdentity` has had this check; the vault key only had it
    /// indirectly, via `wrong_key_cannot_open` happening to compare two keys.
    #[test]
    fn generated_key_and_challenge_are_not_all_zero() {
        let a = VaultKey::generate();
        let b = VaultKey::generate();
        assert_ne!(a.as_bytes(), &[0u8; KEY_LEN], "vault key is all zero");
        assert_ne!(a.as_bytes(), b.as_bytes(), "two keys came out identical");
        assert_ne!(challenge_nonce(), [0u8; CHALLENGE_LEN], "nonce is all zero");
    }
}
