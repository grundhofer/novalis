//! `novalis help --json` — the contract an agent reads before it drives the
//! CLI (§4.4, approved). Built from the clap tree plus the `ops` output
//! schemas, so it cannot drift from what the binary accepts.

use std::io::Write;

use clap::CommandFactory;
use schemars::JsonSchema;
use serde::Serialize;

use crate::cli::{always_mutates, Cli};
use crate::ctx::{Ctx, VAULT_ENV, VAULT_MARKER};
use crate::error::{CliError, EXIT_CODES};
use crate::ops;
use crate::output::Render;

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct FlagDoc {
    /// `--json`, or the placeholder of a positional argument.
    pub name: String,
    /// The value placeholder, null for a switch.
    pub value: Option<String>,
    pub help: String,
    pub repeatable: bool,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommandDoc {
    pub name: String,
    pub summary: String,
    pub arguments: Vec<FlagDoc>,
    pub flags: Vec<FlagDoc>,
    /// True for the commands that always write; `index` writes only with
    /// `--rebuild`.
    pub mutation: bool,
    /// The JSON Schema of this command's stdout document.
    pub output: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct ExitCodeDoc {
    pub code: i32,
    pub name: String,
    pub meaning: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HelpOut {
    pub version: String,
    /// How the vault is found, in the order it is tried.
    pub vault_discovery: Vec<String>,
    pub global_flags: Vec<FlagDoc>,
    pub commands: Vec<CommandDoc>,
    pub exit_codes: Vec<ExitCodeDoc>,
}

pub fn run(_ctx: &Ctx, _args: ()) -> Result<HelpOut, CliError> {
    let root = Cli::command();
    let global_flags = root
        .get_arguments()
        .filter(|a| a.is_global_set())
        .map(flag_doc)
        .collect();

    let mut commands = Vec::new();
    for sub in root.get_subcommands() {
        let name = sub.get_name().to_string();
        let arguments = sub
            .get_arguments()
            .filter(|a| a.is_positional())
            .map(flag_doc)
            .collect();
        let flags = sub
            .get_arguments()
            .filter(|a| !a.is_positional() && !a.is_global_set())
            .map(flag_doc)
            .collect();
        commands.push(CommandDoc {
            mutation: always_mutates(&name),
            output: ops::output_schema(&name),
            summary: sub
                .get_about()
                .map(|s| s.to_string())
                .unwrap_or_else(|| name.clone()),
            name,
            arguments,
            flags,
        });
    }
    commands.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(HelpOut {
        version: env!("CARGO_PKG_VERSION").to_string(),
        vault_discovery: vec![
            "--vault <dir>".into(),
            format!("${VAULT_ENV}"),
            format!("the nearest parent holding {VAULT_MARKER}"),
        ],
        global_flags,
        commands,
        exit_codes: EXIT_CODES
            .iter()
            .map(|(code, name, meaning)| ExitCodeDoc {
                code: *code,
                name: (*name).to_string(),
                meaning: (*meaning).to_string(),
            })
            .collect(),
    })
}

fn flag_doc(arg: &clap::Arg) -> FlagDoc {
    let name = match arg.get_long() {
        Some(long) => format!("--{long}"),
        None => arg
            .get_value_names()
            .and_then(|v| v.first().map(|s| s.to_string()))
            .unwrap_or_else(|| arg.get_id().to_string()),
    };
    let takes_value = arg
        .get_num_args()
        .map(|n| n.takes_values())
        .unwrap_or(false);
    FlagDoc {
        value: takes_value.then(|| {
            arg.get_value_names()
                .and_then(|v| v.first().map(|s| s.to_string()))
                .unwrap_or_else(|| "VALUE".to_string())
        }),
        help: arg
            .get_help()
            .map(|s| s.to_string())
            .unwrap_or_else(|| arg.get_id().to_string()),
        repeatable: matches!(arg.get_action(), clap::ArgAction::Append),
        name,
    }
}

impl Render for HelpOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        // `--plain` help is clap's own help text, which main prints instead;
        // this rendering exists so `help` is a normal op in every mode.
        writeln!(w, "novalis {}", self.version)?;
        for c in &self.commands {
            writeln!(w, "  {:<8} {}", c.name, c.summary)?;
        }
        writeln!(w)?;
        for e in &self.exit_codes {
            writeln!(w, "  {} {:<12} {}", e.code, e.name, e.meaning)?;
        }
        Ok(())
    }
}
