#!/usr/bin/env bash
# Installs the screen-remote plugin on the Hermes host. Run it from this folder, on the host.
# macOS and Linux: run as it is. Windows: run it in Git Bash or WSL, or copy this folder to
# %USERPROFILE%\.hermes\plugins\screen-remote and run  hermes plugins enable screen-remote
set -eu

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
here="$(cd "$(dirname "$0")" && pwd)"
target="$HERMES_HOME/plugins/screen-remote"

mkdir -p "$target/dashboard"
cp "$here/plugin.yaml" "$here/__init__.py" "$here/hold_state.py" "$target/"
cp "$here/dashboard/plugin_api.py" "$here/dashboard/manifest.json" "$target/dashboard/"
echo "Copied the plugin to $target"

if command -v hermes >/dev/null 2>&1 && hermes plugins enable screen-remote </dev/null >/dev/null 2>&1; then
  echo "Enabled screen-remote."
else
  echo "Could not enable it automatically. Run  hermes plugins enable screen-remote"
fi

echo "Done. Restart the Hermes backend. To remove: delete $target and run  hermes plugins disable screen-remote"
