#!/bin/sh
# Build the development app for the Simulator and install it, with no Metro and no tap.
#   scripts/sim-build.sh <device id>
# Use it after a change to native code (modules/, app.json plugins, a new native package).
set -e
DEVICE="${1:?device id}"
cd "$(dirname "$0")/.."
LOG="${TMPDIR:-/tmp}/hermes-native-build.log"
xcodebuild -workspace ios/Hermes.xcworkspace -scheme Hermes -configuration Debug -sdk iphonesimulator \
  -destination "id=$DEVICE" build > "$LOG" 2>&1 || { grep -E "error:" "$LOG" | head -20; echo "BUILD FAILED, log: $LOG"; exit 1; }
APP=$(ls -dt "$HOME"/Library/Developer/Xcode/DerivedData/Hermes-*/Build/Products/Debug-iphonesimulator/Hermes.app | head -1)
xcrun simctl terminate "$DEVICE" com.example.hermesnative 2>/dev/null || true
xcrun simctl install "$DEVICE" "$APP"
# A new install forgets the permission.
xcrun simctl privacy "$DEVICE" grant microphone com.example.hermesnative
xcrun simctl launch "$DEVICE" com.example.hermesnative
