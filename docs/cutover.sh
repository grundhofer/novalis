#!/usr/bin/env bash
#
# novalis cut-over: replace the original Novalis on GitHub with the rewrite.
#
# This is the revised PLAN.md §13 sequence. It differs from what §13 documents
# in one important way: it never lowers branch protection. §13 granted repository
# admins an "always" bypass on ruleset 20518201 for ~10 minutes so the owner
# could admin-merge PR #94 and rename a protected default branch. Both needs are
# avoidable:
#
#   * PR #94 is merged locally into `legacy` instead of admin-merged on GitHub.
#     Its required "dependency audit" check fails on RUSTSEC-2026-0258 (h2,
#     unbounded empty DATA frames), an advisory published after that branch was
#     last built, so it could never go green as-is.
#   * `main` is not renamed. The default branch moves to `legacy` first, which
#     takes ruleset 20518201 (scoped to ~DEFAULT_BRANCH) with it and leaves the
#     old `main` unprotected, so the orphan can be force-pushed onto it.
#
# Net effect: no bypass actor is ever created, and protection is never off.
#
# Safe to re-run. Every step checks the live state first and skips if already
# done. Any failure stops the script (set -e); fix it and run again.
#
# Rollback: the pre-migration mirror is ~/Backups/novalis-premigration.git
# (old main = a00edc75a12b789952272b70e2b27f3df51230b7).

set -euo pipefail

REPO=grundhofer/novalis
NEO=/Users/sgrundhoefer/Projects/novalisNeo
OLD=/Users/sgrundhoefer/Projects/novalis
WORK=$(mktemp -d /tmp/novalis-cutover.XXXXXX)
RULESET_MAIN=20518201
OLD_MAIN_SHA=a00edc75a12b789952272b70e2b27f3df51230b7

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
skip() { printf '   already done: %s\n' "$*"; }
note() { printf '   %s\n' "$*"; }

trap 'rm -rf "$WORK"' EXIT

# ---------------------------------------------------------------------------
say "0. preflight"

gh auth status >/dev/null
note "gh authenticated"

git -C "$NEO" diff --quiet && git -C "$NEO" diff --cached --quiet \
  || { echo "ERROR: $NEO has uncommitted changes. Commit or stash first."; exit 1; }
NEO_SHA=$(git -C "$NEO" rev-parse main)
note "rewrite commit: $NEO_SHA"

REMOTE_MAIN=$(git ls-remote "git@github.com:$REPO.git" refs/heads/main | cut -f1)
if [ "$REMOTE_MAIN" = "$OLD_MAIN_SHA" ]; then
  note "remote main is still the old line ($OLD_MAIN_SHA)"
elif [ "$REMOTE_MAIN" = "$NEO_SHA" ]; then
  note "remote main is already the rewrite"
else
  echo "ERROR: remote main is $REMOTE_MAIN, which is neither the expected old"
  echo "       line ($OLD_MAIN_SHA) nor the local rewrite commit."
  echo "       Either someone else pushed, or a previous run pushed and you have"
  echo "       committed since. Refusing to force-push over it blindly."
  echo "       If the newer local commit is what you want on main, run:"
  echo "         git -C $NEO push --force origin main"
  echo "       and then re-run this script."
  exit 1
fi

# ---------------------------------------------------------------------------
say "1. freeze the old line as 'legacy' (old main + PR #94), tagged legacy-final"

if git ls-remote --exit-code "git@github.com:$REPO.git" refs/heads/legacy >/dev/null 2>&1; then
  skip "origin/legacy exists"
else
  git clone --quiet "git@github.com:$REPO.git" "$WORK/cutover"
  cd "$WORK/cutover"
  git switch -c legacy "$OLD_MAIN_SHA" --quiet

  cat > "$WORK/merge-msg.txt" <<'MSG'
Merge pull request #94 from grundhofer/fix/oauth-client-id

fix(calendar): "Connect Google" / "Connect Outlook" were dead in every installer

Merged locally during the rewrite cut-over. The branch's required
"dependency audit" check fails on RUSTSEC-2026-0258 (h2, unbounded empty
DATA frames), an advisory published after this branch was last built.
The old line is frozen here rather than fixed forward.
MSG

  git merge --no-ff origin/fix/oauth-client-id -F "$WORK/merge-msg.txt"
  git tag -a legacy-final \
    -m 'Last commit of the original Novalis (Tauri v2 + React/TipTap); superseded by the rewrite' \
    legacy
  git push origin legacy:legacy
  git push origin legacy-final
  note "pushed legacy -> $(git rev-parse --short legacy) and tag legacy-final"
  cd /
fi

# The 'legacy protection' ruleset (deletion + non_fast_forward) was created
# ahead of time, so it armed the moment the branch appeared.
if gh api "repos/$REPO/rulesets" --jq '.[].name' | grep -qx 'legacy protection'; then
  note "'legacy protection' ruleset is in place"
else
  cat > "$WORK/legacy-ruleset.json" <<'JSON'
{
  "name": "legacy protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/legacy"], "exclude": [] } },
  "rules": [ { "type": "deletion" }, { "type": "non_fast_forward" } ],
  "bypass_actors": []
}
JSON
  gh api -X POST "repos/$REPO/rulesets" --input "$WORK/legacy-ruleset.json" --jq '.id'
fi

# ---------------------------------------------------------------------------
say "2. close the 5 open pull requests"
# Must happen before main is force-pushed: these all target main, and against an
# unrelated history their diffs become meaningless.

close_pr() {
  local num=$1 msg=$2
  local state
  state=$(gh pr view "$num" -R "$REPO" --json state --jq .state 2>/dev/null || echo MISSING)
  if [ "$state" != "OPEN" ]; then skip "PR #$num ($state)"; return; fi
  # --delete-branch can fail on its own (dependabot sometimes deletes first);
  # the close is what matters, so do not let that abort the run.
  gh pr close "$num" -R "$REPO" --comment "$msg" --delete-branch \
    || gh pr close "$num" -R "$REPO" --comment "$msg"
  note "closed #$num"
}

close_pr 94 "Merged into \`legacy\` as part of the rewrite cut-over, so the fix is preserved in the frozen line. Closing here because \`main\` now holds the rewrite and this diff no longer applies to it."
for n in 91 97 98 99; do
  close_pr "$n" "Closing: \`main\` has been replaced by the novalis rewrite, which does not share a dependency tree with this branch. The original line is frozen at the \`legacy-final\` tag."
done

# ---------------------------------------------------------------------------
say "3. move the default branch to legacy (ruleset 20518201 follows it)"

DEFAULT=$(gh api "repos/$REPO" --jq .default_branch)
if [ "$DEFAULT" = "legacy" ]; then
  skip "default is legacy"
elif [ "$DEFAULT" = "main" ] && [ "$REMOTE_MAIN" = "$NEO_SHA" ]; then
  skip "default is main and main is already the rewrite"
else
  gh repo edit "$REPO" --default-branch legacy
  note "default branch -> legacy; old main is now unprotected"
fi

# ---------------------------------------------------------------------------
say "4. force-push the rewrite onto main"

REMOTE_MAIN=$(git ls-remote "git@github.com:$REPO.git" refs/heads/main | cut -f1)
if [ "$REMOTE_MAIN" = "$NEO_SHA" ]; then
  skip "main is the rewrite"
else
  git -C "$NEO" remote get-url origin >/dev/null 2>&1 \
    || git -C "$NEO" remote add origin "git@github.com:$REPO.git"
  git -C "$NEO" push --force -u origin main
  note "main -> $NEO_SHA (orphan, unrelated history)"
fi

# ---------------------------------------------------------------------------
say "5. wait for CI on main"

RUN=""
for _ in $(seq 1 30); do
  RUN=$(gh run list -R "$REPO" --branch main --workflow ci.yml --limit 10 \
        --json databaseId,headSha \
        --jq "[.[] | select(.headSha==\"$NEO_SHA\") | .databaseId] | first // empty" || true)
  [ -n "$RUN" ] && break
  sleep 5
done

if [ -z "$RUN" ]; then
  echo "ERROR: no ci.yml run appeared for $NEO_SHA after 150s."
  echo "       Check https://github.com/$REPO/actions and re-run this script."
  exit 1
fi
note "watching run $RUN"
gh run watch "$RUN" -R "$REPO" --exit-status
note "CI green"

# ---------------------------------------------------------------------------
say "6. make main the default again"

if [ "$(gh api "repos/$REPO" --jq .default_branch)" = "main" ]; then
  skip "default is main"
else
  gh repo edit "$REPO" --default-branch main
fi

# ---------------------------------------------------------------------------
say "7. point ruleset 20518201 at the new job names"
# Until this runs, the ruleset still requires "build (ubuntu-latest)",
# "build (macos-latest)", "build (windows-latest)" and "dependency audit" —
# names the new CI never reports, which would block every future PR.

gh api "repos/$REPO/rulesets/$RULESET_MAIN" > "$WORK/ruleset-current.json"
python3 - "$WORK/ruleset-current.json" "$WORK/ruleset-final.json" <<'PY'
import json, sys
src = json.load(open(sys.argv[1]))
out = {k: src[k] for k in ('name', 'target', 'enforcement', 'conditions', 'rules')}
out['bypass_actors'] = []
for rule in out['rules']:
    if rule['type'] == 'required_status_checks':
        rule['parameters']['required_status_checks'] = [
            {'context': 'check (macos-latest)'},
            {'context': 'check (ubuntu-latest)'},
            {'context': 'audit'},
        ]
json.dump(out, open(sys.argv[2], 'w'), indent=2)
PY
gh api -X PUT "repos/$REPO/rulesets/$RULESET_MAIN" --input "$WORK/ruleset-final.json" \
  --jq '{name, bypass_actors, checks: [.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context]}'

# ---------------------------------------------------------------------------
say "8. relabel the two releases (never delete: AGPL corresponding-source)"

BANNER='> **Legacy release.** This is the original Novalis (Tauri v2 + React/TipTap), frozen at the `legacy-final` tag on the `legacy` branch. `main` now holds the rewrite. Binaries and their corresponding source stay available here.'

relabel() {
  local tag=$1 title=$2; shift 2
  local body
  body=$(gh release view "$tag" -R "$REPO" --json body --jq .body)
  if printf '%s' "$body" | grep -q 'Legacy release'; then
    skip "release $tag"
  else
    printf '%s\n\n---\n\n%s\n' "$BANNER" "$body" > "$WORK/notes-$tag.md"
    gh release edit "$tag" -R "$REPO" --title "$title" --notes-file "$WORK/notes-$tag.md" "$@" >/dev/null
    note "relabelled $tag"
  fi
}

relabel v0.2.0     'Novalis v0.2.0 (legacy — original Tauri/React app)'
relabel v0.2.1-rc2 'Novalis v0.2.1-rc2 (legacy pre-release)' --prerelease

# ---------------------------------------------------------------------------
say "9. prune the 12 stale remote branches"
# The 4 dependabot branches and fix/oauth-client-id went with their closed PRs.

STALE="chore/release-hygiene deps/tiptap-3 fix/notion-asset-lookup
fix/release-macos-arm64 fix/save-path-data-loss fix/table-cell-blocks
investigate/webkitgtk-atspi release/v0.2.1-rc1 spike/e2e-xa11y
test/math-rendering test/pane-flush-contract test/save-path-guards"

for b in $STALE; do
  if git ls-remote --exit-code "git@github.com:$REPO.git" "refs/heads/$b" >/dev/null 2>&1; then
    if git push "git@github.com:$REPO.git" --delete "$b" >/dev/null 2>&1; then
      note "deleted $b"
    else
      note "FAILED to delete $b (delete it by hand)"
    fi
  else
    skip "$b"
  fi
done

# ---------------------------------------------------------------------------
say "10. repoint the old working copy at legacy"

if [ -d "$OLD/.git" ]; then
  if ! git -C "$OLD" diff --quiet || ! git -C "$OLD" diff --cached --quiet; then
    note "SKIPPED: $OLD has uncommitted changes. Rename its branch yourself:"
    note "  git -C $OLD fetch --prune && git -C $OLD branch -m main legacy"
  elif git -C "$OLD" show-ref --verify --quiet refs/heads/legacy; then
    skip "$OLD already on legacy"
  else
    git -C "$OLD" fetch --prune origin
    git -C "$OLD" branch -m main legacy
    git -C "$OLD" branch -u origin/legacy legacy
    note "$OLD: main -> legacy"
  fi
  note "local branches left in $OLD (delete by hand if you want them gone):"
  git -C "$OLD" branch --format='%(refname:short)' | grep -v '^legacy$' | sed 's/^/     /' || true
fi

# ---------------------------------------------------------------------------
say "done"
gh repo view "$REPO" --json defaultBranchRef,url --jq '"default: \(.defaultBranchRef.name)  \(.url)"'
note "verify: gh api repos/$REPO/rulesets/$RULESET_MAIN --jq '.bypass_actors'  -> []"
