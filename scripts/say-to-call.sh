#!/bin/sh
# Say a sentence into the voice call of the app in the Simulator, with no sound in the room.
# The Mac's `say` writes the speech to a file; the driver feeds it to the call in the place of
# the microphone, and mutes the microphone so the room is not heard.
#   scripts/say-to-call.sh "What is the time?"
set -e
cd "$(dirname "$0")/.."
OUT="${TMPDIR:-/tmp}/hermes-say-$$.wav"
say -o "$OUT" --data-format=LEI16@16000 "$1"
# Half a second of quiet after the words lets the turn end.
DATA=$( (tail -c +4097 "$OUT"; head -c 16000 /dev/zero) | base64 | tr -d '\n')
rm -f "$OUT"
node scripts/drive.mjs "h.hear('$DATA')"
