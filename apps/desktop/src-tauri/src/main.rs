// Release builds on Windows would otherwise open a console window. macOS is
// the only shipping target (PLAN.md §4.5), but the workspace is built on Linux
// in CI and this line costs nothing.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    novalis_desktop_lib::run();
}
