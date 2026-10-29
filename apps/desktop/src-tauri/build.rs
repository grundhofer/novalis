//! The four window grounds from sebaro's exported `tokens.json` (DSK-14,
//! spec/09 §13.1, ADR-0051 #22): `color.bg` light and dark, and the warm
//! tone's `variants.warm.*.bg`. They are read at build time and written to
//! `$OUT_DIR/sebaro_bg.rs`, so no colour value is ever copied into Rust. The
//! export sits in `ui/src/sebaro/` (ADOPTION §5), not in `src-tauri/sebaro/`
//! as spec/09 §13.1 assumes.

use std::{env, fs, path::PathBuf};

fn rgb(hex: &str) -> (u8, u8, u8) {
    let h = hex.trim_start_matches('#');
    assert!(h.len() == 6, "colour in tokens.json is #RRGGBB, got {hex}");
    let byte =
        |i: usize| u8::from_str_radix(&h[i..i + 2], 16).expect("colour in tokens.json is #RRGGBB");
    (byte(0), byte(2), byte(4))
}

fn main() {
    let tokens = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"))
        .join("../ui/src/sebaro/tokens.json");
    println!("cargo:rerun-if-changed={}", tokens.display());
    let text =
        fs::read_to_string(&tokens).unwrap_or_else(|e| panic!("read {}: {e}", tokens.display()));
    let json: serde_json::Value = serde_json::from_str(&text).expect("parse sebaro tokens.json");
    let at = |p: &str| {
        json.pointer(p)
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| panic!("sebaro tokens.json has no {p}"))
    };
    let (cool_light, cool_dark) = (
        rgb(at("/tokens/color.bg/light")),
        rgb(at("/tokens/color.bg/dark")),
    );
    let (warm_light, warm_dark) = (
        rgb(at("/variants/warm/light/bg")),
        rgb(at("/variants/warm/dark/bg")),
    );
    let out = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR")).join("sebaro_bg.rs");
    fs::write(
        out,
        format!(
            "/// [tone][mode]: tone 0 = cool, 1 = warm; mode 0 = light, 1 = dark \
             (sebaro tokens.json color.bg, variants.warm.*.bg).\n\
             pub const SEBARO_BG: [[(u8, u8, u8); 2]; 2] = \
             [[{cool_light:?}, {cool_dark:?}], [{warm_light:?}, {warm_dark:?}]];\n"
        ),
    )
    .expect("write sebaro_bg.rs");
    tauri_build::build();
}
