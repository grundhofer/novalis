# 36. CLI: `search --regex --case-sensitive`, `cat` on a non-note file

Date: 2026-09-23

## Status

Accepted. Two flags on `search` and a new reading of one `cat` argument
form, all add-only in PLAN.md §9.2. No IPC, no setting, no dependency.

## Context

The core and the app's search panel have had regex and case-sensitive
matching since the start; the CLI hard-coded both off, so an agent could
not ask the question the app asks. And `cat notes.txt` read
`notes.txt.md`, because every argument went through note addressing — the
contract freezes at 1.0, so the reading of an exact path has to be decided
before. The owner answered the feature-gap question on 2026-09-20
(`docs/DECISIONS.md`, "Answered 2026-09-20"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

which says yes, with its own ADR, to `cli-agents-search-flags` ("CLI
`search --regex` and `--case-sensitive`") and `cli-agents-non-md-files`
("`cat <path>` tries the exact non-`.md` path first, decided before 1.0";
rows B15 and B46 of `docs/research/2026-09-20-feature-gaps.md`).

## Decision

- **`search --regex`** reads the query as a Rust `regex` pattern; one that
  does not compile is exit 2 with the parser's message. **`--case-sensitive`**
  matches case exactly. Both go straight into the core's `SearchQuery`.
- **`cat <path>`**: an argument that is the exact vault-relative path of an
  existing regular file that is not a note is read as that file — `title`
  its file name, `linkTarget` its path, `frontmatter` and `links` empty,
  `body` its text (`--lines` applies). A binary file (a NUL in the first
  8 KiB, ADR-0022) is exit 2 and not read past its head. Every other
  argument is a note reference exactly as before: `todo` is `todo.md` even
  beside a `todo.txt`. Cloud-only handling and `--materialize` apply as to
  notes.
- `new`, `edit`, `mv` and `rm` stay notes-only (ADR-0014).
- **Not built:** `ls --all-files`; writing to non-note files.

## Consequences

- PLAN.md §9.2, `SKILL.md` and `reference.md` describe both. Three golden
  cases pin the search flags; an integration test builds a vault with a
  `.txt` beside a same-stem note and a binary file for `cat`.
