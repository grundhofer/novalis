//! `novalis cat <note>…` — notes with their frontmatter, body and links.

use std::io::Write;

use novalis_core::notes::frontmatter;
use novalis_core::notes::links::extract;
use schemars::JsonSchema;
use serde::Serialize;

use crate::cli::CatArgs;
use crate::ctx::Ctx;
use crate::error::CliError;
use crate::note::{load, parse_duration};
use crate::output::Render;
use crate::text::line_range;

/// The frontmatter keys novalis reads, plus every top-level key in file order.
#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct FrontmatterOut {
    pub title: Option<String>,
    pub tags: Vec<String>,
    pub keys: Vec<String>,
}

impl From<frontmatter::Frontmatter> for FrontmatterOut {
    fn from(f: frontmatter::Frontmatter) -> Self {
        FrontmatterOut {
            title: f.title,
            tags: f.tags,
            keys: f.keys,
        }
    }
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LinkOut {
    pub target: String,
    pub form: String,
    pub line: usize,
    pub resolved_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CatItem {
    pub path: String,
    pub title: String,
    pub link_target: String,
    pub frontmatter: FrontmatterOut,
    pub body: String,
    pub sha256: String,
    pub links: Vec<LinkOut>,
    /// What `--plain` prints for this note; never part of the JSON contract.
    #[serde(skip)]
    pub plain: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct CatOut {
    pub items: Vec<CatItem>,
    pub truncated: bool,
}

/// `--body` and `--frontmatter` narrow the JSON item to those keys; without
/// them the full shape is returned.
pub fn fields(args: &CatArgs) -> Vec<String> {
    if !args.body && !args.frontmatter {
        return Vec::new();
    }
    let mut out: Vec<String> = ["path", "title", "linkTarget", "sha256"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    if args.body {
        out.push("body".into());
    }
    if args.frontmatter {
        out.push("frontmatter".into());
    }
    out
}

pub fn run(ctx: &Ctx, args: CatArgs) -> Result<CatOut, CliError> {
    let timeout = parse_duration(&args.timeout)?;
    let stems = ctx.stem_index()?;
    let mut items = Vec::with_capacity(args.notes.len());
    for reference in &args.notes {
        let path = ctx.resolve_note(reference)?;
        let content = load(ctx, &path, args.materialize, timeout)?;
        let text = &content.text;
        let stem = novalis_core::vault::path::stem_of(&path).to_string();
        let full_body = frontmatter::body(text);

        let body = match args.lines.as_deref() {
            None => full_body.to_string(),
            Some(spec) => {
                let (a, b) = line_range(full_body, spec).ok_or_else(|| {
                    CliError::usage(format!("cannot read `{spec}` as a line range (try 10:40)"))
                })?;
                full_body[a..b].to_string()
            }
        };

        let block_end = frontmatter::block_span(text).map(|s| s.block_end);
        let plain = if args.frontmatter {
            block_end.map(|e| text[..e].to_string()).unwrap_or_default()
        } else if args.body || args.lines.is_some() {
            body.clone()
        } else {
            text.clone()
        };

        let links = extract(text)
            .into_iter()
            .map(|l| LinkOut {
                resolved_path: stems.resolve(&path, &l).path().map(str::to_owned),
                target: l.target,
                form: l.form.as_str().to_string(),
                line: l.line,
            })
            .collect();

        items.push(CatItem {
            title: frontmatter::title(text, &stem),
            link_target: stems.link_target_for(&path),
            frontmatter: frontmatter::read(text).into(),
            body,
            sha256: content.hash.clone(),
            links,
            plain,
            path,
        });
    }
    Ok(CatOut {
        items,
        truncated: false,
    })
}

impl Render for CatOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        for item in &self.items {
            w.write_all(item.plain.as_bytes())?;
            if !item.plain.is_empty() && !item.plain.ends_with('\n') {
                writeln!(w)?;
            }
        }
        Ok(())
    }
}
