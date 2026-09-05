//! The clap 4 surface. Every flag here is one named in PLAN.md §9.2; the
//! parsing layer only turns argv into the `ops::*` argument structs.

use clap::{ArgAction, ArgGroup, Args, Parser, Subcommand, ValueEnum};

#[derive(Debug, Parser)]
#[command(
    name = "novalis",
    version,
    about = "Headless vault operations for novalis: notes, links, tags, boards.",
    long_about = None,
    disable_help_subcommand = true,
    arg_required_else_help = true
)]
pub struct Cli {
    #[command(flatten)]
    pub global: GlobalArgs,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Args)]
pub struct GlobalArgs {
    /// The vault directory. Falls back to $NOVALIS_VAULT, then to the nearest
    /// parent holding .novalis/vault.json.
    #[arg(long, global = true, value_name = "DIR")]
    pub vault: Option<std::path::PathBuf>,

    /// Force JSON on stdout. Automatic when stdout is not a terminal.
    #[arg(long, global = true, conflicts_with = "plain")]
    pub json: bool,

    /// Force text on stdout.
    #[arg(long, global = true)]
    pub plain: bool,

    /// Report what would change and write nothing.
    #[arg(long, global = true)]
    pub dry_run: bool,

    /// Skip the incremental scan on reads. Rejected on mutations.
    #[arg(long, global = true)]
    pub no_index: bool,

    /// Print nothing but errors.
    #[arg(long, short = 'q', global = true)]
    pub quiet: bool,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// List notes.
    Ls(LsArgs),
    /// Print notes with their frontmatter, body and links.
    Cat(CatArgs),
    /// Create a note. The title is the file stem.
    New(NewArgs),
    /// Rewrite a note's body atomically.
    Edit(EditArgs),
    /// Set, unset or retag frontmatter keys as line-level text edits.
    Meta(MetaArgs),
    /// Rename a note and rewrite every link and card reference to it.
    Mv(MvArgs),
    /// Move a note to the macOS Trash.
    Rm(RmArgs),
    /// Scan the vault for a literal string.
    Search(SearchArgs),
    /// Show a note's links, or the vault's unresolved links and orphans.
    Links(LinksArgs),
    /// List the tags of the vault with their note counts.
    Tags(TagsArgs),
    /// Rewrite one link target across the vault.
    Relink(RelinkArgs),
    /// Report on, or rebuild, the cache.
    Index(IndexArgs),
    /// Write .novalis/vault.json so the vault can be discovered.
    Init(InitArgs),
    /// Check the vault and report what an agent should fix.
    Doctor,
    /// Print the command contract, with --json for agents.
    Help,
    /// Boards (planned in Phase 4).
    Board(StubArgs),
    /// Cards (planned in Phase 4).
    Card(StubArgs),
    /// Migrate a vault written by the old app (planned in Phase 4).
    Migrate(StubArgs),
    /// Sync state of the vault (planned in Phase 4).
    Sync(StubArgs),
    /// Print where the agent skill lives (planned in Phase 4).
    Skill(StubArgs),
}

impl Command {
    /// The name used by `help --json`, the schema table and the error text.
    pub fn name(&self) -> &'static str {
        match self {
            Command::Ls(_) => "ls",
            Command::Cat(_) => "cat",
            Command::New(_) => "new",
            Command::Edit(_) => "edit",
            Command::Meta(_) => "meta",
            Command::Mv(_) => "mv",
            Command::Rm(_) => "rm",
            Command::Search(_) => "search",
            Command::Links(_) => "links",
            Command::Tags(_) => "tags",
            Command::Relink(_) => "relink",
            Command::Index(_) => "index",
            Command::Init(_) => "init",
            Command::Doctor => "doctor",
            Command::Help => "help",
            Command::Board(_) => "board",
            Command::Card(_) => "card",
            Command::Migrate(_) => "migrate",
            Command::Sync(_) => "sync",
            Command::Skill(_) => "skill",
        }
    }

    /// Whether this invocation writes. `--no-index` is rejected on these
    /// (PLAN.md §9.1) because a mutation must not plan against a stale index.
    pub fn is_mutation(&self) -> bool {
        match self {
            Command::Index(a) => a.rebuild,
            other => always_mutates(other.name()),
        }
    }

    /// Whether the command needs a vault. `init` creates one, `help` and the
    /// Phase-4 stubs need none.
    pub fn needs_vault(&self) -> bool {
        !matches!(self, Command::Init(_) | Command::Help | Command::Skill(_))
    }
}

/// Command names that always write. `index` is the one command that writes
/// only with a flag (`--rebuild`), so it is not in the list.
pub fn always_mutates(name: &str) -> bool {
    matches!(
        name,
        "new" | "edit" | "meta" | "mv" | "rm" | "relink" | "init"
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum LsSort {
    Path,
    Title,
    Modified,
    Size,
}

#[derive(Debug, Args)]
pub struct LsArgs {
    /// Vault-relative folder; omit for the whole vault.
    pub folder: Option<String>,
    /// Render the plain output as an indented tree.
    #[arg(long)]
    pub tree: bool,
    /// Only notes carrying this tag.
    #[arg(long, value_name = "TAG")]
    pub tag: Option<String>,
    #[arg(long, value_enum, default_value_t = LsSort::Path)]
    pub sort: LsSort,
    #[arg(long, value_name = "N")]
    pub limit: Option<usize>,
    /// Comma-separated subset of the item keys to keep.
    #[arg(long, value_name = "A,B", value_delimiter = ',')]
    pub fields: Vec<String>,
}

#[derive(Debug, Args)]
pub struct CatArgs {
    #[arg(required = true, value_name = "NOTE")]
    pub notes: Vec<String>,
    /// Only the body (frontmatter block removed).
    #[arg(long)]
    pub body: bool,
    /// Only the frontmatter keys.
    #[arg(long)]
    pub frontmatter: bool,
    /// A 1-based, inclusive line range, e.g. 10:40.
    #[arg(long, value_name = "A:B")]
    pub lines: Option<String>,
    /// Download cloud-only notes instead of failing with exit 8.
    #[arg(long)]
    pub materialize: bool,
    #[arg(long, value_name = "DURATION", default_value = "30s")]
    pub timeout: String,
}

#[derive(Debug, Args)]
pub struct NewArgs {
    /// Vault-relative path; a missing .md is added.
    pub path: String,
    /// Written into a frontmatter `tags:` key. Repeatable.
    #[arg(long = "tag", value_name = "TAG")]
    pub tags: Vec<String>,
    /// The body. `-` reads stdin.
    #[arg(long, value_name = "TEXT|-")]
    pub content: Option<String>,
    /// An existing note is success with `existing: true`.
    #[arg(long)]
    pub exist_ok: bool,
}

#[derive(Debug, Args)]
#[command(group(
    ArgGroup::new("mode")
        .required(true)
        .multiple(false)
        .args(["append", "prepend", "replace_section", "insert_after_section", "set_body", "find"])
))]
pub struct EditArgs {
    pub note: String,
    /// Append to the end of the body. `-` reads stdin.
    #[arg(long, value_name = "TEXT|-", group = "mode")]
    pub append: Option<String>,
    /// Insert directly after the frontmatter block. `-` reads stdin.
    #[arg(long, value_name = "TEXT|-", group = "mode")]
    pub prepend: Option<String>,
    /// Replace the body of the named section; needs --content.
    #[arg(long, value_name = "HEADING", group = "mode")]
    pub replace_section: Option<String>,
    /// Insert at the end of the named section; needs --content.
    #[arg(long, value_name = "HEADING", group = "mode")]
    pub insert_after_section: Option<String>,
    /// Replace the whole body, keeping the frontmatter. `-` reads stdin.
    #[arg(long, value_name = "TEXT|-", group = "mode")]
    pub set_body: Option<String>,
    /// Literal search text, or a regex with --regex; needs --replace.
    #[arg(long, value_name = "TEXT", group = "mode")]
    pub find: Option<String>,
    #[arg(long, value_name = "TEXT")]
    pub replace: Option<String>,
    /// Treat --find as a regular expression.
    #[arg(long)]
    pub regex: bool,
    /// How many matches --find must have. Defaults to 1.
    #[arg(long, value_name = "N")]
    pub expect: Option<usize>,
    /// The text for --replace-section / --insert-after-section. `-` reads stdin.
    #[arg(long, value_name = "TEXT|-")]
    pub content: Option<String>,
    /// Which of several identical headings to use, 1-based.
    #[arg(long, value_name = "N")]
    pub nth: Option<usize>,
    /// The sha256 the note must still have.
    #[arg(long, value_name = "SHA256")]
    pub if_match: Option<String>,
    #[arg(long)]
    pub materialize: bool,
}

#[derive(Debug, Args)]
pub struct MetaArgs {
    pub note: String,
    /// `key=value`. Repeatable.
    #[arg(long = "set", value_name = "KEY=VALUE")]
    pub set: Vec<String>,
    #[arg(long = "unset", value_name = "KEY")]
    pub unset: Vec<String>,
    #[arg(long = "add-tag", value_name = "TAG")]
    pub add_tag: Vec<String>,
    #[arg(long = "rm-tag", value_name = "TAG")]
    pub rm_tag: Vec<String>,
    #[arg(long, value_name = "SHA256")]
    pub if_match: Option<String>,
    #[arg(long)]
    pub materialize: bool,
}

#[derive(Debug, Args)]
pub struct MvArgs {
    pub from: String,
    pub to: String,
    /// Rename only; leave every link pointing at the old target.
    #[arg(long)]
    pub no_relink: bool,
    /// Accept cloud-only skips and dangling backlinks.
    #[arg(long)]
    pub force: bool,
    #[arg(long)]
    pub materialize: bool,
}

#[derive(Debug, Args)]
pub struct RmArgs {
    pub note: String,
    /// Delete even though notes still link here.
    #[arg(long)]
    pub force: bool,
    #[arg(long)]
    pub materialize: bool,
}

#[derive(Debug, Args)]
pub struct SearchArgs {
    pub query: String,
    /// Only notes carrying this tag (needs the cache).
    #[arg(long, value_name = "TAG")]
    pub tag: Option<String>,
    /// Only notes below this vault-relative folder.
    #[arg(long, value_name = "FOLDER")]
    pub folder: Option<String>,
    #[arg(long, value_name = "N", default_value_t = 50)]
    pub limit: usize,
    /// Include the matching line. On by default; --snippets=false drops it.
    #[arg(
        long,
        value_name = "BOOL",
        num_args = 0..=1,
        default_value_t = true,
        default_missing_value = "true",
        action = ArgAction::Set
    )]
    pub snippets: bool,
}

#[derive(Debug, Args)]
pub struct LinksArgs {
    /// The note whose links to show. Omit with --unresolved / --orphans.
    pub note: Option<String>,
    /// Every link target nothing resolves to, with its sources.
    #[arg(long, conflicts_with_all = ["note", "orphans"])]
    pub unresolved: bool,
    /// Every note nothing links to.
    #[arg(long, conflicts_with = "note")]
    pub orphans: bool,
    /// Only the backlinks section.
    #[arg(long)]
    pub backlinks: bool,
    /// Only the outgoing section.
    #[arg(long)]
    pub outgoing: bool,
}

#[derive(Debug, Args)]
pub struct TagsArgs {
    #[arg(long, value_name = "N")]
    pub limit: Option<usize>,
}

#[derive(Debug, Args)]
pub struct RelinkArgs {
    /// The literal link target to replace: wikilink text or Markdown path.
    pub from: String,
    /// The note it should point at. Must resolve.
    pub to: String,
    /// Accept cloud-only skips.
    #[arg(long)]
    pub force: bool,
    #[arg(long)]
    pub materialize: bool,
}

#[derive(Debug, Args)]
pub struct IndexArgs {
    /// Report the cache state. The default.
    #[arg(long)]
    pub status: bool,
    /// Drop every row and scan the vault again.
    #[arg(long, conflicts_with = "status")]
    pub rebuild: bool,
}

#[derive(Debug, Args)]
pub struct InitArgs {
    /// The directory to mark as a vault.
    pub dir: String,
}

/// Argument sink for the commands PLAN.md §12 places in Phase 4. They parse
/// and then fail with exit 2 so a script hits the contract, not a typo.
#[derive(Debug, Args)]
pub struct StubArgs {
    #[arg(trailing_var_arg = true, allow_hyphen_values = true, num_args = 0..)]
    pub rest: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn the_clap_surface_is_valid() {
        Cli::command().debug_assert();
    }

    #[test]
    fn mutations_are_exactly_the_writing_commands() {
        let mutating = ["new", "edit", "meta", "mv", "rm", "relink", "init"];
        for name in mutating {
            let argv: Vec<&str> = match name {
                "new" => vec!["novalis", "new", "a.md"],
                "edit" => vec!["novalis", "edit", "a", "--append", "x"],
                "meta" => vec!["novalis", "meta", "a", "--set", "k=v"],
                "mv" => vec!["novalis", "mv", "a", "b"],
                "rm" => vec!["novalis", "rm", "a"],
                "relink" => vec!["novalis", "relink", "a", "b"],
                _ => vec!["novalis", "init", "."],
            };
            let cli = Cli::try_parse_from(argv).expect(name);
            assert!(cli.command.is_mutation(), "{name}");
        }
        let read = Cli::try_parse_from(["novalis", "ls"]).unwrap();
        assert!(!read.command.is_mutation());
        let rebuild = Cli::try_parse_from(["novalis", "index", "--rebuild"]).unwrap();
        assert!(rebuild.command.is_mutation());
        let status = Cli::try_parse_from(["novalis", "index", "--status"]).unwrap();
        assert!(!status.command.is_mutation());
    }

    #[test]
    fn edit_requires_exactly_one_mode() {
        assert!(Cli::try_parse_from(["novalis", "edit", "a"]).is_err());
        assert!(
            Cli::try_parse_from(["novalis", "edit", "a", "--append", "x", "--prepend", "y"])
                .is_err()
        );
        assert!(Cli::try_parse_from(["novalis", "edit", "a", "--append", "x"]).is_ok());
    }

    #[test]
    fn snippets_defaults_on_and_can_be_switched_off() {
        let on = Cli::try_parse_from(["novalis", "search", "x"]).unwrap();
        let Command::Search(a) = on.command else {
            unreachable!()
        };
        assert!(a.snippets);
        assert_eq!(a.limit, 50);
        let off = Cli::try_parse_from(["novalis", "search", "x", "--snippets=false"]).unwrap();
        let Command::Search(a) = off.command else {
            unreachable!()
        };
        assert!(!a.snippets);
    }

    #[test]
    fn json_and_plain_cannot_both_be_asked_for() {
        assert!(Cli::try_parse_from(["novalis", "ls", "--json", "--plain"]).is_err());
    }

    #[test]
    fn phase_four_stubs_swallow_their_arguments() {
        let cli =
            Cli::try_parse_from(["novalis", "card", "add", "kanban", "--title", "x"]).unwrap();
        assert_eq!(cli.command.name(), "card");
    }
}
