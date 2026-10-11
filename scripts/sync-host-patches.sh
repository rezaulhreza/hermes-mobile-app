#!/usr/bin/env bash
# Write host/patches/ from the Hermes checkout that the app is developed against.
#
#   HERMES_REPO=/path/to/hermes-checkout scripts/sync-host-patches.sh          # write the patch
#   HERMES_REPO=/path/to/hermes-checkout scripts/sync-host-patches.sh --check  # fail when it is stale
#
# The patch is the whole backend difference between stock Hermes (the merge base with
# HERMES_UPSTREAM, default "main") and the branch that is checked out there. Tests, apps and
# docs are left out: the patch is what a host needs to RUN, and nothing personal rides in it.
# Run this after every backend change, and commit the result with the app change that needs it.
set -eu

: "${HERMES_REPO:?Set HERMES_REPO to the Hermes checkout the app is developed against}"
upstream="${HERMES_UPSTREAM:-main}"
here="$(cd "$(dirname "$0")/.." && pwd)"
out="$here/host/patches"
# The folders a running backend loads. A new backend folder with a change must be added here.
paths="hermes_cli tools tui_gateway agent gateway cron pyproject.toml uv.lock"

base="$(git -C "$HERMES_REPO" merge-base "$upstream" HEAD)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# shellcheck disable=SC2086
git -C "$HERMES_REPO" diff --no-color "$base" HEAD -- $paths > "$tmp/hermes-backend.patch"
{
  echo "commit=$base"
  echo "date=$(git -C "$HERMES_REPO" show -s --format=%cs "$base")"
  echo "describe=$(git -C "$HERMES_REPO" describe --tags "$base" 2>/dev/null || echo unknown)"
} > "$tmp/BASE"

if [ "${1:-}" = "--check" ]; then
  if cmp -s "$tmp/hermes-backend.patch" "$out/hermes-backend.patch" && cmp -s "$tmp/BASE" "$out/BASE"; then
    echo "host/patches is in step with $HERMES_REPO"
    exit 0
  fi
  echo "host/patches is STALE: run scripts/sync-host-patches.sh and commit the result" >&2
  exit 1
fi

mkdir -p "$out"
cp "$tmp/hermes-backend.patch" "$tmp/BASE" "$out/"
echo "Wrote $out/hermes-backend.patch ($(grep -c '^diff --git' "$out/hermes-backend.patch") files) on base $(cut -c1-17 "$out/BASE" | head -1)"
