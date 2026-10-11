#!/bin/sh
# Measure a voice call: the time from the end of the question to the first sound of the answer.
# The app must be open on a chat with a call running. The question is fed with no room sound.
#   scripts/voice-latency.sh "What is two plus two?" [seconds to wait, default 25]
set -e
cd "$(dirname "$0")/.."
node scripts/drive.mjs 'h.voiceTrace.length = 0'
scripts/say-to-call.sh "$1"
sleep "${2:-25}"
node scripts/drive.mjs 'h.voiceTrace' | node -e '
const lines = JSON.parse(require("fs").readFileSync(0, "utf8"))
const at = name => { const hit = lines.find(line => line.split(" ").slice(1).join(" ").startsWith(name)); return hit ? Number(hit.split(" ")[0]) : null }
// The fed recording ends with half a second of quiet.
const end = at("fed-end") === null ? null : at("fed-end") - 500
const since = value => (value === null || end === null ? "not seen" : `${value - end} ms`)
console.log(`first live words: ${at("partial") === null ? "none" : "yes"}`)
console.log(`question written down: ${since(at("utterance"))}`)
console.log(`first text of the answer: ${since(at("answer-text"))}`)
console.log(`first sound: ${since(at("sound true"))}`)
'
