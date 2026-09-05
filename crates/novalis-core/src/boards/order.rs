//! Fractional-index order keys: a port of rocicorp/fractional-indexing
//! (`generateKeyBetween` / `generateNKeysBetween`), base-62 digits
//! `0-9A-Za-z`. Keys compare bytewise; `a0` is the first key, `a1` the next,
//! `a0V` sits between them. Only the moved card is ever re-keyed (§8.3).

use std::fmt;

const DIGITS: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const INTEGER_ZERO: &str = "a0";
const SMALLEST_INTEGER: &str = "A00000000000000000000000000";

/// An order key was malformed or the bounds were not ordered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrderError(pub String);

impl fmt::Display for OrderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for OrderError {}

fn err<T>(msg: impl Into<String>) -> Result<T, OrderError> {
    Err(OrderError(msg.into()))
}

fn digit_index(c: u8) -> Option<usize> {
    DIGITS.iter().position(|&d| d == c)
}

fn integer_length(head: u8) -> Result<usize, OrderError> {
    match head {
        b'a'..=b'z' => Ok((head - b'a') as usize + 2),
        b'A'..=b'Z' => Ok((b'Z' - head) as usize + 2),
        _ => err(format!("invalid order key head: {}", head as char)),
    }
}

fn integer_part(key: &str) -> Result<&str, OrderError> {
    let head = *key
        .as_bytes()
        .first()
        .ok_or_else(|| OrderError("empty order key".into()))?;
    let len = integer_length(head)?;
    if len > key.len() {
        return err(format!("invalid order key: {key}"));
    }
    Ok(&key[..len])
}

/// Check that `key` is a well-formed order key.
pub fn validate(key: &str) -> Result<(), OrderError> {
    if key == SMALLEST_INTEGER {
        return err(format!("invalid order key: {key}"));
    }
    if !key.bytes().all(|b| digit_index(b).is_some()) {
        return err(format!("invalid order key: {key}"));
    }
    let i = integer_part(key)?;
    let f = &key[i.len()..];
    if f.ends_with('0') {
        return err(format!("invalid order key: {key}"));
    }
    Ok(())
}

/// Midpoint of two fraction strings (`a < b`, no trailing zeros); `b == None`
/// means "no upper bound".
fn midpoint(a: &str, b: Option<&str>) -> Result<String, OrderError> {
    if let Some(b) = b {
        if a >= b {
            return err(format!("{a} >= {b}"));
        }
    }
    if a.ends_with('0') || b.is_some_and(|b| b.ends_with('0')) {
        return err("trailing zero");
    }
    if let Some(b) = b {
        // Remove the longest common prefix.
        let ab = a.as_bytes();
        let bb = b.as_bytes();
        let mut n = 0;
        while n < bb.len() && ab.get(n).copied().unwrap_or(b'0') == bb[n] {
            n += 1;
        }
        if n > 0 {
            let rest_a = if n < a.len() { &a[n..] } else { "" };
            return Ok(format!("{}{}", &b[..n], midpoint(rest_a, Some(&b[n..]))?));
        }
    }
    let digit_a = if a.is_empty() {
        0
    } else {
        digit_index(a.as_bytes()[0]).unwrap()
    };
    let digit_b = match b {
        Some(b) => digit_index(b.as_bytes()[0]).unwrap(),
        None => DIGITS.len(),
    };
    if digit_b - digit_a > 1 {
        let mid = ((digit_a + digit_b) as f64 * 0.5).round() as usize;
        return Ok((DIGITS[mid] as char).to_string());
    }
    // Consecutive first digits.
    match b {
        Some(b) if b.len() > 1 => Ok(b[..1].to_string()),
        _ => {
            let rest_a = if a.is_empty() { "" } else { &a[1..] };
            Ok(format!(
                "{}{}",
                DIGITS[digit_a] as char,
                midpoint(rest_a, None)?
            ))
        }
    }
}

fn increment_integer(x: &str) -> Result<Option<String>, OrderError> {
    if x.len() != integer_length(x.as_bytes()[0])? {
        return err(format!("invalid integer part of order key: {x}"));
    }
    let head = x.as_bytes()[0];
    let mut digs: Vec<u8> = x.as_bytes()[1..].to_vec();
    let mut carry = true;
    for i in (0..digs.len()).rev() {
        if !carry {
            break;
        }
        let d = digit_index(digs[i]).unwrap() + 1;
        if d == DIGITS.len() {
            digs[i] = b'0';
        } else {
            digs[i] = DIGITS[d];
            carry = false;
        }
    }
    if carry {
        if head == b'Z' {
            return Ok(Some("a0".to_string()));
        }
        if head == b'z' {
            return Ok(None);
        }
        let h = head + 1;
        if h > b'a' {
            digs.push(b'0');
        } else {
            digs.pop();
        }
        let mut s = String::from(h as char);
        s.push_str(std::str::from_utf8(&digs).unwrap());
        Ok(Some(s))
    } else {
        let mut s = String::from(head as char);
        s.push_str(std::str::from_utf8(&digs).unwrap());
        Ok(Some(s))
    }
}

fn decrement_integer(x: &str) -> Result<Option<String>, OrderError> {
    if x.len() != integer_length(x.as_bytes()[0])? {
        return err(format!("invalid integer part of order key: {x}"));
    }
    let head = x.as_bytes()[0];
    let mut digs: Vec<u8> = x.as_bytes()[1..].to_vec();
    let mut borrow = true;
    for i in (0..digs.len()).rev() {
        if !borrow {
            break;
        }
        match digit_index(digs[i]).unwrap().checked_sub(1) {
            None => digs[i] = DIGITS[DIGITS.len() - 1],
            Some(d) => {
                digs[i] = DIGITS[d];
                borrow = false;
            }
        }
    }
    if borrow {
        if head == b'a' {
            return Ok(Some(format!("Z{}", DIGITS[DIGITS.len() - 1] as char)));
        }
        if head == b'A' {
            return Ok(None);
        }
        let h = head - 1;
        if h < b'Z' {
            digs.push(DIGITS[DIGITS.len() - 1]);
        } else {
            digs.pop();
        }
        let mut s = String::from(h as char);
        s.push_str(std::str::from_utf8(&digs).unwrap());
        Ok(Some(s))
    } else {
        let mut s = String::from(head as char);
        s.push_str(std::str::from_utf8(&digs).unwrap());
        Ok(Some(s))
    }
}

/// A key strictly between `a` and `b` (`None` = unbounded on that side).
pub fn key_between(a: Option<&str>, b: Option<&str>) -> Result<String, OrderError> {
    if let Some(a) = a {
        validate(a)?;
    }
    if let Some(b) = b {
        validate(b)?;
    }
    if let (Some(a), Some(b)) = (a, b) {
        if a >= b {
            return err(format!("{a} >= {b}"));
        }
    }
    match (a, b) {
        (None, None) => Ok(INTEGER_ZERO.to_string()),
        (None, Some(b)) => {
            let ib = integer_part(b)?;
            let fb = &b[ib.len()..];
            if ib == SMALLEST_INTEGER {
                return Ok(format!("{ib}{}", midpoint("", Some(fb))?));
            }
            if ib < b {
                return Ok(ib.to_string());
            }
            match decrement_integer(ib)? {
                Some(k) => Ok(k),
                None => err("cannot decrement any more"),
            }
        }
        (Some(a), None) => {
            let ia = integer_part(a)?;
            let fa = &a[ia.len()..];
            match increment_integer(ia)? {
                Some(k) => Ok(k),
                None => Ok(format!("{ia}{}", midpoint(fa, None)?)),
            }
        }
        (Some(a), Some(b)) => {
            let ia = integer_part(a)?;
            let fa = &a[ia.len()..];
            let ib = integer_part(b)?;
            let fb = &b[ib.len()..];
            if ia == ib {
                return Ok(format!("{ia}{}", midpoint(fa, Some(fb))?));
            }
            match increment_integer(ia)? {
                Some(i) if i.as_str() < b => Ok(i),
                Some(_) => Ok(format!("{ia}{}", midpoint(fa, None)?)),
                None => err("cannot increment any more"),
            }
        }
    }
}

/// `n` keys strictly between `a` and `b`, ascending.
pub fn n_keys_between(
    a: Option<&str>,
    b: Option<&str>,
    n: usize,
) -> Result<Vec<String>, OrderError> {
    if n == 0 {
        return Ok(Vec::new());
    }
    if n == 1 {
        return Ok(vec![key_between(a, b)?]);
    }
    if b.is_none() {
        let mut c = key_between(a, b)?;
        let mut out = vec![c.clone()];
        for _ in 0..n - 1 {
            c = key_between(Some(&c), b)?;
            out.push(c.clone());
        }
        return Ok(out);
    }
    if a.is_none() {
        let mut c = key_between(a, b)?;
        let mut out = vec![c.clone()];
        for _ in 0..n - 1 {
            c = key_between(a, Some(&c))?;
            out.push(c.clone());
        }
        out.reverse();
        return Ok(out);
    }
    let mid = n / 2;
    let c = key_between(a, b)?;
    let mut out = n_keys_between(a, Some(&c), mid)?;
    out.push(c.clone());
    out.extend(n_keys_between(Some(&c), b, n - mid - 1)?);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kb(a: Option<&str>, b: Option<&str>) -> String {
        key_between(a, b).unwrap()
    }

    #[test]
    fn reference_vectors_from_rocicorp() {
        assert_eq!(kb(None, None), "a0");
        assert_eq!(kb(None, Some("a0")), "Zz");
        assert_eq!(kb(Some("a0"), None), "a1");
        assert_eq!(kb(Some("a0"), Some("a1")), "a0V");
        assert_eq!(kb(Some("a1"), Some("a2")), "a1V");
        assert_eq!(kb(Some("a0V"), Some("a1")), "a0l");
        assert_eq!(kb(Some("Zz"), Some("a0")), "ZzV");
        assert_eq!(kb(Some("Zz"), Some("a1")), "a0");
        assert_eq!(kb(None, Some("Y00")), "Xzzz");
        assert_eq!(kb(Some("bzz"), None), "c000");
        assert_eq!(kb(Some("a0"), Some("a0V")), "a0G");
        assert_eq!(kb(Some("a0"), Some("a0G")), "a08");
        assert_eq!(kb(Some("b125"), Some("b129")), "b127");
        assert_eq!(kb(Some("a0"), Some("a1V")), "a1");
        assert_eq!(kb(Some("Zz"), Some("a01")), "a0");
        assert_eq!(kb(None, Some("a0V")), "a0");
        assert_eq!(kb(None, Some("b999")), "b99");
        assert_eq!(
            kb(None, Some("A000000000000000000000000001")),
            "A000000000000000000000000000V"
        );
        assert_eq!(
            kb(Some("zzzzzzzzzzzzzzzzzzzzzzzzzzz"), None),
            "zzzzzzzzzzzzzzzzzzzzzzzzzzzV"
        );
    }

    #[test]
    fn invalid_inputs_are_errors() {
        assert!(key_between(None, Some("A00000000000000000000000000")).is_err());
        assert!(key_between(Some("a00"), None).is_err());
        assert!(key_between(Some("a00"), Some("a1")).is_err());
        assert!(key_between(Some("0"), Some("1")).is_err());
        assert!(key_between(Some("a1"), Some("a0")).is_err());
        assert!(key_between(Some("a0"), Some("a0")).is_err());
        assert!(validate("a0 ").is_err());
        assert!(validate("").is_err());
        assert!(validate("a0V").is_ok());
    }

    #[test]
    fn n_keys_reference_vectors() {
        let j = |v: Vec<String>| v.join(" ");
        assert_eq!(j(n_keys_between(None, None, 5).unwrap()), "a0 a1 a2 a3 a4");
        assert_eq!(
            j(n_keys_between(Some("a4"), None, 10).unwrap()),
            "a5 a6 a7 a8 a9 aA aB aC aD aE"
        );
        assert_eq!(
            j(n_keys_between(None, Some("a0"), 5).unwrap()),
            "Zv Zw Zx Zy Zz"
        );
        assert_eq!(
            j(n_keys_between(Some("a0"), Some("a2"), 20).unwrap()),
            "a04 a08 a0G a0K a0O a0V a0Z a0d a0l a0t a1 a14 a18 a1G a1O a1V a1Z a1d a1l a1t"
        );
        assert!(n_keys_between(None, None, 0).unwrap().is_empty());
    }

    #[test]
    fn generated_keys_stay_ordered_bytewise() {
        let mut prev = kb(None, None);
        for _ in 0..200 {
            let next = kb(Some(&prev), None);
            assert!(next > prev, "{next} > {prev}");
            prev = next;
        }
        let mut lo = "a0".to_string();
        let hi = "a1".to_string();
        for _ in 0..50 {
            let mid = kb(Some(&lo), Some(&hi));
            assert!(lo < mid && mid < hi);
            lo = mid;
        }
    }

    /// Two devices inserting into the same gap produce the same key; the
    /// sort order `(order, id)` still keeps the result deterministic.
    #[test]
    fn same_gap_ties_are_broken_by_id() {
        let a = kb(Some("a0"), Some("a1"));
        let b = kb(Some("a0"), Some("a1"));
        assert_eq!(a, b);
        let mut cards = [
            (b.clone(), "01K4G9Z2Q7M3N8RSTV5WXY6ZAC"),
            (a.clone(), "01K4G9Z2Q7M3N8RSTV5WXY6ZAB"),
            ("a1".to_string(), "01K4G9Z2Q7M3N8RSTV5WXY6ZAA"),
        ];
        cards.sort();
        assert_eq!(
            cards.iter().map(|c| c.1).collect::<Vec<_>>(),
            vec![
                "01K4G9Z2Q7M3N8RSTV5WXY6ZAB",
                "01K4G9Z2Q7M3N8RSTV5WXY6ZAC",
                "01K4G9Z2Q7M3N8RSTV5WXY6ZAA"
            ]
        );
    }
}
