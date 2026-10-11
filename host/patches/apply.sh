#!/usr/bin/env bash
# Apply the backend changes of the app to a Hermes checkout.
#
#   host/patches/apply.sh /path/to/hermes-agent
#
# Safe to run again: a checkout that has the changes already is left alone. Nothing is
# committed; the changes stay in the working tree, so `git stash` or `git checkout .` in the
# Hermes checkout takes them out again. Windows: run in Git Bash or WSL.
set -eu

target="${1:?Give the path of the Hermes checkout}"
here="$(cd "$(dirname "$0")" && pwd)"
patch="$here/hermes-backend.patch"

git -C "$target" rev-parse --git-dir >/dev/null 2>&1 || { echo "$target is not a git checkout" >&2; exit 1; }

if git -C "$target" apply --reverse --check "$patch" >/dev/null 2>&1; then
  echo "The changes are in $target already."
  exit 0
fi

if git -C "$target" apply --check "$patch" >/dev/null 2>&1; then
  git -C "$target" apply "$patch"
  echo "Applied. Restart Hermes."
  exit 0
fi

# The checkout is not on the commit the patch was made for: merge what can be merged.
if git -C "$target" apply --3way "$patch"; then
  echo "Applied with a three-way merge. Check 'git status' in $target, then restart Hermes."
  exit 0
fi

echo "The patch does not apply to this Hermes. It was made for the commit in $here/BASE." >&2
echo "Check out that commit, or see host/patches/README.md for what each part does." >&2
exit 1
