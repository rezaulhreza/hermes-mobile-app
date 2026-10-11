#!/bin/sh
# Open a chat and start a call on one engine, with the microphone muted from the start.
#   scripts/voice-open.sh relay|deepgram|gpt-live [stored session id, default the newest chat]
set -e
cd "$(dirname "$0")/.."
UNTIL='(async test => { for (let i = 0; i < 40 && !test(); i++) await h.wait(500); return test() })'
node scripts/drive.mjs 'h.stores.$call.get() && h.press("End the call")' \
  "$UNTIL(() => h.stores.\$linkState.get() === 'open' && h.stores.\$sessions.get().length > 0)" \
  "h.setPreference('engine','$1')" 'h.hear("")' \
  "h.router.push('/chat/' + (${2:+'$2' ||} h.stores.\$sessions.get()[0].id))" \
  "$UNTIL(() => h.labels().includes('Start a voice call'))" \
  'h.press("Start a voice call")' \
  "$UNTIL(() => ['listening', 'hearing'].includes(h.stores.\$call.get()?.phase))" \
  '(c => c && [c.engine, c.phase, "muted=" + c.muted])(h.stores.$call.get())'
