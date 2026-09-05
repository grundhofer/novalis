//! Small shared helpers: hashing, timestamps, percent-encoding, host name.

use std::time::SystemTime;

use chrono::{DateTime, NaiveDateTime, Utc};
use sha2::{Digest, Sha256};

/// SHA-256 of `bytes` as lowercase hex.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(64);
    for b in digest {
        use std::fmt::Write;
        let _ = write!(out, "{b:02x}");
    }
    out
}

/// RFC 3339 UTC with millisecond precision, e.g. `2026-09-05T08:41:12.345Z`.
pub fn rfc3339_ms(t: SystemTime) -> String {
    let dt: DateTime<Utc> = t.into();
    dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// The current time formatted by [`rfc3339_ms`].
pub fn now_rfc3339_ms() -> String {
    rfc3339_ms(SystemTime::now())
}

/// Milliseconds since the Unix epoch for an RFC 3339 timestamp, or `None`
/// when it does not parse.
pub fn parse_rfc3339_ms(s: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(s.trim())
        .ok()
        .map(|d| d.timestamp_millis())
}

/// Milliseconds since the Unix epoch for `t` (0 for times before the epoch).
pub fn epoch_ms(t: SystemTime) -> i64 {
    t.duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The local wall-clock time via `localtime_r` (chrono's `clock` feature is
/// deliberately off: it would pull `iana-time-zone` and `core-foundation-sys`).
pub fn local_now() -> NaiveDateTime {
    let now = SystemTime::now();
    let secs = now
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs() as libc::time_t)
        .unwrap_or(0);
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    // SAFETY: `secs` is a valid time_t and `tm` is a writable, zeroed struct.
    let ok = unsafe { !libc::localtime_r(&secs, &mut tm).is_null() };
    if ok {
        if let Some(dt) = chrono::NaiveDate::from_ymd_opt(
            tm.tm_year + 1900,
            (tm.tm_mon + 1) as u32,
            tm.tm_mday as u32,
        )
        .and_then(|d| d.and_hms_opt(tm.tm_hour as u32, tm.tm_min as u32, tm.tm_sec as u32))
        {
            return dt;
        }
    }
    DateTime::<Utc>::from(now).naive_utc()
}

/// The machine's short host name (up to the first `.`), or `host` when it
/// cannot be determined.
pub fn hostname() -> String {
    let mut buf = [0u8; 256];
    // SAFETY: the buffer is writable and its length is passed correctly.
    let rc = unsafe { libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, buf.len()) };
    if rc != 0 {
        return "host".to_string();
    }
    let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    let name = String::from_utf8_lossy(&buf[..end]);
    let short = name.split('.').next().unwrap_or("").trim();
    if short.is_empty() {
        "host".to_string()
    } else {
        short.to_string()
    }
}

/// Percent-decode `s` (invalid sequences are kept verbatim).
pub fn percent_decode(s: &str) -> String {
    if !s.contains('%') {
        return s.to_string();
    }
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned())
}

fn needs_percent_encoding(b: u8) -> bool {
    matches!(
        b,
        b' ' | b'%' | b'#' | b'?' | b'(' | b')' | b'<' | b'>' | b'"' | b'`' | b'\\'
    ) || b < 0x20
        || b == 0x7f
}

/// Percent-encode a relative path for use inside a Markdown link
/// destination: spaces, `%`, `#`, `?`, parentheses, angle brackets, quotes,
/// backticks and control characters are encoded; `/` and non-ASCII stay.
pub fn percent_encode_path(s: &str) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        if ch.is_ascii() && needs_percent_encoding(ch as u8) {
            let _ = write!(out, "%{:02X}", ch as u8);
        } else {
            out.push(ch);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_known_vector() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(sha256_hex(b"").len(), 64);
    }

    #[test]
    fn rfc3339_roundtrip_with_millis() {
        let t = SystemTime::UNIX_EPOCH + std::time::Duration::from_millis(1_757_061_672_345);
        let s = rfc3339_ms(t);
        assert_eq!(s, "2025-09-05T08:41:12.345Z");
        assert_eq!(parse_rfc3339_ms(&s), Some(1_757_061_672_345));
        assert_eq!(
            parse_rfc3339_ms("2026-09-05T10:41:12.345+02:00"),
            parse_rfc3339_ms("2026-09-05T08:41:12.345Z")
        );
        assert_eq!(parse_rfc3339_ms("garbage"), None);
    }

    #[test]
    fn percent_codec() {
        assert_eq!(percent_decode("a%20b%2Fc"), "a b/c");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
        assert_eq!(
            percent_encode_path("Atlas Overview.md"),
            "Atlas%20Overview.md"
        );
        assert_eq!(percent_encode_path("a/b (1).md"), "a/b%20%281%29.md");
        assert_eq!(percent_encode_path("Über Nötes.md"), "Über%20Nötes.md");
        assert_eq!(
            percent_decode(&percent_encode_path("x #1 100%.md")),
            "x #1 100%.md"
        );
    }

    #[test]
    fn hostname_is_non_empty_and_short() {
        let h = hostname();
        assert!(!h.is_empty());
        assert!(!h.contains('.'));
    }

    #[test]
    fn local_now_is_close_to_utc_now() {
        let local = local_now();
        let utc = DateTime::<Utc>::from(SystemTime::now()).naive_utc();
        let diff = (local - utc).num_hours().abs();
        assert!(diff <= 14, "offset {diff}h is not a real time zone");
    }
}
