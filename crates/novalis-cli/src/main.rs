//! `novalis` — the headless CLI of PLAN.md §9. It parses argv, discovers the
//! vault, calls exactly one `ops::*` function and turns its result into
//! stdout plus one of the nine exit codes. No prompting, no daemon, no
//! network, English only.

mod cli;
mod ctx;
mod error;
mod note;
mod ops;
mod output;
mod text;
mod util;

use std::io::{IsTerminal, Write};
use std::path::PathBuf;

use clap::{CommandFactory, Parser};
use serde::Serialize;

use crate::cli::{Cli, Command};
use crate::ctx::Ctx;
use crate::error::{CliError, EXIT_INTERNAL, EXIT_OK, EXIT_USAGE};
use crate::output::{emit_error, emit_json, emit_plain, Render};
use crate::util::retain_item_fields;

fn main() {
    let code = match run() {
        Ok(code) => code,
        Err(e) => {
            emit_error(&mut std::io::stderr(), &e.body);
            e.exit
        }
    };
    std::process::exit(code);
}

fn run() -> Result<i32, CliError> {
    let parsed = match Cli::try_parse() {
        Ok(parsed) => parsed,
        Err(e) => return from_clap(e),
    };

    // `--json` is explicit; without it, JSON is the default whenever stdout is
    // not a terminal, and `--plain` always wins (PLAN.md §9.1).
    let json = parsed.global.json || (!parsed.global.plain && !std::io::stdout().is_terminal());

    if parsed.global.no_index && parsed.command.is_mutation() {
        return Err(CliError::usage(format!(
            "--no-index is not allowed on `{}`: a mutation must not plan against a stale index",
            parsed.command.name()
        )));
    }

    let vault = if parsed.command.needs_vault() {
        Ctx::discover_for(
            parsed.global.vault.as_deref(),
            matches!(parsed.command, Command::Migrate(_)),
        )?
    } else if let Command::Init(args) = &parsed.command {
        PathBuf::from(&args.dir)
    } else {
        parsed
            .global
            .vault
            .clone()
            .unwrap_or_else(|| PathBuf::from("."))
    };

    let ctx = Ctx::new(
        vault,
        json,
        parsed.global.dry_run,
        parsed.global.no_index,
        parsed.global.quiet,
    );

    match parsed.command {
        Command::Ls(args) => {
            let fields = args.fields.clone();
            let tree = args.tree;
            let out = ops::ls::run(&ctx, args)?;
            if !ctx.json && tree {
                if !ctx.quiet {
                    let stdout = std::io::stdout();
                    let mut w = stdout.lock();
                    ops::ls::render_tree(&out, &mut w)?;
                    w.flush()?;
                }
                return Ok(EXIT_OK);
            }
            finish(&ctx, out, &fields)
        }
        Command::Cat(args) => {
            let fields = ops::cat::fields(&args);
            let out = ops::cat::run(&ctx, args)?;
            finish(&ctx, out, &fields)
        }
        Command::New(args) => finish(&ctx, ops::new::run(&ctx, args)?, &[]),
        Command::Edit(args) => finish(&ctx, ops::edit::run(&ctx, args)?, &[]),
        Command::Meta(args) => finish(&ctx, ops::meta::run(&ctx, args)?, &[]),
        Command::Mv(args) => finish(&ctx, ops::mv::run(&ctx, args)?, &[]),
        Command::Rm(args) => finish(&ctx, ops::rm::run(&ctx, args)?, &[]),
        Command::Search(args) => finish(&ctx, ops::search::run(&ctx, args)?, &[]),
        Command::Links(args) => finish(&ctx, ops::links::run(&ctx, args)?, &[]),
        Command::Tags(args) => finish(&ctx, ops::tags::run(&ctx, args)?, &[]),
        Command::Relink(args) => finish(&ctx, ops::relink::run(&ctx, args)?, &[]),
        Command::Index(args) => finish(&ctx, ops::index::run(&ctx, args)?, &[]),
        Command::Init(args) => finish(&ctx, ops::init::run(&ctx, &args.dir)?, &[]),
        Command::Doctor => finish(&ctx, ops::doctor::run(&ctx, ())?, &[]),
        Command::Migrate(args) => finish(&ctx, ops::migrate::run(&ctx, args)?, &[]),
        Command::Help => {
            if !ctx.json {
                Cli::command().print_long_help()?;
                return Ok(EXIT_OK);
            }
            finish(&ctx, ops::help::run(&ctx, ())?, &[])
        }
        // PLAN.md §12 Phase 4. They parse so a script fails on the contract,
        // not on a typo.
        other => Err(CliError::not_implemented(other.name())),
    }
}

/// Write one result and return the exit code it asks for.
fn finish<T: Serialize + Render>(ctx: &Ctx, out: T, fields: &[String]) -> Result<i32, CliError> {
    let code = out.exit_code();
    if ctx.quiet {
        return Ok(code);
    }
    let stdout = std::io::stdout();
    let mut w = stdout.lock();
    if ctx.json {
        if fields.is_empty() {
            emit_json(&mut w, &out)?;
        } else {
            let mut value = serde_json::to_value(&out)?;
            retain_item_fields(&mut value, fields);
            emit_json(&mut w, &value)?;
        }
    } else {
        emit_plain(&mut w, &out)?;
    }
    w.flush()?;
    Ok(code)
}

/// `--help` and `--version` are answers, not failures; everything else clap
/// reports becomes the usage error envelope with clap's own text inside.
fn from_clap(e: clap::Error) -> Result<i32, CliError> {
    use clap::error::ErrorKind;
    match e.kind() {
        ErrorKind::DisplayHelp | ErrorKind::DisplayVersion => {
            print!("{}", e.render());
            std::io::stdout().flush().map_err(|io| {
                CliError::internal(format!("cannot write help: {io}")).with_hint(io.to_string())
            })?;
            Ok(EXIT_OK)
        }
        // Bare `novalis` is a usage error, not an answer: a script that
        // forgot its subcommand must not see exit 0.
        ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand => {
            Err(CliError::usage("a subcommand is required")
                .with_hint("run `novalis help` for the command contract"))
        }
        _ => Err(CliError::usage(
            e.render().to_string().trim_end().to_string(),
        )),
    }
}

/// Keep the two "not a normal exit" codes referenced so a change to the
/// table is a compile error here as well.
const _: () = {
    assert!(EXIT_INTERNAL == 1);
    assert!(EXIT_USAGE == 2);
};
