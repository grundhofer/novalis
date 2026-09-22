//! `novalis skill --path` — where the agent skill (`SKILL.md`, `reference.md`,
//! `examples.md`) lives, so an agent can find it on its own (PLAN.md §9.6).
//! Nothing is installed anywhere; the release puts the skill beside the
//! binary, and this command only says where.

use std::io::Write;
use std::path::{Path, PathBuf};

use schemars::JsonSchema;
use serde::Serialize;

use crate::error::CliError;
use crate::output::Render;

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct SkillOut {
    /// The directory holding `SKILL.md`.
    pub path: String,
}

/// Where the skill can be for a binary at `exe` (already resolved through
/// symlinks), in the order they are tried: the release tarball puts
/// `share/` beside `novalis`, a Homebrew keg puts it beside `bin/`.
pub fn candidates(exe: &Path) -> Vec<PathBuf> {
    let Some(dir) = exe.parent() else {
        return Vec::new();
    };
    let tail = Path::new("share/novalis/skill");
    let mut out = vec![dir.join(tail)];
    if let Some(up) = dir.parent() {
        out.push(up.join(tail));
    }
    out
}

pub fn run() -> Result<SkillOut, CliError> {
    // `/opt/homebrew/bin/novalis` is a symlink into the keg; the skill is
    // in the keg, not beside the link.
    let exe = std::env::current_exe()
        .and_then(|p| p.canonicalize())
        .map_err(|e| CliError::internal(format!("cannot find this binary: {e}")))?;
    candidates(&exe)
        .into_iter()
        .find(|dir| dir.join("SKILL.md").is_file())
        .map(|dir| SkillOut {
            path: dir.to_string_lossy().into_owned(),
        })
        .ok_or_else(|| {
            CliError::not_found("the agent skill is not installed beside this binary").with_hint(
                "it comes with the release tarball and with `brew install grundhofer/novalis/novalis-cli`; \
                 in a checkout it is packages/agent-skill/novalis",
            )
        })
}

impl Render for SkillOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        writeln!(w, "{}", self.path)
    }
}

#[cfg(test)]
mod tests {
    use super::candidates;
    use std::path::{Path, PathBuf};

    #[test]
    fn the_tarball_layout_first_then_the_homebrew_keg() {
        assert_eq!(
            candidates(Path::new(
                "/opt/homebrew/Cellar/novalis-cli/1.0.0/bin/novalis"
            )),
            vec![
                PathBuf::from("/opt/homebrew/Cellar/novalis-cli/1.0.0/bin/share/novalis/skill"),
                PathBuf::from("/opt/homebrew/Cellar/novalis-cli/1.0.0/share/novalis/skill"),
            ]
        );
        assert_eq!(
            candidates(Path::new("/tmp/novalis-cli-1.0.0-arm64/novalis"))[0],
            PathBuf::from("/tmp/novalis-cli-1.0.0-arm64/share/novalis/skill")
        );
    }
}
