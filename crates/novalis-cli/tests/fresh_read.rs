//! A read right after a write sees the write, also while the app's watcher
//! heartbeat is live (ADR-0046). Until 2026-09-29 a live heartbeat made the
//! CLI skip its scan and serve the rows from before the write.

use std::path::Path;
use std::process::Command;

use novalis_core::cache::Cache;

const BIN: &str = env!("CARGO_BIN_EXE_novalis");

fn run(home: &Path, vault: &Path, args: &[&str]) -> serde_json::Value {
    let out = Command::new(BIN)
        .env("HOME", home)
        .env_remove("NOVALIS_VAULT")
        .arg("--vault")
        .arg(vault)
        .arg("--json")
        .args(args)
        .output()
        .expect("run novalis");
    assert!(
        out.status.success(),
        "novalis {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).expect("JSON on stdout")
}

fn targets(links: &serde_json::Value) -> Vec<String> {
    links["outgoing"]
        .as_array()
        .expect("outgoing")
        .iter()
        .map(|l| l["target"].as_str().expect("target").to_string())
        .collect()
}

#[test]
fn read_after_write_is_fresh_while_the_app_is_live() {
    let tmp = tempfile::tempdir().expect("a temporary directory");
    let root = tmp.path().canonicalize().expect("canonical temp root");
    let vault = root.join("vault");
    let home = root.join("home");
    std::fs::create_dir_all(&vault).expect("create the vault");
    std::fs::create_dir_all(&home).expect("create HOME");
    std::fs::write(vault.join("a.md"), "# a\n").expect("write a");
    std::fs::write(vault.join("beta.md"), "# beta\n").expect("write beta");
    std::fs::write(vault.join("l.md"), "[[a]]\n").expect("write l");

    // Prime the cache with the first body, then stamp a live heartbeat the
    // way the app's cache actor does.
    let status = run(&home, &vault, &["index", "--status"]);
    assert_eq!(status["indexSource"], "scan");
    assert_eq!(targets(&run(&home, &vault, &["links", "l"])), ["a"]);
    let cache_path = status["cachePath"].as_str().expect("cachePath");
    Cache::open_at(Path::new(cache_path), &vault)
        .expect("open the cache")
        .touch_watcher()
        .expect("stamp the heartbeat");
    assert_eq!(
        run(&home, &vault, &["index", "--status"])["indexSource"],
        "app"
    );

    run(&home, &vault, &["edit", "l", "--set-body", "[[beta]]\n"]);
    assert_eq!(targets(&run(&home, &vault, &["links", "l"])), ["beta"]);
}
