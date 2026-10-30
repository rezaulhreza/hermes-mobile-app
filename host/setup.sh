#!/usr/bin/env bash
# Set up a Hermes host for the phone app, in one command. Run it on the host:
#
#   host/setup.sh            the patch, the five plugins, two skills, the backend service, a check
#   host/setup.sh --check    change nothing: say what state the host is in
#
# Safe to run again, and the thing to run after every `hermes update`. Everything the app puts
# on a host comes from this repository (host/patches/LEDGER.md), so one stock Hermes install is
# enough: no second checkout, no branch of Hermes.
#
# What it takes from the environment:
#   HERMES_HOME         the home of Hermes                    (default: ~/.hermes)
#   HERMES_REPO         the Hermes checkout                   (default: $HERMES_HOME/hermes-agent)
#   HERMES_PHONE_PORT   the port of the backend for the phone (default: 9130)
#
# The backend service is for macOS (a launch agent). On another system the script does the rest
# and prints the command to start the backend.
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
HERMES_REPO="${HERMES_REPO:-$HERMES_HOME/hermes-agent}"
PORT="${HERMES_PHONE_PORT:-9130}"
LABEL="com.hermes.backend.mobile"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LAUNCHER="$HERMES_HOME/bin/phone-backend.sh"
PLUGINS="phone-push phone-preview screen-remote group-rooms phone-chat-list phone-shell"
check_only=false
[ "${1:-}" = "--check" ] && check_only=true

say() { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }

[ -d "$HERMES_REPO/hermes_cli" ] || { say "No Hermes checkout at $HERMES_REPO. Set HERMES_REPO."; exit 1; }
hermes_bin="$(command -v hermes || true)"
[ -n "$hermes_bin" ] || { say "No hermes command on PATH."; exit 1; }

# Who serves the port, and from which folder: the proof that the phone talks to this checkout.
served_from() {
  pid="$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1)"
  [ -n "$pid" ] || { say "nothing"; return; }
  lsof -a -p "$pid" -d cwd 2>/dev/null | awk 'NR>1 {print $NF}' | tail -1
}

report() {
  step "State of this host"
  say "Hermes checkout:  $HERMES_REPO ($(git -C "$HERMES_REPO" log -1 --format=%h 2>/dev/null || echo '?'))"
  if git -C "$HERMES_REPO" apply --reverse --check "$here/patches/hermes-backend.patch" >/dev/null 2>&1; then
    say "Patch:            applied"
  else
    say "Patch:            NOT applied"
  fi
  for name in $PLUGINS; do
    if [ -f "$HERMES_HOME/plugins/$name/dashboard/plugin_api.py" ] && cmp -s "$here/$name/dashboard/plugin_api.py" "$HERMES_HOME/plugins/$name/dashboard/plugin_api.py"; then
      say "Plugin $name: installed, same as this repository"
    else
      say "Plugin $name: missing or older than this repository"
    fi
  done
  say "Port $PORT is served from: $(served_from)"
  code="$(curl -s -m 8 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/status" || true)"
  say "GET /api/status:  $code"
}

if $check_only; then
  report
  exit 0
fi

step "1/5 The patch"
"$here/patches/apply.sh" "$HERMES_REPO"

step "2/5 The plugins"
for name in $PLUGINS; do
  HERMES_HOME="$HERMES_HOME" "$here/$name/install.sh" | sed "s/^/  [$name] /"
done

step "3/5 The skills for the agent"
# What Hermes itself must know: the shapes of the cards of the app, and what to do after an
# update. A skill names this repository, so it is written with the path of this checkout.
repo="$(cd "$here/.." && pwd)"
# Every bot (profile) has a skill folder of its own: each one gets the skills, so the answer
# is the same whichever bot the user asks.
homes="$HERMES_HOME"
for profile in "$HERMES_HOME"/profiles/*/; do
  [ -d "${profile}skills" ] && homes="$homes
${profile%/}"
done
for pair in "mobile-answer-cards:productivity" "phone-host-setup:devops" "host-security-audit:devops"; do
  name="${pair%%:*}"; category="${pair##*:}"
  count=0
  while IFS= read -r home; do
    mkdir -p "$home/skills/$category/$name"
    sed "s#{{REPO}}#$repo#g" "$here/skills/$name/SKILL.md" > "$home/skills/$category/$name/SKILL.md"
    count=$((count + 1))
  done <<EOF_HOMES
$homes
EOF_HOMES
  say "  $name -> $count skill folders (the main one and each bot)"
done

step "4/5 The backend for the phone"
if [ "$(uname)" != "Darwin" ]; then
  say "No launch agent on this system. Start the backend with:"
  say "  hermes dashboard --isolated --port $PORT --skip-build --no-open"
else
  mkdir -p "$HERMES_HOME/bin" "$HERMES_HOME/logs" "$(dirname "$PLIST")"
  cat > "$LAUNCHER" <<SH
#!/bin/sh
# Written by host/setup.sh of the hermes-native repository. Do not edit: run setup.sh again.
# Starts the Hermes backend that the phone app talks to, from the one Hermes install.
#
# \`hermes update\` restarts the backend itself. While that copy holds the port, this script
# waits in the place of failing in a loop; the launch agent runs it again and it takes the
# port back when the copy is gone.
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  sleep 30
  exit 0
fi
exec "$hermes_bin" dashboard --isolated --port $PORT --skip-build --no-open
SH
  chmod +x "$LAUNCHER"

  cat > "$PLIST" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$LAUNCHER</string></array>
  <key>WorkingDirectory</key><string>$HERMES_REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HERMES_HOME</key><string>$HERMES_HOME</string>
    <key>PATH</key><string>$(dirname "$hermes_bin"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HERMES_HOME/logs/hermes-backend-mobile.log</string>
  <key>StandardErrorPath</key><string>$HERMES_HOME/logs/hermes-backend-mobile.err.log</string>
</dict>
</plist>
XML

  # A changed plist needs a fresh load: a restart alone keeps the old command.
  uid="$(id -u)"
  launchctl bootout "gui/$uid/$LABEL" >/dev/null 2>&1 || true
  # The unload takes a moment. A load before it ends fails with "Input/output error".
  for _ in $(seq 1 20); do
    launchctl print "gui/$uid/$LABEL" >/dev/null 2>&1 || break
    sleep 1
  done
  # A copy that something else started (an update, a hand) must give the port back.
  for pid in $(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
  sleep 2
  loaded=false
  for _ in 1 2 3 4 5; do
    if launchctl bootstrap "gui/$uid" "$PLIST" >/dev/null 2>&1; then loaded=true; break; fi
    sleep 2
  done
  $loaded || { say "The launch agent did not load. Run: launchctl bootstrap gui/$uid $PLIST"; exit 1; }
  say "The launch agent $LABEL runs $LAUNCHER"
fi

step "5/5 Wait for the backend"
code=""
for _ in $(seq 1 60); do
  code="$(curl -s -m 4 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/status" || true)"
  [ "$code" = "200" ] && break
  sleep 3
done
report
[ "$code" = "200" ] || { say; say "The backend did not answer. Read $HERMES_HOME/logs/hermes-backend-mobile.err.log"; exit 1; }
say
say "Done. Check the plugins from the app (host/patches/LEDGER.md has one check for each)."
