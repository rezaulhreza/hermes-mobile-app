#!/usr/bin/env bash
# Apply the backend change of the phone app to a Hermes checkout.
#
#   host/patches/apply.sh /path/to/hermes-agent
#
# Safe to run again: a checkout that has the change already is left alone. Nothing is
# committed: the change stays in the working tree, so `hermes update` stashes it before the
# pull and puts it back after it. Run this again after every update (LEDGER.md says why).
# Windows: run it in Git Bash or WSL.
set -eu

target="${1:?Give the path of the Hermes checkout}"
here="$(cd "$(dirname "$0")" && pwd)"
patch="$here/hermes-backend.patch"

git -C "$target" rev-parse --git-dir >/dev/null 2>&1 || { echo "$target is not a git checkout" >&2; exit 1; }

# A conflict that an update left behind is the owner's to look at: never apply on top of it.
if git -C "$target" diff --name-only --diff-filter=U | grep -q .; then
  echo "The checkout has unresolved conflicts (git status). Resolve them first; see $here/LEDGER.md." >&2
  exit 1
fi

if git -C "$target" apply --reverse --check "$patch" >/dev/null 2>&1; then
  echo "The change is already applied in $target. Nothing to do."
  exit 0
fi

if git -C "$target" apply --check "$patch" >/dev/null 2>&1; then
  git -C "$target" apply "$patch"
  echo "Applied. Restart the Hermes backend."
  exit 0
fi

# The lines moved: merge what can be merged, and leave markers where it cannot.
if git -C "$target" apply --3way "$patch"; then
  echo "Applied with a three-way merge. Check 'git -C $target diff', then restart the Hermes backend."
  exit 0
fi

echo "The patch does not apply to this Hermes. It applies cleanly on the commit in $here/BASE." >&2
echo "Each hunk of $patch says how to tell that upstream has it and what to do on a conflict." >&2
echo "Follow step 3 of $here/LEDGER.md." >&2
exit 1
