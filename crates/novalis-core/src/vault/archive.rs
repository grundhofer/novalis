//! Read-only access to the entries of a zip container — EPUB and CBZ
//! (ADR-0023).
//!
//! Only bytes leave this module: what an EPUB's XHTML means is the reader's
//! business, in the UI. The archive is never extracted to disk and never
//! read whole — [`rawzip`] locates the central directory by seeking, so a
//! 500 MB comic costs one page, not 500 MB. Three rules keep a hostile file
//! from costing more than it should:
//!
//! - **Per entry, [`MAX_ENTRY_BYTES`]**, checked against the declared size
//!   *and* enforced with `take()` while inflating, because the declared size
//!   is the archive's claim and a zip bomb lies. The CRC and size are
//!   verified as the bytes arrive (`verifying_reader`), so a truncated or
//!   patched entry fails rather than half-renders.
//! - **Per read, [`MAX_READ_BYTES`]**, because the list of names is the
//!   caller's and would otherwise multiply the per-entry cap by its length.
//! - **`META-INF/encryption.xml` means DRM** ([`CoreError::Protected`]) —
//!   unless everything it encrypts is a font, which is the IDPF and Adobe
//!   font-obfuscation scheme that ordinary, unprotected books written by
//!   InDesign and Sigil use. The reader drops book fonts anyway (ADR-0023),
//!   so an obfuscated font is no reason to refuse the book.
//!
//! Reads follow the explicit-open rule of [`crate::vault::fs::read_bytes`]:
//! opening a book is a deliberate act, so a dataless one is downloaded here
//! rather than refused, and the tree's listing never touches it.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use flate2::read::DeflateDecoder;
use rawzip::{CompressionMethod, ZipArchive, ZipArchiveEntryWayfinder, RECOMMENDED_BUFFER_SIZE};

use crate::error::{CoreError, CoreResult};
use crate::vault::path::nfc;

/// The most bytes one entry may yield. A chapter is tens of kilobytes and a
/// comic page single-digit megabytes; this is far above both and far below
/// what a decompression bomb wants.
pub const MAX_ENTRY_BYTES: u64 = 64 * 1024 * 1024;

/// The most bytes one [`read`] may yield in total. The per-entry cap bounds
/// what one entry costs; this bounds what a caller can ask for at once,
/// because the list of names is the caller's and a long list would
/// otherwise multiply the cap by its length.
pub const MAX_READ_BYTES: u64 = 128 * 1024 * 1024;

/// The OCF entry that declares which parts of a book are encrypted.
const ENCRYPTION_XML: &str = "META-INF/encryption.xml";

/// The two algorithms that mean "the fonts are obfuscated", not "this book
/// is protected": the IDPF scheme and Adobe's older one.
const FONT_OBFUSCATION: &[&str] = &[
    "http://www.idpf.org/2008/embedding",
    "http://ns.adobe.com/pdf/enc#RC",
];

/// One file entry of a container.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackedEntry {
    /// The entry's name inside the archive, normalized to a relative path
    /// with forward slashes. This is the name [`read`] takes.
    pub name: String,
    /// The size the archive declares for the entry, uncompressed.
    pub size: u64,
}

/// One entry's bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackedPart {
    pub name: String,
    pub bytes: Vec<u8>,
}

/// The file entries of the container at `path`, in the archive's own order —
/// which is the page order of every CBZ that was written in one pass, and
/// means nothing in an EPUB, where the spine says the order.
///
/// Directories are left out, and so is an entry whose name is not UTF-8:
/// [`read`] addresses entries by name, so a name that cannot be spelled
/// cannot be asked for either.
pub fn list(path: &Path) -> CoreResult<Vec<PackedEntry>> {
    let (archive, mut buffer) = open(path)?;
    let rows = directory(path, &archive, &mut buffer)?;
    refuse_if_protected(path, &archive, &rows)?;
    Ok(rows
        .into_iter()
        .map(|row| PackedEntry {
            name: row.name,
            size: row.size,
        })
        .collect())
}

/// The named entries of the container at `path`, in the order they were
/// asked for.
///
/// A name the archive does not have is left out rather than failing the
/// call: a chapter that references a missing image is a broken book, not a
/// broken read, and the caller sees from what came back what is missing.
pub fn read(path: &Path, names: &[String]) -> CoreResult<Vec<PackedPart>> {
    let (archive, mut buffer) = open(path)?;
    let rows = directory(path, &archive, &mut buffer)?;
    refuse_if_protected(path, &archive, &rows)?;
    let wanted: Vec<&Row> = names
        .iter()
        .filter_map(|name| rows.iter().find(|row| &row.name == name))
        .collect();
    read_rows(path, &archive, &wanted)
}

/// The rows' bytes, within [`MAX_READ_BYTES`] for the call as a whole.
fn read_rows(path: &Path, archive: &Archive, wanted: &[&Row]) -> CoreResult<Vec<PackedPart>> {
    // What the archive says it would take, before a byte of it is inflated.
    let declared: u64 = wanted.iter().map(|row| row.size).sum();
    if declared > MAX_READ_BYTES {
        return Err(too_much(path, declared));
    }
    let mut out = Vec::with_capacity(wanted.len());
    let mut total: u64 = 0;
    for row in wanted {
        let bytes = entry_bytes(path, archive, row)?;
        // And what it really took, in case the archive was lying again.
        total += bytes.len() as u64;
        if total > MAX_READ_BYTES {
            return Err(too_much(path, total));
        }
        out.push(PackedPart {
            name: row.name.clone(),
            bytes,
        });
    }
    Ok(out)
}

/// A central-directory row, owned so the directory iterator (which borrows
/// the read buffer) can be dropped before any entry is read.
struct Row {
    name: String,
    wayfinder: ZipArchiveEntryWayfinder,
    method: CompressionMethod,
    size: u64,
}

type Archive = ZipArchive<rawzip::FileReader>;

fn open(path: &Path) -> CoreResult<(Archive, Vec<u8>)> {
    let file = File::open(path).map_err(|e| CoreError::from_io(path, e))?;
    let mut buffer = vec![0u8; RECOMMENDED_BUFFER_SIZE];
    let archive = ZipArchive::from_file(file, &mut buffer).map_err(|e| zip_error(path, e))?;
    Ok((archive, buffer))
}

fn directory(path: &Path, archive: &Archive, buffer: &mut [u8]) -> CoreResult<Vec<Row>> {
    let declared = archive.entries_hint();
    let mut rows = Vec::new();
    let mut seen: u64 = 0;
    let mut entries = archive.entries(buffer);
    while let Some(entry) = entries.next_entry().map_err(|e| zip_error(path, e))? {
        seen += 1;
        if seen > declared {
            return Err(parse_error(
                path,
                format!("the central directory holds more than the {declared} entries it declares"),
            ));
        }
        if entry.is_dir() {
            continue;
        }
        let Ok(normalized) = entry.file_path().try_normalize() else {
            continue;
        };
        let name: &str = normalized.as_ref();
        if name.is_empty() {
            continue;
        }
        // NFC like every other path at ingress (PLAN.md §5.2): a book zipped
        // on a Mac carries its names decomposed while its own OPF spells
        // them composed, and the image would be looked up and not found.
        rows.push(Row {
            name: nfc(name),
            wayfinder: entry.wayfinder(),
            method: entry.compression_method(),
            size: entry.uncompressed_size_hint(),
        });
    }
    Ok(rows)
}

/// [`CoreError::Protected`] when the container declares encryption that is
/// not font obfuscation. Costs one small read, and only when the book
/// carries an `encryption.xml` at all.
fn refuse_if_protected(path: &Path, archive: &Archive, rows: &[Row]) -> CoreResult<()> {
    let Some(row) = rows.iter().find(|row| row.name == ENCRYPTION_XML) else {
        return Ok(());
    };
    let xml = entry_bytes(path, archive, row)?;
    if declares_drm(&String::from_utf8_lossy(&xml)) {
        return Err(CoreError::Protected {
            path: path.to_string_lossy().into_owned(),
        });
    }
    Ok(())
}

/// Whether an `encryption.xml` names an algorithm that is not one of the two
/// font-obfuscation schemes. A file we cannot make sense of counts as DRM:
/// showing half a protected book is worse than saying it is protected.
fn declares_drm(xml: &str) -> bool {
    let mut algorithms = 0;
    for (index, _) in xml.match_indices("Algorithm") {
        let rest = &xml[index + "Algorithm".len()..];
        let Some(value) = quoted(rest) else { continue };
        algorithms += 1;
        if !FONT_OBFUSCATION.contains(&value) {
            return true;
        }
    }
    algorithms == 0
}

/// The first `"…"` or `'…'` in `s`, when it starts one after `=` and spaces.
fn quoted(s: &str) -> Option<&str> {
    let rest = s.trim_start();
    let rest = rest.strip_prefix('=')?.trim_start();
    let quote = rest.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let rest = &rest[quote.len_utf8()..];
    rest.find(quote).map(|end| &rest[..end])
}

/// One entry, inflated, capped and verified.
fn entry_bytes(path: &Path, archive: &Archive, row: &Row) -> CoreResult<Vec<u8>> {
    if row.size > MAX_ENTRY_BYTES {
        return Err(too_large(path, &row.name, row.size));
    }
    let entry = archive
        .get_entry(row.wayfinder)
        .map_err(|e| zip_error(path, e))?;
    let reader = entry.reader();
    // One more byte than the cap allows: the archive's declared size was
    // only its claim, and this is what catches the claim being a lie.
    let limit = MAX_ENTRY_BYTES + 1;
    let mut out = Vec::with_capacity(row.size.min(MAX_ENTRY_BYTES) as usize);
    let read = match row.method {
        CompressionMethod::STORE => entry
            .verifying_reader(reader)
            .take(limit)
            .read_to_end(&mut out),
        CompressionMethod::DEFLATE => entry
            .verifying_reader(DeflateDecoder::new(reader))
            .take(limit)
            .read_to_end(&mut out),
        other => {
            return Err(parse_error(
                path,
                format!("{}: compression method {other} is not supported", row.name),
            ))
        }
    };
    read.map_err(|e| read_error(path, &row.name, e))?;
    if out.len() as u64 > MAX_ENTRY_BYTES {
        return Err(too_large(path, &row.name, out.len() as u64));
    }
    Ok(out)
}

fn too_much(path: &Path, size: u64) -> CoreError {
    parse_error(
        path,
        format!(
            "{size} bytes were asked for at once, above the {MAX_READ_BYTES} one read may hold"
        ),
    )
}

fn too_large(path: &Path, name: &str, size: u64) -> CoreError {
    parse_error(
        path,
        format!("{name} is {size} bytes, above the {MAX_ENTRY_BYTES} an entry may hold"),
    )
}

fn parse_error(path: &Path, detail: String) -> CoreError {
    CoreError::parse(Some(&path.to_string_lossy()), detail)
}

/// An `io::Error` raised while inflating. The file is already open, so an
/// error the operating system raised is the file system's — a dataless file
/// that could not be downloaded, a disk that went away — and one it did not
/// is the archive's: a corrupt deflate stream, or the verifier refusing a
/// CRC. The book, not the machine, is then at fault.
fn read_error(path: &Path, name: &str, e: std::io::Error) -> CoreError {
    if e.raw_os_error().is_some() {
        return CoreError::from_io(path, e);
    }
    parse_error(path, format!("{name}: {e}"))
}

fn zip_error(path: &Path, e: rawzip::Error) -> CoreError {
    match e.into_kind() {
        rawzip::ErrorKind::IO(io) => CoreError::from_io(path, io),
        other => parse_error(path, other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// A zip written with rawzip's own writer, so the fixtures are data and
    /// not a checked-in binary.
    fn zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut archive = rawzip::ZipArchiveWriter::new(&mut out);
        for (name, bytes) in entries {
            let (mut entry, config) = archive
                .new_file(name)
                .compression_method(CompressionMethod::DEFLATE)
                .start()
                .unwrap();
            let encoder =
                flate2::write::DeflateEncoder::new(&mut entry, flate2::Compression::default());
            let mut writer = config.wrap(encoder);
            writer.write_all(bytes).unwrap();
            let (encoder, descriptor) = writer.finish().unwrap();
            encoder.finish().unwrap();
            entry.finish(descriptor).unwrap();
        }
        archive.finish().unwrap();
        out
    }

    fn write(dir: &std::path::Path, name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn lists_the_file_entries_and_their_sizes() {
        let tmp = tempfile::tempdir().unwrap();
        let book = write(
            tmp.path(),
            "a.epub",
            &zip(&[
                ("mimetype", b"application/epub+zip"),
                ("OEBPS/text/ch1.xhtml", b"<p>one</p>"),
            ]),
        );
        let entries = list(&book).unwrap();
        assert_eq!(
            entries,
            vec![
                PackedEntry {
                    name: "mimetype".into(),
                    size: 20
                },
                PackedEntry {
                    name: "OEBPS/text/ch1.xhtml".into(),
                    size: 10
                },
            ]
        );
    }

    #[test]
    fn reads_the_named_entries_in_order_and_skips_what_is_not_there() {
        let tmp = tempfile::tempdir().unwrap();
        let book = write(
            tmp.path(),
            "a.cbz",
            &zip(&[("p1.png", b"one"), ("p2.png", b"two")]),
        );
        let names = ["p2.png".to_string(), "gone.png".into(), "p1.png".into()];
        let parts = read(&book, &names).unwrap();
        assert_eq!(
            parts
                .iter()
                .map(|p| (p.name.as_str(), p.bytes.as_slice()))
                .collect::<Vec<_>>(),
            vec![("p2.png", b"two".as_slice()), ("p1.png", b"one".as_slice())]
        );
    }

    #[test]
    fn an_entry_above_the_cap_is_refused_before_it_is_inflated() {
        let tmp = tempfile::tempdir().unwrap();
        // Nothing that big is written: the declared size is what refuses it,
        // which is the check that keeps a bomb from ever being inflated.
        let book = write(tmp.path(), "a.cbz", &zip(&[("p1.png", b"one")]));
        let (archive, mut buffer) = open(&book).unwrap();
        let mut rows = directory(&book, &archive, &mut buffer).unwrap();
        rows[0].size = MAX_ENTRY_BYTES + 1;
        let e = entry_bytes(&book, &archive, &rows[0]).unwrap_err();
        assert_eq!(e.code(), "parse");
        assert!(e.to_string().contains("above the"), "{e}");
    }

    /// Two entries, each under the per-entry cap, together over the total.
    /// The sizes are the archive's claim, which is what the check reads, so
    /// no test has to write 128 MB to reach it.
    #[test]
    fn one_read_cannot_ask_for_more_than_the_total_cap() {
        let tmp = tempfile::tempdir().unwrap();
        let book = write(
            tmp.path(),
            "a.cbz",
            &zip(&[("p1.png", b"one"), ("p2.png", b"two"), ("p3.png", b"three")]),
        );
        let (archive, mut buffer) = open(&book).unwrap();
        let mut rows = directory(&book, &archive, &mut buffer).unwrap();
        for row in &mut rows {
            row.size = MAX_READ_BYTES / 3 + 1;
            // Each one on its own would pass; it is the sum that refuses.
            assert!(row.size < MAX_ENTRY_BYTES);
        }
        let wanted: Vec<&Row> = rows.iter().collect();
        let e = read_rows(&book, &archive, &wanted).unwrap_err();
        assert_eq!(e.code(), "parse");
        assert!(e.to_string().contains("at once"), "{e}");
        // One of them alone is still served.
        assert_eq!(read_rows(&book, &archive, &wanted[..1]).unwrap().len(), 1);
    }

    #[test]
    fn an_entry_name_is_matched_however_the_zip_spelled_its_accents() {
        let tmp = tempfile::tempdir().unwrap();
        // "Kaese.xhtml" with a decomposed umlaut, the spelling a zip written
        // on a Mac carries while the book's own OPF spells it composed.
        let book = write(
            tmp.path(),
            "a.epub",
            &zip(&[("Ka\u{0308}se.xhtml", b"<p>cheese</p>")]),
        );
        assert_eq!(list(&book).unwrap()[0].name, "K\u{e4}se.xhtml");
        let parts = read(&book, &["K\u{e4}se.xhtml".to_string()]).unwrap();
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0].bytes, b"<p>cheese</p>");
    }

    #[test]
    fn a_corrupt_entry_fails_rather_than_half_renders() {
        let tmp = tempfile::tempdir().unwrap();
        let mut bytes = zip(&[("OEBPS/ch1.xhtml", b"hello hello hello hello")]);
        // The compressed body starts after the local header and the name;
        // flipping a byte in it breaks the stream or the CRC, both of which
        // the verifying reader has to notice.
        let start = 30 + "OEBPS/ch1.xhtml".len();
        bytes[start] ^= 0xff;
        let book = write(tmp.path(), "a.epub", &bytes);
        let e = read(&book, &["OEBPS/ch1.xhtml".to_string()]).unwrap_err();
        assert_eq!(e.code(), "parse", "{e}");
    }

    #[test]
    fn a_missing_file_and_a_file_that_is_no_archive_are_told_apart() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(list(&tmp.path().join("nothing.epub"))
            .unwrap_err()
            .is_not_found());
        let not_a_zip = write(tmp.path(), "b.epub", b"this is not a zip archive");
        assert_eq!(list(&not_a_zip).unwrap_err().code(), "parse");
    }

    #[test]
    fn a_drm_protected_book_is_refused_and_an_obfuscated_font_is_not() {
        let tmp = tempfile::tempdir().unwrap();
        let drm = write(
            tmp.path(),
            "drm.epub",
            &zip(&[
                (
                    ENCRYPTION_XML,
                    br#"<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"/><CipherData><CipherReference URI="OEBPS/ch1.xhtml"/></CipherData></EncryptedData></encryption>"#,
                ),
                ("OEBPS/ch1.xhtml", b"<p>one</p>"),
            ]),
        );
        let e = list(&drm).unwrap_err();
        assert_eq!(e.code(), "protected");
        assert_eq!(e.path(), Some(drm.to_string_lossy().as_ref()));

        let fonts = write(
            tmp.path(),
            "fonts.epub",
            &zip(&[
                (
                    ENCRYPTION_XML,
                    br#"<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><CipherData><CipherReference URI="OEBPS/f.otf"/></CipherData></EncryptedData></encryption>"#,
                ),
                ("OEBPS/ch1.xhtml", b"<p>one</p>"),
            ]),
        );
        assert_eq!(list(&fonts).unwrap().len(), 2);
    }

    #[test]
    fn an_encryption_file_that_says_nothing_readable_counts_as_drm() {
        assert!(declares_drm(""));
        assert!(declares_drm("<encryption/>"));
        assert!(declares_drm(
            r#"<EncryptionMethod Algorithm = 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0#aes256' />"#
        ));
        assert!(!declares_drm(
            r#"<EncryptionMethod Algorithm='http://ns.adobe.com/pdf/enc#RC'/>"#
        ));
        // Fonts obfuscated *and* text encrypted is a protected book.
        assert!(declares_drm(
            r#"<EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"/>"#
        ));
    }
}
