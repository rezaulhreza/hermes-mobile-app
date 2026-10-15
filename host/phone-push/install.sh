#!/usr/bin/env bash
# Installs the phone-push plugin on the Hermes host. Run it from this folder, on the host.
# macOS and Linux: run as it is. Windows: run it in Git Bash or WSL, or copy this folder to
# %USERPROFILE%\.hermes\plugins\phone-push and run  hermes plugins enable phone-push
set -eu

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
here="$(cd "$(dirname "$0")" && pwd)"
target="$HERMES_HOME/plugins/phone-push"

mkdir -p "$target/dashboard" "$target/push"
cp "$here/plugin.yaml" "$here/__init__.py" "$target/"
cp "$here/push/"*.py "$target/push/"
cp "$here/dashboard/plugin_api.py" "$here/dashboard/manifest.json" "$target/dashboard/"
echo "Copied the plugin to $target"

# The enable installs the Python packages that plugin.yaml declares (h2). A plugin that is enabled
# already gets no install, so an older copy is disabled and enabled again.
enable() { hermes plugins enable phone-push </dev/null 2>&1; }
if ! command -v hermes >/dev/null 2>&1; then
  echo "No hermes command. Run  hermes plugins enable phone-push"
elif out="$(enable)"; then
  case "$out" in
    *"already enabled"*)
      if hermes plugins disable phone-push </dev/null >/dev/null 2>&1 && enable >/dev/null; then
        echo "Enabled phone-push again, with its Python packages."
      else
        echo "Could not enable it again. Run  hermes plugins enable phone-push"
      fi ;;
    *) echo "Enabled phone-push." ;;
  esac
else
  echo "Could not enable it automatically. Run  hermes plugins enable phone-push"
fi

echo "Done. Restart the Hermes backend. To remove: delete $target and run  hermes plugins disable phone-push"
