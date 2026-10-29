#!/usr/bin/env bash
# Installs the phone-chat-list plugin on the Hermes host. Run it from this folder, on the host.
# macOS and Linux: run as it is. Windows: run it in Git Bash or WSL, or copy this folder to
# %USERPROFILE%\.hermes\plugins\phone-chat-list and run  hermes plugins enable phone-chat-list
set -eu

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
here="$(cd "$(dirname "$0")" && pwd)"
target="$HERMES_HOME/plugins/phone-chat-list"

mkdir -p "$target/dashboard"
cp "$here/plugin.yaml" "$here/__init__.py" "$target/"
cp "$here/dashboard/plugin_api.py" "$here/dashboard/manifest.json" "$target/dashboard/"
echo "Copied the plugin to $target"

if command -v hermes >/dev/null 2>&1 && hermes plugins enable phone-chat-list </dev/null >/dev/null 2>&1; then
  echo "Enabled phone-chat-list."
else
  echo "Could not enable it automatically. Run  hermes plugins enable phone-chat-list"
fi

echo "Done. Restart the Hermes backend. To remove: delete $target and run  hermes plugins disable phone-chat-list"
