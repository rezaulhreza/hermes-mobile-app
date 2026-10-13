#!/usr/bin/env bash
# Installs the group-rooms plugin on the Hermes host. Run it from this folder, on the host.
# macOS and Linux: run as it is. Windows: run it in Git Bash or WSL, or copy this folder to
# %USERPROFILE%\.hermes\plugins\group-rooms and run  hermes plugins enable group-rooms
set -eu

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
here="$(cd "$(dirname "$0")" && pwd)"
target="$HERMES_HOME/plugins/group-rooms"

mkdir -p "$target/dashboard"
cp "$here/plugin.yaml" "$here/__init__.py" "$target/"
cp "$here/dashboard/plugin_api.py" "$here/dashboard/manifest.json" "$target/dashboard/"
echo "Copied the plugin to $target"

if command -v hermes >/dev/null 2>&1 && hermes plugins enable group-rooms </dev/null >/dev/null 2>&1; then
  echo "Enabled group-rooms."
else
  echo "Could not enable it automatically. Run  hermes plugins enable group-rooms"
fi

echo "Done. Restart the Hermes backend. To remove: delete $target and run  hermes plugins disable group-rooms"
