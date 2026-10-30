#!/bin/sh
# Build the release app for iOS and send it to TestFlight, on this machine.
#
#   scripts/release-ios.sh archive    build and sign the archive only
#   scripts/release-ios.sh upload     build, sign and upload to App Store Connect
#
# Every value that belongs to you comes from an environment file OUTSIDE the tree
# (default: ~/.config/hermes-native/release.env, or the path in HERMES_RELEASE_ENV):
#
#   HERMES_BUNDLE_ID      your bundle identifier (an App ID and an app record must exist for it)
#   HERMES_APP_VERSION    the version a person reads, for example 2.0
#   HERMES_BUILD_NUMBER   higher than every build App Store Connect holds
#                         (the script adds one to it in the file after each upload)
#   HERMES_APPLE_TEAM     your team identifier
#   HERMES_PUSH_MODE      production
#   HERMES_PROFILE_NAME   the name of your App Store provisioning profile for the bundle identifier
#   ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID   an App Store Connect API key with the Admin role
#
# The script writes your values into the generated ios/ folder (not in git) for the build and
# puts the placeholder back when it ends, also after a failure.
set -eu
# CocoaPods crashes without a UTF-8 locale (a shell started by a tool often has none).
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

MODE="${1:?archive or upload}"
ENV_FILE="${HERMES_RELEASE_ENV:-$HOME/.config/hermes-native/release.env}"
[ -f "$ENV_FILE" ] || { echo "No environment file at $ENV_FILE"; exit 2; }
set -a
. "$ENV_FILE"
set +a
for name in HERMES_BUNDLE_ID HERMES_APP_VERSION HERMES_BUILD_NUMBER HERMES_APPLE_TEAM HERMES_PROFILE_NAME ASC_KEY_PATH ASC_KEY_ID ASC_ISSUER_ID; do
  eval "[ -n \"\${$name:-}\" ]" || { echo "$name is not set in $ENV_FILE"; exit 2; }
done

cd "$(dirname "$0")/.."
WORK="${TMPDIR:-/tmp}/hermes-native-release"
ARCHIVE="$WORK/Hermes.xcarchive"
LOG="$WORK/build.log"
rm -rf "$WORK"
mkdir -p "$WORK"

restore() {
  # The placeholder again: the development build keeps its own identifier.
  env -u HERMES_BUNDLE_ID -u HERMES_APP_NAME -u HERMES_APP_VERSION -u HERMES_BUILD_NUMBER -u HERMES_APPLE_TEAM -u HERMES_PUSH_MODE \
    npx expo prebuild -p ios --no-install > "$WORK/restore.log" 2>&1 || echo "Could not put the placeholder back: run  npx expo prebuild -p ios"
}
trap restore EXIT

echo "1/4 Writing your values into ios/"
npx expo prebuild -p ios --no-install > "$WORK/prebuild.log" 2>&1
(cd ios && pod install > "$WORK/pods.log" 2>&1)

echo "2/4 Archiving (about ten minutes)"
xcodebuild -workspace ios/Hermes.xcworkspace -scheme Hermes -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates DEVELOPMENT_TEAM="$HERMES_APPLE_TEAM" \
  -authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
  archive > "$LOG" 2>&1 || { grep -E "error:" "$LOG" | head -20; echo "ARCHIVE FAILED, log: $LOG"; exit 1; }

echo "3/4 The archive: $ARCHIVE"
/usr/libexec/PlistBuddy -c "Print :ApplicationProperties:CFBundleShortVersionString" -c "Print :ApplicationProperties:CFBundleVersion" "$ARCHIVE/Info.plist"

[ "$MODE" = "upload" ] || { echo "Not uploaded (mode: $MODE)."; exit 0; }

# Manual signing with the named App Store profile: automatic signing wants cloud signing,
# which an API key is refused for. The build number is set by hand, so Xcode must not manage it.
cat > "$WORK/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$HERMES_APPLE_TEAM</string>
  <key>signingStyle</key><string>manual</string>
  <key>provisioningProfiles</key>
  <dict><key>$HERMES_BUNDLE_ID</key><string>$HERMES_PROFILE_NAME</string></dict>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLIST

echo "4/4 Uploading to App Store Connect"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$WORK/ExportOptions.plist" -exportPath "$WORK/export" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
  > "$WORK/export.log" 2>&1 || { grep -E "error:|Error" "$WORK/export.log" | head -20; echo "UPLOAD FAILED, log: $WORK/export.log"; exit 1; }
grep -E "Upload succeeded|EXPORT SUCCEEDED" "$WORK/export.log" || tail -3 "$WORK/export.log"

# App Store Connect refuses a build number twice. Write the next one now, so the file is ready.
case "$HERMES_BUILD_NUMBER" in
  *[!0-9]*) echo "Raise HERMES_BUILD_NUMBER in $ENV_FILE before the next upload."; exit 0 ;;
esac
NEXT=$((HERMES_BUILD_NUMBER + 1))
if grep -q "^HERMES_BUILD_NUMBER=" "$ENV_FILE"; then
  sed -i '' "s/^HERMES_BUILD_NUMBER=.*/HERMES_BUILD_NUMBER=$NEXT/" "$ENV_FILE"
  echo "The next build number is $NEXT (written to $ENV_FILE)"
else
  echo "Set HERMES_BUILD_NUMBER=$NEXT in $ENV_FILE before the next upload."
fi
