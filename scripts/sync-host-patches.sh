#!/usr/bin/env bash
# Write host/patches/hermes-backend.patch again from a Hermes checkout that has the patch applied.
#
#   HERMES_REPO=/path/to/hermes-checkout scripts/sync-host-patches.sh          # write the patch
#   HERMES_REPO=/path/to/hermes-checkout scripts/sync-host-patches.sh --check  # does it apply?
#
# The patch is written by hand on stock Hermes (host/patches/LEDGER.md). Use this script after
# you rebuilt a hunk on new Hermes code in the checkout: it takes the uncommitted change of the
# files that the patch already names, so nothing else of the checkout can ride along, and it
# records the commit of the checkout in BASE. The comment block of each hunk is in the code, so
# it comes back with the diff. To change a NEW file of Hermes, list it in the patch by hand first.
set -eu

: "${HERMES_REPO:?Set HERMES_REPO to the Hermes checkout}"
here="$(cd "$(dirname "$0")/.." && pwd)"
out="$here/host/patches"
patch="$out/hermes-backend.patch"

if [ "${1:-}" = "--check" ]; then
  if git -C "$HERMES_REPO" apply --reverse --check "$patch" >/dev/null 2>&1; then
    echo "The patch is applied in $HERMES_REPO."
  elif git -C "$HERMES_REPO" apply --check "$patch" >/dev/null 2>&1; then
    echo "The patch applies cleanly to $HERMES_REPO."
  else
    echo "The patch does NOT apply to $HERMES_REPO: see host/patches/LEDGER.md, step 3" >&2
    exit 1
  fi
  exit 0
fi

files="$(sed -n 's#^diff --git a/\([^ ]*\) b/.*#\1#p' "$patch" | sort -u)"
[ -n "$files" ] || { echo "No file is named in $patch" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Keep the text above the first diff: git apply ignores it, a reader needs it.
sed '/^diff --git /,$d' "$patch" > "$tmp/hermes-backend.patch"
# shellcheck disable=SC2086
git -C "$HERMES_REPO" diff --no-color --full-index HEAD -- $files >> "$tmp/hermes-backend.patch"
grep -q '^diff --git ' "$tmp/hermes-backend.patch" || { echo "$HERMES_REPO has no change in: $files" >&2; exit 1; }

base="$(git -C "$HERMES_REPO" rev-parse HEAD)"
{
  echo "commit=$base"
  echo "date=$(git -C "$HERMES_REPO" show -s --format=%cs "$base")"
  echo "describe=$(git -C "$HERMES_REPO" describe --tags "$base" 2>/dev/null || echo unknown)"
} > "$tmp/BASE"

cp "$tmp/hermes-backend.patch" "$tmp/BASE" "$out/"
echo "Wrote $patch ($(grep -c '^diff --git' "$patch") files) on base $(head -1 "$out/BASE")"
