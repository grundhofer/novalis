//! One module per command, each with a `run(ctx, args) -> Result<T, CliError>`
//! whose `T` is `Serialize + JsonSchema` (PLAN.md §5.1). The clap layer calls
//! them, `help --json` publishes their schemas, and `novalis mcp` will wrap
//! the same functions in v2 (§9.5).

pub mod cat;
pub mod doctor;
pub mod edit;
pub mod help;
pub mod index;
pub mod init;
pub mod links;
pub mod ls;
pub mod meta;
pub mod migrate;
pub mod mv;
pub mod new;
pub mod relink;
pub mod rm;
pub mod search;
pub mod tags;

use schemars::schema_for;

/// The JSON Schema of one command's stdout document, or `None` for the
/// commands PLAN.md §12 still places in Phase 4.
pub fn output_schema(command: &str) -> Option<serde_json::Value> {
    let schema = match command {
        "ls" => schema_for!(ls::LsOut),
        "cat" => schema_for!(cat::CatOut),
        "new" => schema_for!(new::NewOut),
        "edit" => schema_for!(edit::EditOut),
        "meta" => schema_for!(meta::MetaOut),
        "mv" => schema_for!(mv::MvOut),
        "rm" => schema_for!(rm::RmOut),
        "search" => schema_for!(search::SearchOut),
        "links" => schema_for!(links::LinksOut),
        "tags" => schema_for!(tags::TagsOut),
        "relink" => schema_for!(relink::RelinkOut),
        "index" => schema_for!(index::IndexOut),
        "init" => schema_for!(init::InitOut),
        "doctor" => schema_for!(doctor::DoctorOut),
        "migrate" => schema_for!(migrate::MigrateOut),
        "help" => schema_for!(help::HelpOut),
        _ => return None,
    };
    serde_json::to_value(schema).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_built_command_publishes_a_schema() {
        for name in [
            "ls", "cat", "new", "edit", "meta", "migrate", "mv", "rm", "search", "links", "tags",
            "relink", "index", "init", "doctor", "help",
        ] {
            let schema = output_schema(name).unwrap_or_else(|| panic!("{name} has no schema"));
            assert!(schema.is_object(), "{name}");
        }
        for name in ["board", "card", "sync", "skill"] {
            assert!(output_schema(name).is_none(), "{name}");
        }
    }
}
