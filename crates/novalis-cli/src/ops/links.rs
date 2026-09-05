//! `novalis links` — one note's links, or the vault's unresolved targets and
//! orphans. All three read the cache (D7).

use std::io::Write;

use novalis_core::boards;
use schemars::JsonSchema;
use serde::Serialize;

use crate::cli::LinksArgs;
use crate::ctx::Ctx;
use crate::error::CliError;
use crate::output::Render;

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingLink {
    pub target: String,
    pub form: String,
    pub line: usize,
    pub resolved_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct Backlink {
    pub path: String,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct CardLink {
    pub board: String,
    pub id: String,
    pub title: String,
    pub column: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct NoteLinks {
    pub path: String,
    pub outgoing: Vec<OutgoingLink>,
    pub backlinks: Vec<Backlink>,
    pub cards: Vec<CardLink>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct LinkSourceOut {
    pub path: String,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct UnresolvedItem {
    pub target: String,
    pub form: String,
    pub sources: Vec<LinkSourceOut>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct UnresolvedOut {
    pub items: Vec<UnresolvedItem>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct OrphansOut {
    pub items: Vec<String>,
    pub truncated: bool,
}

/// `links` has three shapes; which one is decided by the flags, so the JSON
/// is untagged and an agent selects on the keys it asked for.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum LinksOut {
    Note(NoteLinks),
    Unresolved(UnresolvedOut),
    Orphans(OrphansOut),
}

pub fn run(ctx: &Ctx, args: LinksArgs) -> Result<LinksOut, CliError> {
    let index = ctx.index()?;
    let cache = &index.cache;

    if args.unresolved {
        let items = cache
            .unresolved()?
            .into_iter()
            .map(|u| UnresolvedItem {
                target: u.target,
                form: u.form,
                sources: u
                    .sources
                    .into_iter()
                    .map(|s| LinkSourceOut {
                        path: s.path,
                        line: s.line,
                    })
                    .collect(),
            })
            .collect();
        return Ok(LinksOut::Unresolved(UnresolvedOut {
            items,
            truncated: false,
        }));
    }
    if args.orphans {
        return Ok(LinksOut::Orphans(OrphansOut {
            items: cache.orphans()?,
            truncated: false,
        }));
    }

    let Some(reference) = args.note.as_deref() else {
        return Err(CliError::usage(
            "links needs a note, or --unresolved / --orphans",
        ));
    };
    let path = ctx.resolve_note(reference)?;

    // Without either flag both sections are returned; either flag narrows it.
    let want_outgoing = args.outgoing || !args.backlinks;
    let want_backlinks = args.backlinks || !args.outgoing;

    let outgoing = if want_outgoing {
        cache
            .outgoing(&path)?
            .into_iter()
            .map(|l| OutgoingLink {
                target: l.target,
                form: l.form,
                line: l.line,
                resolved_path: l.resolved,
            })
            .collect()
    } else {
        Vec::new()
    };
    let backlinks = if want_backlinks {
        cache
            .backlinks(&path)?
            .into_iter()
            .map(|l| Backlink {
                path: l.src,
                line: l.line,
            })
            .collect()
    } else {
        Vec::new()
    };
    let cards = if want_backlinks {
        boards::cards_linking(&ctx.vault, &path)?
            .into_iter()
            .map(|(b, c)| CardLink {
                board: b.slug,
                id: c.id,
                title: c.title,
                column: c.column,
            })
            .collect()
    } else {
        Vec::new()
    };

    Ok(LinksOut::Note(NoteLinks {
        path,
        outgoing,
        backlinks,
        cards,
    }))
}

impl Render for LinksOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        match self {
            LinksOut::Note(n) => {
                for l in &n.outgoing {
                    writeln!(
                        w,
                        "-> {}:{} {} {}",
                        n.path,
                        l.line,
                        l.target,
                        l.resolved_path.as_deref().unwrap_or("(unresolved)")
                    )?;
                }
                for b in &n.backlinks {
                    writeln!(w, "<- {}:{}", b.path, b.line)?;
                }
                for c in &n.cards {
                    writeln!(w, "card {}/{} {} [{}]", c.board, c.id, c.title, c.column)?;
                }
            }
            LinksOut::Unresolved(u) => {
                for item in &u.items {
                    for s in &item.sources {
                        writeln!(w, "{}\t{}:{}", item.target, s.path, s.line)?;
                    }
                }
            }
            LinksOut::Orphans(o) => {
                for p in &o.items {
                    writeln!(w, "{p}")?;
                }
            }
        }
        Ok(())
    }
}
