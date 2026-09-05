//! `novalis new <path>` — create a note. The title is the file stem (D22), so
//! nothing but an optional `tags:` key is ever written into the frontmatter.

use std::io::Write;

use novalis_core::notes::frontmatter;
use novalis_core::util::sha256_hex;
use novalis_core::vault::fs::create_atomic;
use novalis_core::vault::path::stem_of;
use novalis_core::CoreError;
use schemars::JsonSchema;
use serde::Serialize;

use crate::cli::NewArgs;
use crate::ctx::Ctx;
use crate::error::CliError;
use crate::output::Render;
use crate::util::text_arg;

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NewOut {
    pub path: String,
    pub stem: String,
    pub link_target: String,
    /// True when the note was already there and `--exist-ok` was passed.
    pub existing: bool,
    pub sha256: String,
    #[serde(skip_serializing_if = "crate::util::is_false")]
    pub dry_run: bool,
}

pub fn run(ctx: &Ctx, args: NewArgs) -> Result<NewOut, CliError> {
    let path = ctx.note_target(&args.path)?;
    let abs = ctx.abs(&path);
    let stem = stem_of(&path).to_string();

    let mut stems = ctx.stem_index()?.clone();
    stems.insert(&path);
    let link_target = stems.link_target_for(&path);

    if abs.exists() {
        if !args.exist_ok {
            return Err(CliError::from_core(CoreError::AlreadyExists {
                path: path.clone(),
            }));
        }
        let existing = novalis_core::vault::fs::read_bytes(&abs)?;
        return Ok(NewOut {
            path,
            stem,
            link_target,
            existing: true,
            sha256: existing.1.hash,
            dry_run: ctx.dry_run,
        });
    }

    let body = match args.content.as_deref() {
        Some(raw) => text_arg(raw)?,
        None => String::new(),
    };
    let mut text = if body.is_empty() || body.ends_with('\n') {
        body
    } else {
        format!("{body}\n")
    };
    if !args.tags.is_empty() {
        text = frontmatter::set_tags(&text, &args.tags)?;
    }

    if ctx.dry_run {
        return Ok(NewOut {
            path,
            stem,
            link_target,
            existing: false,
            sha256: sha256_hex(text.as_bytes()),
            dry_run: true,
        });
    }

    let written = create_atomic(&abs, text.as_bytes())?;
    Ok(NewOut {
        path,
        stem,
        link_target,
        existing: false,
        sha256: written.hash,
        dry_run: false,
    })
}

impl Render for NewOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        let state = if self.existing { "existing" } else { "created" };
        writeln!(w, "{state} {} [[{}]]", self.path, self.link_target)
    }
}
