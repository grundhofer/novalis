//! Golden tests for the CLI contract (PLAN.md §11.1).
//!
//! One directory per case under `tests/cli/`:
//!
//! ```text
//! tests/cli/<case>/args           one argument per line, blank lines
//!                                    ignored; {vault} {tmp} {home} are
//!                                    substituted
//! tests/cli/<case>/stdout.golden  expected stdout, normalised
//! tests/cli/<case>/stderr.golden  expected stderr, normalised
//! tests/cli/<case>/exit           expected exit code
//! tests/cli/<case>/novault        optional marker: do not inject --vault
//! ```
//!
//! Every case gets its own copy of `fixtures/demo-vault` in a temporary
//! directory and its own `$HOME`, so the cache never leaves the test.
//! `UPDATE_GOLDEN=1 cargo test -p novalis-cli` rewrites the three files.

use std::path::{Path, PathBuf};
use std::process::Command;

const BIN: &str = env!("CARGO_BIN_EXE_novalis");

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn demo_vault() -> PathBuf {
    manifest_dir().join("../../fixtures/demo-vault")
}

fn cases_dir() -> PathBuf {
    manifest_dir().join("tests/cli")
}

fn updating() -> bool {
    std::env::var_os("UPDATE_GOLDEN").is_some_and(|v| !v.is_empty() && v != "0")
}

fn copy_dir(src: &Path, dst: &Path) {
    std::fs::create_dir_all(dst).expect("create the copy target");
    for entry in std::fs::read_dir(src).expect("read the fixture") {
        let entry = entry.expect("a fixture entry");
        let to = dst.join(entry.file_name());
        if entry.file_type().expect("file type").is_dir() {
            copy_dir(&entry.path(), &to);
        } else {
            std::fs::copy(entry.path(), &to).expect("copy a fixture file");
        }
    }
}

/// One argument per line keeps arguments with spaces (`Atlas Overview`) and
/// with `#` (`## Takeaways`) readable without a quoting dialect of its own.
/// Blank lines are skipped; there is deliberately no comment syntax, because
/// every marker would collide with a Markdown heading or a flag.
fn read_args(path: &Path, subs: &[(String, String)]) -> Vec<String> {
    let raw = std::fs::read_to_string(path).expect("read args");
    raw.lines()
        .map(str::trim_end)
        .filter(|l| !l.is_empty())
        .map(|l| {
            let mut arg = l.to_string();
            for (from, to) in subs {
                arg = arg.replace(from, to);
            }
            arg
        })
        .collect()
}

/// Make the output independent of this machine: JSON re-serialised with
/// sorted keys, then every volatile string replaced by a placeholder.
fn normalize(raw: &[u8], subs: &[(String, String)]) -> String {
    let text = String::from_utf8_lossy(raw).into_owned();
    let text = match serde_json::from_str::<serde_json::Value>(&text) {
        // `serde_json::Value` is a BTreeMap, so this both proves and enforces
        // the sorted-key property of every JSON document the CLI prints.
        Ok(value) => format!(
            "{}\n",
            serde_json::to_string_pretty(&value).expect("re-serialise")
        ),
        Err(_) => text,
    };
    let mut text = text;
    for (from, to) in subs {
        text = text.replace(from, to);
    }
    // The cache file name is a hash of the vault path, so it changes per run.
    text = replace_cache_file(&text);
    // `modified` timestamps come from the copied file's mtime.
    text = replace_timestamps(&text);
    text.replace(env!("CARGO_PKG_VERSION"), "<VERSION>")
}

fn replace_cache_file(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find("/cache/") {
        out.push_str(&rest[..at + "/cache/".len()]);
        rest = &rest[at + "/cache/".len()..];
        let key_len = rest
            .find(|c: char| !c.is_ascii_hexdigit())
            .unwrap_or(rest.len());
        if key_len == 16 && rest[key_len..].starts_with("-s") {
            out.push_str("<VAULTKEY>");
            rest = &rest[key_len..];
        }
    }
    out.push_str(rest);
    out
}

/// `2026-09-05T14:58:21.654Z` → `<TIME>`.
fn replace_timestamps(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < bytes.len() {
        if is_timestamp(&text[i..]) {
            out.push_str("<TIME>");
            i += 24;
        } else {
            let ch = text[i..].chars().next().expect("a char boundary");
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

fn is_timestamp(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() < 24 {
        return false;
    }
    let digits = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18, 20, 21, 22];
    let marks = [
        (4, b'-'),
        (7, b'-'),
        (10, b'T'),
        (13, b':'),
        (16, b':'),
        (19, b'.'),
        (23, b'Z'),
    ];
    digits.iter().all(|&i| b[i].is_ascii_digit()) && marks.iter().all(|&(i, c)| b[i] == c)
}

fn compare(case: &str, kind: &str, path: &Path, actual: &str, failures: &mut Vec<String>) {
    if updating() {
        std::fs::write(path, actual).expect("write the golden file");
        return;
    }
    let expected = std::fs::read_to_string(path).unwrap_or_default();
    if expected != actual {
        failures.push(format!(
            "--- {case} / {kind} ---\nexpected:\n{expected}\nactual:\n{actual}"
        ));
    }
}

#[test]
fn golden_cases_match() {
    let vault_fixture = demo_vault();
    assert!(
        vault_fixture.is_dir(),
        "the demo vault is missing at {}",
        vault_fixture.display()
    );

    let mut names: Vec<String> = std::fs::read_dir(cases_dir())
        .expect("read tests/cli")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert!(
        names.len() >= 12,
        "expected at least 12 cases, found {}",
        names.len()
    );

    let mut failures: Vec<String> = Vec::new();
    for case in &names {
        let dir = cases_dir().join(case);
        let tmp = tempfile::tempdir().expect("a temporary directory");
        let root = tmp.path().canonicalize().expect("canonical temp root");
        let vault = root.join("vault");
        let home = root.join("home");
        copy_dir(&vault_fixture, &vault);
        std::fs::create_dir_all(&home).expect("create HOME");

        let subs = vec![
            (vault.to_string_lossy().into_owned(), "<VAULT>".to_string()),
            (home.to_string_lossy().into_owned(), "<HOME>".to_string()),
            (root.to_string_lossy().into_owned(), "<TMP>".to_string()),
            (
                tmp.path().to_string_lossy().into_owned(),
                "<TMP>".to_string(),
            ),
        ];
        let path_subs: Vec<(String, String)> = vec![
            ("{vault}".to_string(), vault.to_string_lossy().into_owned()),
            ("{home}".to_string(), home.to_string_lossy().into_owned()),
            ("{tmp}".to_string(), root.to_string_lossy().into_owned()),
        ];

        let mut args: Vec<String> = Vec::new();
        if !dir.join("novault").exists() {
            args.push("--vault".to_string());
            args.push(vault.to_string_lossy().into_owned());
        }
        args.extend(read_args(&dir.join("args"), &path_subs));

        let output = Command::new(BIN)
            .args(&args)
            .current_dir(&root)
            .env("HOME", &home)
            .env_remove("NOVALIS_VAULT")
            .output()
            .unwrap_or_else(|e| panic!("{case}: cannot run {BIN}: {e}"));

        compare(
            case,
            "stdout",
            &dir.join("stdout.golden"),
            &normalize(&output.stdout, &subs),
            &mut failures,
        );
        compare(
            case,
            "stderr",
            &dir.join("stderr.golden"),
            &normalize(&output.stderr, &subs),
            &mut failures,
        );
        let code = output.status.code().unwrap_or(-1);
        compare(
            case,
            "exit",
            &dir.join("exit"),
            &format!("{code}\n"),
            &mut failures,
        );
    }

    assert!(
        failures.is_empty(),
        "{} golden mismatch(es); re-run with UPDATE_GOLDEN=1 once the change is intended\n\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// `help --json` is too large to keep as a golden file, but its contract —
/// one entry per subcommand, an output schema for every built command, the
/// nine exit codes — is checked here.
#[test]
fn help_json_describes_every_command() {
    let tmp = tempfile::tempdir().expect("a temporary directory");
    let output = Command::new(BIN)
        .args(["help"])
        .current_dir(tmp.path())
        .env("HOME", tmp.path())
        .env_remove("NOVALIS_VAULT")
        .output()
        .expect("run novalis help");
    assert!(output.status.success(), "help exited {:?}", output.status);

    let value: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("help --json is JSON");
    let commands = value["commands"].as_array().expect("commands array");
    let names: Vec<&str> = commands
        .iter()
        .map(|c| c["name"].as_str().expect("a name"))
        .collect();
    for expected in [
        "board", "card", "cat", "doctor", "edit", "help", "index", "init", "links", "ls", "meta",
        "migrate", "mv", "new", "relink", "rm", "search", "tags",
    ] {
        assert!(names.contains(&expected), "{expected} missing from help");
        let entry = commands
            .iter()
            .find(|c| c["name"] == expected)
            .expect("the entry");
        assert!(
            entry["output"].is_object(),
            "{expected} publishes no output schema"
        );
    }
    for planned in ["sync", "skill"] {
        assert!(names.contains(&planned), "{planned} missing from help");
    }
    assert_eq!(
        value["exitCodes"].as_array().expect("exitCodes").len(),
        9,
        "the exit-code table changed"
    );
    assert!(value["globalFlags"]
        .as_array()
        .expect("globalFlags")
        .iter()
        .any(|f| f["name"] == "--vault"));
}

/// The board and card commands on a board that holds cards. This cannot be a
/// golden case: the demo vault has no `boards/`, one case is one invocation,
/// and a card id is a fresh ULID, so nothing about `card add` is comparable
/// byte for byte.
#[test]
fn board_and_card_drive_a_real_board() {
    let tmp = tempfile::tempdir().expect("a temporary directory");
    let root = tmp.path().canonicalize().expect("canonical temp root");
    let vault = root.join("vault");
    copy_dir(&demo_vault(), &vault);
    std::fs::create_dir_all(vault.join("boards/atlas/cards")).expect("the board folder");
    std::fs::write(
        vault.join("boards/atlas/board.json"),
        r#"{"columns":[{"id":"todo","name":"To Do"},{"id":"doing","name":"Doing"}],"format":1,"name":"Atlas","updated":"2026-09-05T08:41:12.345Z"}
"#,
    )
    .expect("board.json");

    let run = |args: &[&str]| -> (serde_json::Value, i32) {
        let out = Command::new(BIN)
            .arg("--vault")
            .arg(&vault)
            .args(args)
            .current_dir(&root)
            .env("HOME", &root)
            .env_remove("NOVALIS_VAULT")
            .output()
            .unwrap_or_else(|e| panic!("cannot run {BIN}: {e}"));
        let code = out.status.code().unwrap_or(-1);
        let raw = if out.stdout.is_empty() {
            &out.stderr
        } else {
            &out.stdout
        };
        let value = serde_json::from_slice(raw)
            .unwrap_or_else(|e| panic!("{args:?} printed no JSON ({e}): {raw:?}"));
        (value, code)
    };

    let (boards, code) = run(&["board", "ls"]);
    assert_eq!(code, 0);
    assert_eq!(boards["items"][0]["slug"], "atlas");
    assert_eq!(boards["items"][0]["path"], "boards/atlas");
    assert_eq!(boards["items"][0]["cards"], 0);

    // `--dry-run` writes nothing, so it reports no id and no order key.
    let (dry, code) = run(&[
        "--dry-run",
        "card",
        "add",
        "atlas",
        "--title",
        "Ship it",
        "--column",
        "Doing",
    ]);
    assert_eq!(code, 0);
    assert_eq!(dry["dryRun"], true);
    assert_eq!(dry["card"]["column"], "doing", "a column name resolves");
    assert!(dry["card"]["id"].is_null(), "{dry}");
    assert_eq!(run(&["board", "ls"]).0["items"][0]["cards"], 0);

    let (added, code) = run(&[
        "card",
        "add",
        "atlas",
        "--title",
        "Ship it",
        "--note",
        "Atlas Overview",
    ]);
    assert_eq!(code, 0, "{added}");
    let id = added["card"]["id"].as_str().expect("a card id").to_string();
    assert_eq!(id.len(), 26, "a ULID");
    assert_eq!(added["card"]["column"], "todo", "the first column");
    assert_eq!(added["card"]["notes"][0], "projects/Atlas Overview.md");
    let updated = added["card"]["updated"]
        .as_str()
        .expect("updated")
        .to_string();

    let (listed, code) = run(&["card", "ls", "--board", "atlas", "--note", "Atlas Overview"]);
    assert_eq!(code, 0);
    assert_eq!(listed["items"].as_array().expect("items").len(), 1);
    assert_eq!(listed["items"][0]["id"], id.as_str());

    // A stale `--if-updated` is a conflict; the current one goes through.
    let (stale, code) = run(&[
        "card",
        "mv",
        &id,
        "--column",
        "doing",
        "--if-updated",
        "2020-01-01T00:00:00.000Z",
    ]);
    assert_eq!(code, 4, "{stale}");
    assert_eq!(stale["error"]["code"], "conflict");
    let (moved, code) = run(&[
        "card",
        "mv",
        &id,
        "--column",
        "doing",
        "--if-updated",
        &updated,
    ]);
    assert_eq!(code, 0, "{moved}");
    assert_eq!(moved["card"]["column"], "doing");

    let (retitled, code) = run(&["card", "set", &id, "--title", "Shipped"]);
    assert_eq!(code, 0, "{retitled}");
    assert_eq!(retitled["card"]["title"], "Shipped");

    // A column that goes away leaves its card in `orphanCards`, never lost.
    let (shrunk, code) = run(&[
        "board",
        "columns",
        "atlas",
        "--set",
        r#"[{"id":"todo","name":"To Do"}]"#,
    ]);
    assert_eq!(code, 0, "{shrunk}");
    assert_eq!(shrunk["orphanCards"][0], id.as_str());
    assert_eq!(shrunk["cards"][0]["id"], id.as_str());

    let (removed, code) = run(&["card", "rm", &id]);
    assert_eq!(code, 0, "{removed}");
    assert!(removed["card"]["deleted"].is_string(), "{removed}");
    assert!(
        vault.join(format!("boards/atlas/cards/{id}.json")).exists(),
        "the tombstone file stays"
    );
    let (empty, code) = run(&["card", "ls"]);
    assert_eq!(code, 0);
    assert!(
        empty["items"].as_array().expect("items").is_empty(),
        "a tombstone is not a card"
    );

    // An id nothing holds is exit 3, on every card command.
    for args in [
        vec!["card", "rm", "01ARZ3NDEKTSV4RRFFQ69G5FAV"],
        vec!["card", "set", "01ARZ3NDEKTSV4RRFFQ69G5FAV", "--title", "x"],
    ] {
        let (err, code) = run(&args);
        assert_eq!(code, 3, "{err}");
        assert_eq!(err["error"]["code"], "not_found");
    }
}

/// The two rules that have no output to compare: `--no-index` is refused on a
/// mutation, and a missing vault is exit 7.
#[test]
fn global_flag_rules_hold() {
    let tmp = tempfile::tempdir().expect("a temporary directory");
    let out = Command::new(BIN)
        .args(["--no-index", "--vault", ".", "new", "x.md"])
        .current_dir(tmp.path())
        .env("HOME", tmp.path())
        .env_remove("NOVALIS_VAULT")
        .output()
        .expect("run novalis");
    assert_eq!(
        out.status.code(),
        Some(2),
        "{:?}",
        String::from_utf8_lossy(&out.stderr)
    );

    let out = Command::new(BIN)
        .args(["ls"])
        .current_dir(tmp.path())
        .env("HOME", tmp.path())
        .env_remove("NOVALIS_VAULT")
        .output()
        .expect("run novalis");
    assert_eq!(out.status.code(), Some(7));
    let err: serde_json::Value =
        serde_json::from_slice(&out.stderr).expect("the error envelope is JSON");
    assert_eq!(err["error"]["code"], "no_vault");
}

/// `$NOVALIS_VAULT` is consulted after `--vault` and before the walk-up.
#[test]
fn the_environment_variable_is_a_vault_source() {
    let tmp = tempfile::tempdir().expect("a temporary directory");
    let vault = tmp.path().join("vault");
    copy_dir(&demo_vault(), &vault);
    let out = Command::new(BIN)
        .args(["tags", "--limit", "1"])
        .current_dir(tmp.path())
        .env("HOME", tmp.path())
        .env("NOVALIS_VAULT", &vault)
        .output()
        .expect("run novalis");
    assert_eq!(
        out.status.code(),
        Some(0),
        "{:?}",
        String::from_utf8_lossy(&out.stderr)
    );
    let value: serde_json::Value = serde_json::from_slice(&out.stdout).expect("json");
    assert_eq!(value["items"].as_array().expect("items").len(), 1);
}
