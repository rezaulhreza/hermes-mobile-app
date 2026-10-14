# Hermes native: handoff

Read this file first in every new session. Update it before a session ends.

## What this is

A React Native (Expo) app for Hermes. It replaces the Capacitor shell in the
Hermes repo (`~/Developer/hermes-mobile`, directory `mobile-shell/`), which
wrapped the desktop web renderer in a WebView. This app has no WebView for its
own UI. It talks to the same Hermes backend over the same two transports:

- REST: `https://<host>/api/...`, session cookie from `POST /auth/password-login`.
- Gateway: JSON-RPC over `wss://<host>/api/ws?ticket=<single-use ticket>`.

The backend needs no change. This repo is separate from the Hermes repo. Do
not edit the Hermes repo from here; only read it.

## Product intent

Hermes is a personal agent that runs 24/7 on the owner's machine. The phone is
the remote control. Rebuild the desktop experience for a phone the right way;
do not copy the desktop layout. The design reference is the prototype at
`~/Documents/Hermes Mobile Prototype Proposed Design/` (`index.html` and the
PNG files). The prototype is a vision from a weaker model: keep the feel (warm
paper, one terracotta accent, floating tab bar, calm type), improve the rest.

The most important surface is "Hermes needs you": approvals, questions,
secrets, sudo passwords, 2FA codes, vault unlock. `src/core/requests.ts`.

## This app replaces the old one (owner's decision, 2026-10-09)

This app is the drop-in replacement for the old Hermes mobile app (the
Capacitor shell). At release it takes the old app's identity and
configuration, so the phone sees an update of the same app, and push keeps
working with no backend change. After that, this repo is the one to maintain.

The switch is APPROVED (owner, 2026-10-09, sixth session), but it is the LAST
step, inside the release item. Until then keep the placeholder bundle ID
`com.example.hermesnative` so both apps install side by side. Push
notifications are approved too: build them on the old app's push setup; a real
push needs the old bundle ID, so test it after the switch.

What to take over at the switch, and where each value is:

- Bundle ID and app name: the old app builds with `CAP_APP_ID` /
  `CAP_APP_NAME` (`mobile-shell/capacitor.config.ts`, `mobile-shell/README.md`
  in the Hermes repo). The live bundle ID is also `push.bundle_id` in
  `~/.hermes/config.yaml`.
- Push: the backend sends with `push.apns_key_path`, `apns_key_id`,
  `apns_team_id`, `bundle_id`, `environment` in `~/.hermes/config.yaml`. The
  APNs topic IS the bundle ID, so the same bundle ID means the same key works.
  The app needs the `aps-environment` entitlement and the same team.
- Signing team, App Store Connect record, TestFlight group, icons, splash,
  display name, permission texts, URL scheme: read them from
  `mobile-shell/ios/` before the first release build.
- Keep personal identifiers out of the tree, as the old app does: read the
  bundle ID from the environment in `app.config`, do not commit it.

## Owner's decisions, eighth session (2026-10-09)

- Release: APPROVED to switch to the old app's bundle ID and to upload to
  TestFlight with the old app's keys and method. The bundle ID and every
  personal value come from the environment and are never committed. Stop only
  if Apple asks for an interactive sign-in.
- Approve and Deny buttons inside the notification: APPROVED, build them
  AFTER the TestFlight upload, with the choices Hermes itself offers (once,
  this session, always, deny).
- When all is done: write a report of the work and a reusable handoff
  template to `~/Documents/Hermes Redesign Mobile App/` (on the Mac, not in
  the repo).
- `docs/HANDOFF.md` before the source opens: still ASK the owner.
- Keep working in one session. Say when a new session is better.

## Working rules (from the owner)

- Do the work inline. Subagents only when clearly worth the cost: Sonnet at
  medium effort, or Haiku for a simple search.
- Protect memory and CPU. The machine has 16 GB and is often loaded. One
  Simulator, one Metro (port 8082), no Playwright and no extra browser.
  Check each item in the Simulator with `scripts/drive.mjs` (see "Build
  notes"); do not wait for the owner to tap. Also run `npm run verify`.
  The owner tests on a real phone only at the end, after TestFlight.
- Memory and speed are part of every item. Measure the app with
  `footprint $(pgrep -f "Hermes.app/Hermes") | grep phys_footprint:` at the
  start and after each item. A development build is about 450 MB right
  after a start, about 480 MB with a chat open. A rise past that is a fault.
- Never put a value that changes many times a second (a level, a progress)
  in a store that a whole screen reads. Give it a throttled atom that only
  the small component reads (`$callLevel`). The level in `$call` froze the
  app in a long chat and took it past 1 GB.
- The owner allows changes to the Hermes host that make voice faster. Say
  exactly what changed and how to undo it. Hermes repo changes go on a new
  branch in `~/Developer/hermes-mobile`, not pushed. Careful: the backend
  of the host RUNS from that checkout (`mobile-shell/scripts/run-backend.sh`,
  launch agent `com.hermes.backend.mobile`), so a branch switch there
  changes the running backend at its next start.
- Remove test data from the owner's Hermes after each check and say what
  is left.
- The Hermes host may be Linux or Windows, not only this Mac (owner,
  2026-10-09). The app must not assume a Mac host, and a host-side change
  must be portable or say its Linux and Windows form.
- A change to the Hermes backend is a PATCH, small and recorded: the ledger
  is `scripts/local-features/README.md` in `~/Developer/hermes-mobile` (what,
  why, how to tell that upstream fixed it, when to drop it). Add a row and a
  numbered `.patch` file for every backend change. The owner updates Hermes
  from upstream; an update must be able to keep or drop each patch.
- A tap on a notification opens the EXACT place where the user answers, and
  the text names the bot by its readable name. Every request that waits for
  the owner (approval, question, secret, sudo, vault) sends a push.
- A commit in `~/Developer/hermes-mobile` makes the phone's backend refuse a
  model switch ("This gateway is running code from X but the checkout on disk
  is now Y"). After every commit there, also a docs commit, run
  `launchctl kickstart -k gui/$(id -u)/com.hermes.backend.mobile` and wait for
  `curl http://127.0.0.1:9130/api/status` (10 s to 4 minutes).
- Prefer a Hermes PLUGIN to a core patch when a plugin can do the work (the
  ledger's own rule 2). A plugin has routes under `/api/plugins/<name>/`
  (`dashboard/manifest.json` + `plugin_api.py`) and hooks (`pre_tool_call` can
  refuse a tool call with a message). `hermes update` does not touch it. Its
  source goes in `host/` of this repo, with a row in the ledger table "Local
  changes outside the checkout".
- The owner's design notes (seventh session): no raw keys on screen (a
  readable name and an icon, like the desktop app); no sliding row of chips;
  follow the prototype's shape (a button that opens a list); no host path in
  an answer (show the file); no drawn face of the host's skin; plain words for
  a fault, not the raw error.
- The repo must be GENERIC (owner, 2026-10-09): he may open the source or
  ship the app in the App Store. No name, address, site, path, identifier or
  detail of his computer in code, tests, comments, the README, a plugin or a
  commit message. A test uses `app.test`, `/Users/me`, `h.example`. Check
  with `git grep -n -i -E "<his names>"` before a commit. THIS file is the
  working log and is personal: before the source is opened, remove it from
  the tree (and from the history) or rewrite it. The README is generic and
  must not point a reader at personal notes.
- The app repo carries the WHOLE host side (owner, 2026-10-09), so anyone can
  set up a host: `host/screen-remote` (the plugin) and `host/patches` (one
  generated patch with every backend change over stock Hermes, its base
  commit, `apply.sh`, a README with the settings). After EVERY backend commit:
  `HERMES_REPO=~/Developer/hermes-mobile npm run host:sync` here, and commit
  the result with the app change that needs it. `npm run host:check` fails
  when the folder is stale. The patch is checked: it applies cleanly to stock
  Hermes at its base, a second run changes nothing, and the patched backend
  imports. The numbered patches of the ledger stay in the backend checkout;
  they cover only a part (the preview route and the phone's bridges came from
  the mobile branch and were never numbered), so the app repo ships the whole
  difference as one patch instead.
- The owner wants every screen FAST. See "Speed" under "Remaining work".
- Builds are local: `npx expo run:ios` / `eas build --local`. No EAS cloud.
- Near 500k tokens of context, stop and update this file.
- Commits are atomic, imperative mood, no AI attribution lines.

## Layout

```
src/app/                 expo-router routes (thin)
  _layout.tsx            loads workspaces, owns the link lifecycle
  sign-in.tsx            add a workspace
  (tabs)/                Chats, Bots, Activity, Workspace, Settings + floating tab bar
  chat/[id].tsx          one conversation (`?profile=` for the chat of a bot)
  voice.tsx, providers.tsx, keys.tsx, cron.tsx, vault.tsx   screens opened from Settings
src/dev/driver.ts        development builds only: lets scripts/drive.mjs press and type
src/core/                pure logic, no React, no native modules. Tested.
  gateway/               VENDORED from hermes-mobile/apps/shared/src. Do not edit by hand.
  api.ts                 REST client: proxy headers, sign-in + replay on 401 no_cookie
  workspaces.ts          workspace model, validation, storage parsing
  transcript.ts          gateway events -> chat rows (reducer)
  requests.ts            agent -> user requests (approval, clarify, secret, sudo, code, vault)
  commands.ts            slash commands on a phone: blocked ones, the app's own actions, the sheet
  composer.ts            completion triggers, what a slash answer means
  voice.ts               dictation and read aloud: when a listen ends, what to say aloud
  live-voice.ts          the full-duplex call: sentence cutting, echo check, barge-in, spoken approval
  gpt-live.ts            the gpt-live engine: delegation prompt, history, commentary parts
  wake.ts                the wake word: refusal texts, the feed queue
  vault.ts               the vault form: fields, checks, the add request
  tools.ts               tool row detail, diff lines, which answer ends a turn
  preview/               the browser preview: addresses, scripts, answers, the vendored engine
  attachments.ts         kinds, the size limit, the prompt text an attachment adds,
                         the preview mode of a file, the stored prompt parser
  sessions.ts            the list of conversations: rows, filters, groups, actions
  work.ts                the todo list and the helpers (subagents) of a turn
  providers.ts           providers, the default model, the keys of the host
  bots.ts                bots (profiles): rows, names
  cron.ts                schedules (cron jobs): rows, the next run in words, checks
  host-files.ts          host paths in an answer: the files to show under it
  screen.ts              the agent's screen work: which tools count, the stop words, where a tap lands
src/store/               nanostores atoms + side effects
  workspaces.ts          SecureStore persistence
  link.ts                the ONE live link (REST + socket), redial with backoff
  sessions.ts, chat.ts, requests.ts
  commands.ts            the backend command catalog, one copy per link
  attachments.ts         pickers + upload; the staged list per conversation
  preview.ts             the copy of an attachment on the phone (downloads a host file once)
  voice.ts               the ONE call: owns the turn (utterance -> message, answer -> voice),
                         spoken approvals, the engine choice; dictation; read aloud
  voice-engine.ts        what a call needs from a speech engine (the interface)
  voice-deepgram.ts      engine: the desktop's deepgram-live path (two sockets to Deepgram)
  voice-relay.ts         engine: Hermes's own transcribe-stream / speak-stream routes
  voice-gpt-live.ts      engine: WebRTC to OpenAI's voice model through the host
  wake.ts                the wake word: wake.start, PCM to wake.feed, wake.detected -> call
  preferences.ts         choices of this phone: the engine, the wake word
  browser.ts             previews per conversation; answers preview.read / preview.act
  vault.ts               vault items and password manager sources
  sessions.ts            the list (REST) and rename, pin, archive, delete, branch, export
  screen.ts              the live view of the agent's screen work: picture loop, hold, input
  workspace.ts           the Workspace tab: the folder, files, git changes, the terminal
host/screen-remote/      the Hermes plugin of the screen view (install.sh puts it on the host)
src/native/duplex-audio.ts  the wrapper of the native call audio
modules/hermes-duplex-audio/  local Expo module (Swift): AVAudioEngine with voice processing.
                         Microphone PCM out as events, PCM or MP3 in for playback, at the same time.
src/components/          shared UI
src/theme/               tokens + useTheme / useIsTablet
```

Rule: logic goes in `src/core` with a test. Stores wire `core` to the link.
Routes render stores.

To refresh the vendored gateway client: copy `json-rpc-gateway.ts`,
`json-rpc-channel.ts`, `gateway-events.ts`, `gateway-contract.generated.ts`,
`reconnect-backoff.ts`, `websocket-url.ts` from the Hermes repo, then remove
the `.js` suffix from their relative imports (Metro does not map `.js` to `.ts`).
`gateway-contract.generated.ts` is the source of truth for every RPC method,
event and payload shape. Grep it before writing a store.

## Backend facts that cost time before

- `provider: "basic"` is REQUIRED in the password-login body. Without it: 422.
- A `401 {"reason":"no_cookie"}` means sign in and replay once.
- The WebSocket ticket is single-use, 30 s. Mint one per dial.
- An HTML body means an access proxy (Cloudflare Access) refused the request.
- Proxy headers must go on REST calls AND on the WebSocket upgrade. React
  Native's `WebSocket` takes headers as a third constructor argument; see
  `store/link.ts`. UNVERIFIED on a device.
- Any non-loopback bind of the backend turns the sign-in gate on, so Cloudflare,
  Tailscale and same-network connections all use the same username and
  password. The connection kind only changes the address hints, the default
  scheme (`http` on a private network) and whether proxy headers apply.
- iOS allows plain `http` through the ATS keys in `app.json`. Android needs
  `usesCleartextTraffic` (expo-build-properties). NOT done yet.
- The backend checks the WebSocket Host against `dashboard.public_url`. A
  Tailscale or LAN address may be refused there. UNVERIFIED.
- React Native keeps cookies in the native cookie store, per host. Two
  workspaces on the SAME host with different accounts share one cookie jar.
  Not handled yet.
- The backend runs `hermes dashboard`, not `hermes serve`.
- A `prompt.submit` during a turn does NOT queue by default. The backend's
  `display.busy_input_mode` default is `interrupt`: it redirects or stops the
  running turn. Send `queued: true` to force the queue. The app does that
  whenever it believes a turn runs, and reads the label from the reply
  (`queued` / `steered` / `redirected`), because the backend decides.
- `session.steer` answers `status: "queued"` when it ACCEPTS the steer, and
  `"rejected"` when no turn runs. On `rejected` the app sends a normal prompt.
- A queued prompt's turn starts with `message.start`. No event names the
  prompt. The reducer takes the oldest queued row.
- `/compress`, `/btw`, `/bg` must use `session.compress`, `prompt.btw`,
  `prompt.background`. Through `slash.exec` they time out or lose the answer.
  The answers to the last two arrive as `btw.complete` / `background.complete`.
- An attach request is ONE WebSocket frame, capped at 16 MiB. Base64 adds a
  third, so the app refuses a file over 12 MiB. Images: `image.attach_bytes`
  holds the image on the session for the next prompt (`image.detach` with the
  returned `path` takes it back). PDFs: `pdf.attach` holds page images and
  returns a text line for the prompt. Other files: `file.attach` with a
  `data_url` returns `ref_text` (`@file:...`), which must be in the prompt.
- `commands.catalog` keys carry the leading slash. `commands[name].desktop`
  is null for a command that runs, else the reason it has no UI surface.
- `complete.slash` items carry the name WITHOUT the slash in `text`
  (`display` has the slash) and `kind: "command" | "skill"`.
- `session.create` / `session.branch` return a live `session_id` AND a
  `stored_session_id`. Only the stored id opens the conversation again later.
  A chat route carries the stored id.
- `session.interrupt` empties the backend prompt queue. A queued message
  never runs after Stop.
- A stored user message is the prompt plus `\n\n--- Attached Context ---\n...`
  with the content of every `@file:` reference. Cut it for display
  (`splitStoredPrompt`).
- `pdf.attach` needs poppler (`pdftoppm`) on the host. This host has none; the
  app then sends the PDF with `file.attach`.
- `GET /api/fs/download?path=` serves a host file. Do NOT add `session_id`:
  the path is then read inside that session's folder and the answer is 404.
- The list of conversations comes from REST, `GET /api/sessions?order=recent&archived=exclude|only`.
  Only that row has `pinned`, `archived`, `unread`, `last_active`. `archived=only`
  also returns a pinned row that is not archived; filter by the flag.
  `PATCH /api/sessions/{id}` takes `title`, `pinned`, `archived`.
  `DELETE /api/sessions/{id}`. `GET /api/sessions/{id}/export` streams JSON.
  A stored conversation branches with the RPC `session.branch_stored`.
- A held picture is stored in the prompt as `@image:<host path>` plus one
  `[screenshot]` line. `session.resume` tool rows carry `args` and `context`
  but no output; the REST messages route has `content` (often JSON with
  `output`, `exit_code`, `error`).
- The owner's agent is slow (the model). A tool row can show "running" for a
  minute with nothing wrong. Wait 30 to 60 s in a live check, or put rows in
  the store with the driver.
- The tools that need a screen (`open_preview`, `read_preview`,
  `drive_preview`: toolset `desktop_ui`) exist ONLY in a session whose source
  is `desktop` (`tui_gateway/server.py::_gui_surface_toolsets`). The app
  therefore sends `source: "desktop"` (`SESSION_SOURCE` in `core/sessions.ts`).
  With `mobile` the agent drove the Chrome of the host machine. A cleaner fix
  is in the Hermes repo (give `mobile` its own client-surface set); that is
  the owner's call. Until then a chat from the phone reads "desktop" there.
- The agent's preview requests are server-to-client requests: `preview.read`
  ({start, count}) and `preview.act` ({action, ref, selector, text, key, ...}).
  The answer is `{ value: <JSON string> }`. The page side is the desktop
  app's engine, `apps/desktop/src/lib/preview-act/`. The desktop builds its
  source with `Function.toString()`; Hermes bytecode has no function source,
  so `node scripts/vendor-preview-engine.mjs` writes it to
  `src/core/preview/act-engine.generated.ts`. Run that script again when the
  desktop engine changes.
- A WebView does not share the app's cookies by default. `sharedCookiesEnabled`
  is what lets the preview proxy see the session.
- Voice: the `voice.*` RPCs record and play on the HOST (its microphone and
  speakers). A phone uses REST: `POST /api/audio/transcribe`
  `{data_url, mime_type}` -> `{transcript}` and `POST /api/audio/speak`
  `{text}` -> `{data_url}`. There are also `/api/audio/transcribe-stream` and
  `/api/audio/speak-stream` (WebSocket), `/api/audio/voice-config` (keys for
  client-direct STT/TTS) and `/api/audio/voice-live/session` (WebRTC, the
  "gpt-live" engine). `wake.feed` takes PCM frames from a client for the wake
  word. None of the last four is used yet.
- Live voice (2026-10-09, fifth session). A call is full duplex. Three engines,
  one interface (`store/voice-engine.ts`); `GET` them with `loadEngines()`:
  - `deepgram`: the path of the owner's `deepgram-live` desktop plugin
    (`~/.hermes/desktop-plugins/deepgram-live/plugin.js`, backend half in
    `~/.hermes/plugins/deepgram-live`). `GET /api/plugins/deepgram-live/status`
    gives the settings, `POST .../auth` gives a 30 s token, which goes in the
    WebSocket subprotocols (`[scheme, value]`) of `wss://api.deepgram.com/v2/listen`
    (16 kHz PCM up, `TurnInfo` events down) and `/v1/speak` (text up, 24 kHz PCM
    down). `POST .../turn {text}` marks a turn as spoken, so the agent answers
    in plain sentences. The key never reaches the phone.
  - `relay`: `/api/audio/transcribe-stream` (only when `voice-config` says
    `stt.streaming`; else the phone sends each turn as a WAV to
    `/api/audio/transcribe`) and `/api/audio/speak-stream`. Both sockets
    sign in with `?ticket=` like `/api/ws` (`openSiblingSocket`). This host
    has both since the sixth session, see "Host changes".
  - `gpt-live`: WebRTC. `POST /api/audio/voice-live/session {sdp, history}`.
- A host whose `speak-stream` answers `{"type":"fallback"}` has a speech
  provider that writes a file and no ffmpeg to decode it. The relay engine
  then asks `/api/audio/speak` for each sentence. This host did that until
  the sixth session.
- The host's `speak-stream` cuts a sentence only when white space follows
  it. The relay engine sends a line end 150 ms after a sentence that nothing
  follows (`SENTENCE_FLUSH_MS`), or the last sentence waits for the next
  event of the turn.
- A new ticket and socket for `speak-stream` cost about 0.7 s through
  Cloudflare. The relay engine dials it when the user's turn ends.
- The backend takes up to 4 minutes to open its port after a restart on a
  new managed runtime. Wait for `curl http://127.0.0.1:9130/api/status`.
- Deepgram's speak socket still sends sound for a moment after `Clear`. Drop
  it until `Cleared`.
- Do not duck the microphone on the phone. With voice processing on, a gain
  of 0.2 (the desktop's value) left the listening model with no words at all
  during playback, so nothing could interrupt the voice.
- The wake word: `wake.start {surface:'gui', client_capture:true, persist:true}`.
  Without `persist` the host refuses with `disabled` while `wake_word.enabled`
  is false in its config. One client owns the detector: the desktop and the
  phone cannot both listen. `wake.feed {pcm: base64 int16 16 kHz}`, four 80 ms
  frames a call. The host has no spoken wake reply of its own (the desktop
  plays a sound); the phone says "Yes?" (`WAKE_REPLY`).
- `profiles.get_asset` answers `data` as a whole `data:` address, not bare
  base64. `profiles.list {include_sessions: true}` takes several seconds on a
  host with many bots.
- `config.set {key: "model"}` needs a live session and changes that session.
  The default model of the profile is `POST /api/model/set
  {scope: "main", provider, model}`.
- `/api/env` marks a masked value as `«redacted:abc...xyz»`.
- The bot screen (`display.*`, the computer-use view) needs Xvnc on Linux or
  Docker. On this Mac `display.status` says `supported: false`.
- `POST /api/files/upload-stream` is a multipart upload with no base64. It
  could replace the 12 MB frame limit for attachments. Not used yet.
- `GET /api/sessions` lists ONE profile, at most 100 rows a request (`limit`
  over 100 is a 422), with `offset`, `source`, and `total` in the answer.
  `GET /api/profiles/sessions?profile=all|<name>` lists across profiles (limit
  up to 500), same parameters; each row has `profile` and
  `is_default_profile`. The app uses the second one. `limit=0` gives only the
  count. `DELETE /api/sessions/{id}`, `/messages` and `/export` take
  `?profile=`; `PATCH /api/sessions/{id}` takes `profile` in the BODY;
  `session.branch_stored` takes `profile`.
- The first answer of the host for a kind of request takes 1.5 to 6 s (the
  session list, a resume, the profile list); a repeat takes 0.1 to 0.3 s.
  That is the host. A `session.resume` answer for a long chat is 0.3 to 1 MB
  of JSON (512 messages: 980 KB, 6.6 s through Cloudflare).
  `session.resume` has `lazy`, `defer_history`, `omit_messages` and
  `inline_images: false`; not used yet (see "Left" of item 2).
- `thinking.delta` text starts with a kaomoji of the host's skin
  (`display.tui_status_indicator: kaomoji`). `statusWords` cuts it.
- Screen work on this host: a `desktop` session has `computer_use` and the
  owner's Chrome MCP (`mcp__chrome__*`, `http://127.0.0.1:8790/mcp`), not the
  `browser_*` tools (those are in the `telegram` toolset list).
  `approvals.mode` is `off`, so `computer_use` runs with no approval card
  (cua mode `unrestricted`). A capture is saved in
  `~/.hermes/cache/images/computer_use_<id>.png` before the tool ends, and the
  live `tool.complete` event has the path (`result.screenshot_path`, and in
  `result.summary`). The main model has no vision, so a capture goes through
  the auxiliary vision model: 13 s a capture. The FIRST capture after a
  backend start stalled the backend's event loop for 79.5 s and dropped the
  socket; the second took 13 s. Not found why (cold imports are the guess).
- `cua-driver` (0.21.0 here) works per WINDOW: `capture(mode="vision", pid,
  window_id)` gives a PNG in 0.3 s; a click takes pixels of that PNG; a scroll
  needs a position; `delivery_mode: "foreground"` fronts the window for the
  action and goes back. A blocked tool call (a plugin veto) sends no
  `tool.start` and no `tool.complete`: the chat shows no tool row for it.
- The first turn of a profile can spend a minute in Hermes's own scratch
  prune (seen: 64 s, 1.9 GB removed from the Backend bot's scratch folder).
- More: `~/.hermes/hermes-mobile-handover.md` (sections "Auth contract" and
  "Traps that cost time").

## Host changes (sixth session, 2026-10-09, allowed by the owner)

For a faster voice. Backup of every changed file:
`~/.hermes/backups/voice-speed-2026-10-09/`. To undo: copy the three items
back, then `launchctl kickstart -k gui/$(id -u)/com.hermes.backend.mobile`.

- `~/.hermes/plugins/deepgram-voice/` (a plain folder, not in git): new
  `hermes_deepgram_voice/stt_stream.py`; `stt.py` got `streaming_capable` and
  `open_stream_session` (Deepgram `/v1/listen` websocket); `tts.py` got
  `streams_pcm` and `stream(text, format="pcm")` (raw PCM at 24 kHz, one
  kept-alive HTTPS session). Noted in its `LOCAL-CHANGES.md`.
- `~/.hermes/config.yaml`: one new line, `stt.streaming: true`.
- `~/Library/LaunchAgents/com.hermes.backend.mobile.plist`: a `PATH` with
  `/opt/homebrew/bin`, so the backend finds ffmpeg.

Measured, end of the question to the first sound (`scripts/voice-open.sh
<engine> <chat>` then `scripts/voice-latency.sh "question"`):

| Engine | Before | After |
|---|---|---|
| relay | 5.4 to 9.6 s, no live words, speech by sentence upload | 4.5 to 8.5 s, live words, PCM stream, no fallback |
| deepgram | 7.0 to 8.1 s | 5.9 to 6.9 s |

The words are written down about 1.2 s after the question ends (relay was
2.9 s). The model takes 3 to 5 s of every turn (first text of the answer);
that is the model of the host, and the largest part that is left. The first
sound comes 1.2 to 1.7 s after the first text: the first sentence must be
complete, then about 0.7 s for the provider and the way back.

## Host changes (ninth session, 2026-10-09)

- `~/.hermes/plugins/group-rooms/` (new) and `group-rooms` in
  `plugins.enabled` of `~/.hermes/config.yaml`. Undo: `hermes plugins disable
  group-rooms`, delete the folder, restart the backends. Config backup:
  `~/.hermes/backups/group-rooms-2026-10-09/config.before.yaml`.
- The phone's backend was restarted after each backend commit and each
  install of the plugin.
- MISTAKE to know about: a `grep` over `~/.hermes/logs/*.log` matched the
  cloudflared log and printed session cookies and an Access token into the
  session transcript. The owner was told. Never glob that folder: name the
  one log file (`hermes-backend-mobile.err.log`).

## State

Done and checked (`npm run verify` green, iOS bundle exports):

- Project scaffold, theme tokens for light and dark.
- Workspaces: add, switch, sign out, stored in Keychain / Keystore.
- Sign-in screen with Cloudflare Access fields.
- Link: ticket, socket, redial with backoff, redial on foreground.
- Chats tab: session list, search, pull to refresh, new chat, link status banner.
- Chat: resume history, streaming text as Markdown, reasoning rows (closed by
  default), tool rows, status line, send, stop.
- Requests inbox: all request kinds, in the chat and in the Activity tab.

Checked in the iOS Simulator (iPhone 17, Xcode 26.3) against the owner's real
Hermes on 2026-10-09: sign-in through the Cloudflare address, the ticket and
socket, the session list, opening a stored chat (history, tool rows, Markdown),
sending a message and the streamed answer, new chat, the model and reasoning sheet, dark mode on the Chats tab.

Also seen on screen by the owner: the slash command list, `/help` output, an
`@file:` reference that the agent then read, the status line under the title,
the Stop button during a turn.

Done on 2026-10-09, second and third session. Each line was checked in the
iOS Simulator against the owner's real Hermes with `scripts/drive.mjs`:

- Slash list hides commands with no phone surface; a typed one gives the reason.
- `/help` opens the command sheet; a tap puts the command in the composer.
- `/new`, `/branch`, `/title`, `/model <name>` (sheet with the name in its
  search field), `/resume <words>` (list with the words in its search field),
  `/compress` (the rows become the new history).
- Queue + steer during a turn. Stop marks a queued message "Not sent".
- Attachments: image, file, PDF. Thumbnail in the staged chip and in the sent
  message; a file shows an icon, its name and its size. The agent read the
  file and described the image.
- Preview: a tap on a picture opens it full screen (zoom, swipe, pull down).
  A tap on a file opens a sheet (web view for PDF and office files, text and
  Markdown drawn by the app, share button). A file from stored history is
  fetched from the host once.
- A chat opened again after the app restarted (the route has the stored id).
- Session actions: long press on a row, or a tap on the chat title. Pin,
  rename, branch, export (share sheet), archive and move back, delete with a
  question inside the sheet. Pinned group, source chips, archive view.

Done on 2026-10-09, fourth part (the owner was away; work went on alone).
Checked in the Simulator:

- Markdown tables (sideways scroll, alignment).
- Tool row detail sheet: input, coloured diff, output. A stored tool row gets
  its output from `GET /api/sessions/{id}/messages` when the sheet opens.
- Copy and share under the answer that ends a turn.
- The pictures of a stored message show again (`@image:` lines; the thumbnail
  comes from the host).
- A request card on a real request: a `clarify` question with two choices,
  answered from the card. The approval kind uses the same card and path but
  no approval came up (the owner's agent asks through `clarify`).
- The vault (Settings, "Logins and cards"): add a login, list, remove. Cards,
  addresses and password managers use the same code; not exercised.
- The message field is one line again after a long message is sent.

- The browser preview. The agent opened example.com with `open_preview`, read
  it with `read_preview` and clicked a link with `drive_preview`; the pane
  showed the page it landed on. A `localhost` address loaded through
  `/api/preview/host`, with the app's sign-in, over the Cloudflare address.
- The voice call. The Mac said a question aloud (`say`), the call heard it,
  the backend wrote it down word for word, the agent answered, the phone
  spoke the answer and listened again. Mute, the strip view and End work.

Done on 2026-10-09, fifth session (the owner asked for fast, full-duplex
voice first). Checked in the Simulator against the owner's real Hermes:

- The call is full duplex on the Deepgram path of the desktop plugin. The
  user's words show while they talk; the voice starts while the answer
  streams (about 2 to 3 s after the question ends, most of it the model); the
  words "Hold on" over a long answer stopped the voice at once and the new
  question got its answer. A turn also ran with the app in the background.
- The relay engine (Hermes's own routes): speech-to-text by upload and the
  spoken answer by sentence (this host's `speak-stream` falls back, see
  "Backend facts"). Live words on this engine need `stt.streaming` on the
  host: NOT seen.
- The wake word: the fed phrase "Hey Hermes" started a call in a new chat
  twice, the voice said "Yes?", and the phone listened again after each call.
- The gpt-live engine: the phone made a real WebRTC offer and the host
  answered 503 "GPT-Live needs an OpenAI API key". All after that answer is
  NOT tested: the events of the voice model, a delegation as a Hermes turn,
  the answer as commentary, mute, the clean close.
- The engine choice in the call and in Settings, Voice.
- The plan and the helpers of a chat (todo list, subagents) on a real turn:
  the strip, the sheet, a helper's report. NOT seen: steer and stop of a
  helper that still runs (the test helper ran 9 s), a helper of a helper.
- Settings: providers and models (the list, a provider with no key, the
  default model set to the same model), API keys (the list, a test key added
  and removed). NOT seen: `model.save_key` with a real key, Disconnect.

Done on 2026-10-09, sixth session. Checked in the Simulator:

- Host speed (see "Host changes"): the relay engine shows live words and
  plays the PCM stream with no fallback.
- A fault that froze the app in a call in a long chat (the level in `$call`).
- Dictation on the call's audio and `transcribe-stream`: the words show above
  the message field while the user talks, then go into the field. A tap on
  "Done talking" with nothing said calls it off.
- Read aloud on `speak-stream`, with the audio module in its speaker-only
  mode (`playbackOnly`, no microphone opened): sound about 1.8 s after the
  tap; the same button stops it.

- Push notifications (item 6), on the placeholder bundle ID: the permission,
  the Settings row, the banner rule (a simulated push for the chat on screen
  shows no banner; one for another chat shows), the register and unregister
  requests against the real backend with a throwaway token, and the tap: a
  real `clarify` request waited, the app was started cold, and the tap path
  opened the exact chat with its request card (`h.openFromPush`).
- The chat list is an inverted virtual list (the newest row first).

Push, what is left for the release item (needs a phone and the old bundle ID):
a real token (a Simulator gives 160 hex characters; the backend takes only
64), a real push from the backend, a tap on a real banner, a cold start from
a tap (`getLastNotificationResponse`), and the `aps-environment` value of a
release build (the plugin writes `development`; a TestFlight build needs
`production`: set `"mode": "production"` on the `expo-notifications` plugin
or let the export set it, and check the built entitlements).

Backend work of the sixth session, on the LOCAL branch `native-app/backend`
of `~/Developer/hermes-mobile` (not pushed; the worktree is on that branch, so
the phone's backend on port 9130 runs it):
- `56f3e7124e` the push text names the bot by its roster title ("Manager",
  not "default") and each request kind has its own words. Patch
  `scripts/local-features/0004-push-readable-names.patch`.
- `2dc096f85f` and one more: the patch ledger `scripts/local-features/README.md`.
- Host config: `push.kinds` in `~/.hermes/config.yaml` now lists all
  human-facing kinds (before: the default `clarify`, `approval`, `mention`).
  Backup: `~/.hermes/backups/voice-speed-2026-10-09/config.before-push-kinds.yaml`.
- A stale `index.lock` (2 hours old, no holder) was removed from the git
  directory of that worktree.
- FINDING for the owner: the live install `~/.hermes/hermes-agent` (`main`,
  the backend on port 9119) carries NO local patch since its update on
  2026-10-07 21:48: no lease fix, no push. Nothing was applied there. The
  owner's decision (2026-10-09): do NOT apply them; he decides later. See
  `~/.hermes/hermes-upgrade-in-progress.md`, section 2026-10-09.

Done on 2026-10-09, seventh session. Checked in the Simulator against the
owner's real Hermes:

- Item 7b, watch and take over the agent's screen work. The host half is the
  plugin `host/screen-remote` (installed on the owner's host, see "Host
  changes, seventh session"). A chat where a screen tool ran shows a "Screen"
  row; "Watch" opens a live picture of the window (about one a second, only
  while the view is open). "Stop Hermes and take over" with a reason set the
  hold on the host; the agent's next `computer_use` call was refused and the
  agent read "BLOCKED: the user stopped your screen work at 17:36 ... Their
  reason: ..."; a running turn is also stopped with a message (`redirectTurn`,
  NOT seen on a running turn: the test model answers too fast). From the
  phone: a click, text, the Return key and a scroll landed in a scratch
  TextEdit window. "Hand back" removed the hold. NOT seen: "Hand back and
  continue" on a real task, a right click (a long press cannot be driven),
  the window list sheet on screen, a Windows or Linux host.
- A host path in an answer shows as a picture or a file row under the answer
  (`core/host-files.ts`); the words keep the file name only.
- The animated working mark (three dots) under the last message, with the
  words of the status line and no drawn face.
- The chat list: every profile (`/api/profiles/sessions`), the next page at
  the end of the list, a Channels button and a Profiles button with a list
  each (readable names, icons, the bots' pictures), the channel icon on every
  row, the bot's name on a row of another profile. With one bot chosen, "New
  chat" is a chat with that bot (the Backend bot answered "backend"). Before,
  the phone showed 1 of 14 Telegram chats and 1 of 25 API chats.
- A closed chat leaves the conversation store (`closeConversation`); a chat
  whose socket dropped in a turn resumes when the link is back.
- The bot list loads when the link opens. The link banner says the fault in
  plain words (`linkProblem`).

Host changes, seventh session (allowed by the owner):
- `~/.hermes/plugins/screen-remote/` (copied by `host/screen-remote/install.sh`)
  and `screen-remote` in `plugins.enabled` of `~/.hermes/config.yaml`. Backup:
  `~/.hermes/backups/screen-remote-2026-10-09/config.before.yaml`. Undo:
  `hermes plugins disable screen-remote`, delete the folder, restart the
  backends. The main install (port 9119) reads the same plugin folder and
  loads it at its next start; it is a plugin, not a core patch.
- The phone's backend was restarted three times (code and checkout out of
  step, the plugin, the ledger commit).
- Ledger: one row in `scripts/local-features/README.md`, commit `aa5e5e6896`
  on `native-app/backend`, for the plugin.
- Backend patch 0005 (`scripts/local-features/0005-preview-local-domains.patch`,
  commits `e2c04cf01b`, `04d873a43b`, `5c47a7ee2b`): the preview proxy takes a
  local-development name and rewrites a page against its final address.
- `~/.hermes/config.yaml`: a new block `preview: local_domains: [test]`.
  Backup: `~/.hermes/backups/screen-remote-2026-10-09/config.before-preview-domains.yaml`.
  Undo: delete the `preview` block.

Memory, seventh session (development build): 452 MB after a start, 477 MB
with the list loaded, 543 MB after many chats and views (three opens of a
chat in a row: 542, 542, 543 MB, so nothing stays for each open now). The
conversation store kept every opened chat before; that was a part of the
4 MB finding. Measure the release build still.

Open memory finding (older, see the line above): about 4 MB stays after each open of a LONG chat (151
rows) in a development build; a short chat and a light screen keep nothing;
the JavaScript heap grows only 0.4 MB an open. Before the inverted list it
was 8 MB. Measure again in the release build. If it stays, use Instruments
(Allocations) on the Simulator: the growth is native, per drawn row.

How to get past the system's "Allow notifications" alert with no tap: copy
the entry of another app that has the permission inside
`<device>/data/Library/BulletinBoard/VersionedSectionInfo.plist` to this
app's bundle ID (the two IDs must have the same length, the value is a
binary plist with the ID inside), with the Simulator shut down. A simulated
push: `xcrun simctl push <device> com.example.hermesnative payload.json`.

NOT checked on a real phone, and only a phone can show them: echo
cancellation (the Simulator's microphone was muted in the checks, see below),
a call with the screen locked, the earpiece and a headset, the wake word in a
room.

How the voice checks ran: the owner had a meeting in the room, and an open
microphone sent its speech to Deepgram and into a test chat. So the checks
feed speech with `scripts/say-to-call.sh "words"`: the Mac's `say` writes a
file, the driver feeds it to the call in the place of the microphone
(`h.hear`), and the microphone stays muted through every start of the audio.
Use that script. Do not use `say` through the speakers while people talk in
the room.

In code, NOT seen on a screen (a script cannot use a native picker):

- "Take control" / "Hand back" in the preview (the refusal text is unit logic).
- The tap on the call circle (send now, stop the agent, stop the voice).

- The scroll-to-newest button and "keep the reading position" (need a drag).

- The photo library, camera and file pickers themselves. The upload path
  under them is checked (`h.stage`).
- A large photo is resized to a 2048 px long side before upload.
- "Paste a picture" in the attach list (shown when the clipboard has one).
- The pinch zoom, the swipe between pictures and the pull down to close.
- An upload fails at once when the link drops.
- The unread dot (no unread conversation was in the list).

Known rough edges, not fixed:

- A picture sent in an earlier run of the app does not show in the message
  after a restart. The backend holds images on the session and the stored
  prompt has no line for them. File and PDF names do show.
- The search field of the list matches the title and the preview of the 100
  newest conversations only. `GET /api/sessions/search` exists; not used.
- A conversation deleted or archived from another device stays open on the
  chat screen until the user leaves it.
- The Expo developer-menu button (blue gear) floats over the screen in a
  development build. It is not in a release build.

Not checked yet: the request cards (no approval came up), workspace
switching, sign-out, tablet width, a Tailscale or LAN address on a real phone
(the backend listens on 127.0.0.1:9130 only), dark mode on the new screens.

Build notes:

- `scripts/patch-expo-jsi.mjs` runs on `postinstall`. Expo SDK 57's
  `expo-modules-jsi` targets Swift 6.3; this Mac has Swift 6.2 (Xcode 26.3).
  The script makes that one module build. Delete it after an Xcode upgrade.
- Another project often holds Metro's port 8081 on this Mac. Use
  `npx expo run:ios --port 8082`. Do not stop the other Metro server.
- `expo-dev-client` is installed, so a build on a phone can load JS from the
  Mac over Wi-Fi or Tailscale.
- `ios/` is generated and not in git. After a change to `plugins` in
  `app.json`, run `npx expo prebuild -p ios` before `npx expo run:ios`, or the
  new Info.plist keys are missing (the camera then crashes the app).
- `--port` and `--no-bundler` cannot go together on `expo run:ios`.
- `react-dom` is pinned only to stop npm resolving a mismatched optional peer.
- After a change to native code (`modules/`, a new native package, `plugins`
  in `app.json`): `cd ios && pod install`, then `scripts/sim-build.sh <device>`.
  It builds with xcodebuild, installs, grants the microphone and starts the
  app, with no Metro and no tap. About 20 s when only the local module
  changed; about 8 minutes after a new pod.
- `scripts/voice-open.sh <engine> [chat id]` opens a call with the microphone
  muted from the start. `scripts/voice-latency.sh "question"` feeds a
  question and prints the times. A fed call says its answer through the
  Mac's speakers; only the microphone is muted.
- `h.voiceTrace` holds what the engines heard and did, with timing marks
  (development builds). `h.audio.stats()` gives numbers of the native audio. `h.gptLive()`
  starts the gpt-live engine with no call.
- A system alert (`Alert.alert`) cannot be closed by the driver. Start the
  app again to get rid of one.
- `xcrun simctl openurl <device> "hermes://settings"` opens a screen by deep
  link, but iOS shows an "Open in Hermes?" dialog that needs a tap. Dark mode
  needs no tap: `xcrun simctl ui <device> appearance dark`.
- Synthetic taps do not reach the Simulator on this Mac. Use the driver:
  `node scripts/drive.mjs '<expression>' ...`. Each argument is one JavaScript
  expression with `h` in scope: `h.press("Send")` (the exact name only),
  `h.pressLike("part of a title")`, `h.longPress("a title")`,
  `h.type("text")` (or `h.type("text", "Title")` for another input),
  `h.labels()`, `h.texts()`, `h.wait(ms)`, `h.rpc(method, params)`,
  `h.api()`, `h.stores.$sessions.get()`, `h.stage(sessionId, { uri, name, mimeType })`.
  Then `xcrun simctl io <device> screenshot`. Keep `h.labels()` and
  `h.texts()` short with `.slice()`: the list has 100 rows.
  A native picker, a share sheet and a system alert cannot be driven.
- To start the app with no tap: `xcrun simctl terminate <device>
  com.example.hermesnative` then `xcrun simctl launch <device>
  com.example.hermesnative`. The development client loads the last project.
  Do this after an edit to `src/dev/driver.ts` too.
- An edit to a store file reloads the whole app and the stores start empty.
- Test files for attachments go in the app's Documents folder:
  `xcrun simctl get_app_container <device> com.example.hermesnative data`.
- `"microphonePermission": false` in the image picker's plugin config REMOVES
  `NSMicrophoneUsageDescription`, also when another plugin sets it. The audio
  module then answers "denied" with no prompt. Both plugins have the text now.
- `xcrun simctl privacy <device> grant microphone com.example.hermesnative`
  grants the microphone with no tap. Run it AFTER the install of a new build.
- The Simulator's microphone is the Mac's. `say "a question"` on the Mac is
  heard by a voice call in the Simulator: that is how the call was checked.
- After `npx expo install <native module>`, run `pod install` in `ios/` before
  `npx expo run:ios`. Without it the build succeeds and the app stops at
  "Cannot find native module".
- Do not start `expo run:ios` with `CI=1`: Metro then does not watch files.
- Metro's debugger socket (`/json/list`) closes at once for a script on this
  Mac. That is why the driver exists.

Test data left in the owner's Hermes by the fifth session, safe to delete:
about ten chats from the voice checks ("Count slowly from one to thirty",
"Tell me one short fact about the moon", "Plan and delegate checking date",
several "New chat"). One of them, "Experimentation tool options for lagging
metrics", holds speech from the owner's meeting that the open microphone
picked up: the owner knows, and decides whether to delete it. The test bot,
the test key and the test schedule are gone again. The host's
`wake_word.enabled` is back to false.

Test data, seventh session: the chats "Screenshot screen and navigate to
example.com", "One-word greeting" and "Count from one to sixty" are in the
owner's Hermes (main profile), safe to delete. The test chat of the Backend
bot is deleted. Eight old chats were resumed for a timing test; nothing in
them changed. No hold is set. The scratch TextEdit document is closed and
its file is deleted.

## Remaining work, in order

Each item is one or more commits. Check the contract file for the RPC names.

**Speed**: DONE (eighth session). Keep it: measure a new screen the same way.
Measured in the Simulator, development build, host warm unless said:

| What | Before | After |
|---|---|---|
| App start to the first chat row | 1.8 s (5.8 s on a cold host) | at once (the list of the last run) |
| Requests of a start | 35 at the same time, each 1.2 to 3 s | 30 one after the other, 40 to 250 ms; the chat list 1.6 s |
| Providers and models, first open | 383 ms | 67 ms |
| API keys, first open | 412 ms | 161 ms |
| Logins and cards, first open | 158 ms | 32 ms |
| Schedules, first open | 296 ms | 44 ms |
| Voice, first open | 188 ms | 45 ms |
| Bots tab | the list after `profiles.list` (3 to 6 s cold) | 102 ms |
| A chat of 711 messages | 2.6 s, 1540 KB, 462 rows in memory | 0.5 s, 286 KB, 49 rows |
| A short chat | 0.2 s (1.5 s the first time) | 0.18 s |

How:
- `h.times()` and `h.timeTo(action, text)` in the driver (`observeRequests`
  in `store/link.ts`). Use them for every new screen.
- `store/cache.ts` + `core/cache.ts`: the chat list, bots, pictures, schedules
  and providers are kept in `Caches/lists/<workspace>/` and restored in
  `_layout.tsx` before the link opens. No secret goes there (no key value, no
  login). Sign-out removes the folder.
- `store/preload.ts`: one request at a time at link open (chat list, bots,
  providers, schedules, vault, keys, voice engines).
- The ten source counts run when the Channels list opens.
- `core/history-page.ts`: a chat opens with `session.resume {defer_history}`
  and `GET /api/sessions/{id}/messages?order=latest&limit=60&offset=N&inline_images=false`
  at the same time; `loadOlderHistory` reads the page before at the top of
  the list. `offset` counts back from the newest row. A tool row whose call
  is on an older page shows its name with no argument line.
- Why the host is slow on a first answer: `/api/profiles/sessions?profile=all`
  opens the store of EVERY profile for each request (12 here: 0.9 to 1.6 s
  warm), and the first request of a kind pays the imports. Requests at the
  same time wait for each other (the GIL). The desktop uses
  `/api/profiles/sessions/sidebar`, which has a cache; the phone hides the
  wait with its stored list. No backend patch was made for it.

WHERE THE WORK STANDS (end of the eighth session, 2026-10-09 20:00):

- Step 1 of the owner's prompt (speed): DONE, see "Speed".
- Step 2 (every "Left" line of items 2, 3, 4, 4b, 5, 7, 7b, 8, 9, 10, 13):
  DONE. Each item below says what was closed, what was seen, and what cannot
  be closed here with the reason (a real phone, an OpenAI key on the host, an
  interactive terminal, a pull request with no GitHub remote).
- Step 3: Kanban (item 11) is built and only partly checked: START THERE.
  Then capabilities (item 12, PER PROFILE), then ops (item 14, with
  `agents.list`).
- Step 4: the tablet layout (item 15). Not started.
- Step 5: the release (item 17). Not started. The owner APPROVED the bundle
  ID switch and the TestFlight upload (see "Owner's decisions, eighth
  session"). After the upload: the Approve and Deny buttons in the
  notification (approved), then the report and the handoff template in
  `~/Documents/Hermes Redesign Mobile App/`.
- Open questions for the owner: how a message from the phone goes into a
  group chat (item 8b, two ways); what happens to this file before the source
  opens.
- Owed to the backend checkout: one ledger line for the "whole screen"
  picture of the screen-remote plugin (see item 7b). No backend commit was
  made in the eighth session, so `host/patches` is in step (`host:check`
  passes).
- Host state changed in the eighth session: the screen-remote plugin was
  installed again twice (the `whole=1` picture) and the phone's backend was
  restarted three times. Nothing else on the host changed.
- Memory, eighth session (development build): 480 MB after a start, 498 MB
  after a tour of screens and a long chat; no timer, socket or microphone
  open after it. The release build is still not measured.
- Test data left on the owner's Hermes: turns added to the test chats
  "Count from one to sixty", "Plan and delegate checking date", "Open, read,
  and click example.com link", "Screenshot screen and navigate to
  example.com"; saved helper runs of the second of them. Removed again: the
  throwaway bot (twice), the test schedules (three), the scratch
  repository, the uploaded test files, the preview test file.

1. **Finish the device check**: the "Not checked yet" list above.
2. **Chat quality**: DONE (tables, tool detail sheet, copy and share,
   scroll-to-newest button, reading position; seventh session: haptics
   (`native/haptics.ts`; the pod was in the build already), a long press
   copies a user message, colour in code blocks (`core/highlight.ts`)).
   Eighth session, all "Left" lines CLOSED: the open of a long chat (see
   "Speed"), the capture of a screen tool under its row and large in the tool
   sheet (`toolPicture` in `core/tools.ts`; a stored row keeps the path), a
   file row only for a file that the host lists (`hostFilesThatExist`, one
   `/api/fs/list` a folder, kept 30 s).
3. **Composer**: DONE, every "Left" line CLOSED (eighth session):
   - The queue is ON THE PHONE (`core/queue.ts`, `components/queue-panel.tsx`),
     as in the desktop app (`apps/desktop/src/store/composer-queue.ts`): the
     gateway has NO call that lists or removes a queued prompt. A text message
     sent in a turn waits in the panel over the message field: steer (the
     wheel), send next, edit, remove; the panel collapses; a Stop pauses the
     queue. A message with files still goes to the host's queue.
   - A file over 12 MB goes up by `POST /api/files/upload-stream` (multipart;
     `HermesApi.upload` takes the `File` of expo-file-system as the part:
     Expo's fetch refuses React Native's `{uri}` part), to
     `<home>/.hermes-phone-uploads/`, then `file.attach {path}` /
     `image.attach {path}` / `pdf.attach {path}`. The upload copy is deleted
     when the session made its own. Limit 100 MB (the host's). Seen: 27 MB in
     41 s through Cloudflare.
   - A swipe to the left on a chat row: Pin, Archive. Use the PLAIN
     `Swipeable` of gesture-handler: the Reanimated one cost 2 MB a row
     (715 MB at start against 476 MB). The swipe itself was not made by a
     script; the two buttons were pressed.
4. **Session actions**: DONE (rename, pin, archive, delete, export, branch,
   source filter, archive view; seventh session: the profile switch, paging,
   and full-text search: three letters or more in the search field ask
   `GET /api/sessions/search` after 350 ms and show an "In messages" group
   with the match in strong ink). The search reads ONE profile (the chosen
   bot, else the host's own); the host has no search across profiles.
   Eighth session, every "Left" line CLOSED: projects (a Projects button;
   `projects.tree {preview_limit: 100}` gives the projects AND their rows in
   200 ms; `projects.project_sessions` answers null for an auto project; a new
   chat in a project sends `cwd`), bulk delete ("Select more to delete" in the
   row's sheet; `POST /api/sessions/bulk-delete` needs `profile` NAMED, also
   `default`), export as Markdown (built on the phone from the REST rows).
4b. **Browser preview**: DONE (`core/preview/browser.ts`, `store/browser.ts`,
   `components/preview-pane.tsx`). Eighth session, every "Left" line CLOSED:
   several pages (`$previewTabs`; the More button lists them; one WebView
   shows one page), the agent's marks (the desktop's overlay
   `watch-in-page.ts` is vendored as `WATCH_ENGINE_SOURCE` by
   `scripts/vendor-preview-engine.mjs`; `pin` / `unpin` / `hold` / `strobe`
   of `preview.act`, and a mark on a click), a file of the host as a preview
   (`hostFilePath`; it loads through `/api/fs/download`), and "Ask Hermes to
   start the server again" (`preview.restart`, for a loopback page). Seen: two
   pages, a pin with its label, a host HTML file. NOT seen: the restart (it
   needs a development server that hangs).
   The tool the model calls is `desktop_preview {action: open}` here.
5. **Subagents and the todo list**: DONE (`core/work.ts`, `store/work.ts`,
   `components/work-sheet.tsx`). Eighth session, every "Left" line CLOSED and
   SEEN on a helper that ran 50 s: a message from the phone changed what it
   reported ("steered"), Stop gave "Stopped". The list is in tree order
   (`helpersInTree`; this host has `max_spawn_depth` 1, so a helper of a
   helper was not seen). Failed starts (`delegations` of `subagent.list`) show
   with the reason. A row pauses new helpers (`delegation.pause`). When a turn
   ends the helpers are saved with `spawn_tree.save` under the STORED id, in
   the terminal app's record shape; "Earlier runs" lists them
   (`spawn_tree.list` / `load`). "Plan and helpers" is also in the chat's menu.
   A `delegate_task` of this host can be async: the turn ends and the result
   comes later as a new message.
6. **Push notifications (iOS)**: DONE on the placeholder bundle ID
   (`core/push.ts`, `store/push.ts`). Left for the release item: see "Push,
   what is left" above. Approve / Deny buttons inside the notification itself:
   the owner said "not now, maybe at the end" (2026-10-09). When ALL other
   items are done, ASK the owner; do not build them before a yes. They need
   `aps.category` in the backend payload (a patch) and a background answer
   path in the app.
7. **Voice**: DONE in the Simulator: full duplex, live words, speech while
   the answer streams, barge-in, wake word, gpt-live (built, see what is
   untested above), background audio. Eighth session CLOSED: the level of
   Hermes's voice in the call view (the audio module sends `onOutputLevel`
   from a tap on the player, only while it plays; seen 0.03 to 1.0 during
   speech), the earpiece button (`setCallSpeaker`, kept in the preferences),
   a voice list for the Deepgram engine (Settings, Voice; `DEEPGRAM_VOICES`;
   the phone opens the speak socket, so the voice is the phone's choice; the
   Orion voice spoke in a fed call). The other engines speak with the host's
   voice: the host has no route that sets it.
   CANNOT be closed here, and why:
   - Echo cancellation, the lock screen, a headset, a loud room
     (`SPEECH_LEVEL`, `BARGE_LEVEL`): only a real phone shows them.
   - gpt-live after the session answer: the host has no OpenAI key.
   - The wake word on Android: Android is deferred by the owner.
7b. **Watch and take over the agent's screen work**: DONE (`core/screen.ts`,
   `store/screen.ts`, `components/screen-view.tsx`, `host/screen-remote`).
   Eighth session CLOSED: SEEN on a running turn, the stop message reached
   the agent at once ("redirected") and it said what was left; "Hand back and
   continue" released the hold and the agent took its capture. Two fingers
   zoom and move the picture; one finger that moves is a drag (the plugin's
   `drag`). "The whole screen" in the window list (`/frame?whole=1`,
   `capture(app="screen")`): on this Mac the driver gives an EMPTY picture,
   and the plugin answers that in words (`_is_blank`). The strip is closable
   and shows only for live screen work or a hold; "Screen" is in the chat's
   menu (the owner found the strip always there).
   NOT made by a script: the pinch, the two-finger move, the one-finger drag.
   The view follows the agent's window only while its driver session is in
   the backend's memory; else the frontmost window. The hold ends by itself
   30 minutes after the last open view. `display.*` is NOT this item.
   LEDGER: the row of the plugin in `scripts/local-features/README.md` does
   not say "whole screen" yet. Add it with the next backend commit.
8. **Bots tab**: DONE (`core/bots.ts`, `store/bots.ts`,
   `src/app/(tabs)/bots.tsx`, `components/bot-sheet.tsx`). Eighth session:
   - The model of a bot (`PUT /api/profiles/{name}/model {provider, model}`;
     the host refuses a provider that is not connected, in words), a picture
     from the phone (`profiles.set_asset {name, asset: 'avatar', data}`, a
     256 px JPEG data address). Both calls ran on a throwaway bot; the photo
     picker itself cannot be driven.
   - The sections of the desktop app's Bots list. Each profile carries
     `ui_meta['hermes-bots']` = `{title, pinned, hidden, sectionId,
     sectionName, groups}`. `botGroups` makes the headings (Pinned, each
     section by name, No section, Put away); the readable name is
     `ui_meta.title`. The sheet files a bot (`profiles.configure {name,
     ui_meta, ui_meta_expected_revisions}`; it sends the whole record back,
     so no field of the desktop is lost). The ORDER of sections is a list in
     the desktop's own plugin storage, not on the host: the phone sorts by
     name.
   - `agents.list` is a list of background processes: it goes to item 14.
   - The schedules of one bot: see item 9.
   - REST calls of a bot's chat send the profile (the history page, the tool
     output). The download of a host file takes no profile: it is a path.
   Ninth session CLOSED: "Pin to the top" / "Unpin" and "Put away" / "Bring
   back" in the bot sheet (`fileBot`; seen on a throwaway bot, the record on
   the host changed each time); "Start as a copy of" is a row that opens a
   list with the bots' pictures.
8a. **A bot's own chat**: DONE (eighth session). The header shows the bot's
   picture and name (the title "Bot Chat" is plumbing: `BOT_CHAT_TITLE`); the
   menu has "Profile and settings of <bot>"; the menu has NO rename, archive,
   delete or pin for that chat, because the host finds a bot's chat by its
   title (see `apps/desktop/src/AGENTS.md`, "Bot Mode": never store a session
   id for it, never rename it). It opens through the page path: 0.2 s.
   Left: the per-profile capabilities in the sheet (item 12).
8b. **Group chat of bots**: DONE (ninth session; `host/group-rooms`,
   `store/rooms.ts`, `components/room-sheets.tsx`, `src/app/room.tsx`).
   FOUND: Hermes has its OWN room engine, the `groups.*` gateway methods
   (`gateway/hosted_room*.py`): `groups.create {room_id, name, members:
   [{member_id, profile, handle, display_name}]}` (2 to 6 members, FIXED at
   creation), `groups.send {room_id, event_id, payload: {text, thread_id}}`,
   `groups.log {since_seq}` (`message.user`, `message.member`,
   `turn.settled`, `room.activity` with `status: settled|bounded` = the round
   is closed), `groups.state` (`driver_status.working`), `groups.stop`,
   `groups.disband`. The host runs the round. NO client uses it: the desktop
   still runs its own rounds and keeps its rooms in plugin storage plus the
   bounded record `ui_meta['hermes-bots-groups']` on the main profile (16
   messages a room, 1200 characters a message, 48 KB), which it MERGES by
   message id on a pull (`mergeRemoteGroupChatSnapshotIntoRooms`).
   So the owner's "small host plugin" is a BRIDGE of about 380 lines
   (`host/group-rooms/dashboard/plugin_api.py`, routes under
   `/api/plugins/group-rooms`): `GET /status`, `GET /rooms/{id}`,
   `POST /rooms {name, members}`, `PATCH /rooms/{id} {name?, members?}`,
   `DELETE /rooms/{id}`, `POST /rooms/{id}/messages {text, id}`,
   `POST /rooms/{id}/stop`. A message goes into the record, then into an
   engine room `gr-<hash of room id and members>`; a thread of the plugin
   copies each answer back into the record until the engine closes the round.
   It calls only PUBLIC gateway methods, in process
   (`tui_gateway.server.handle_request`). The record is written with its
   revision (`ui_meta_expected_revisions`), and a refused write runs again.
   SEEN on two throwaway bots, light and dark: a room made from the phone, a
   message with both answers live (a round of two took 6 to 40 s), the stop
   button, rename, a third member added and removed, "Choose at least 2
   bots", close. The room opens in 70 ms from the list; one request every
   two seconds while the bots answer, none after; no timer after the screen
   closes (`unwatchRoom`).
   A host without the plugin: the room is readable and says why it takes no
   message; the "New group chat" button is not shown.
   Limits, all said in the app or the ledger: a member change starts a new
   engine room (the new member does not read the old messages); the engine
   knows only what was sent through it, not what the desktop's own rounds
   said; the record keeps 16 messages; a round made by the desktop app does
   not go through the host.
   NOT checked: the desktop app open on the same room at the same time (it
   merges by message id, so no double message is expected; whether it starts
   a round of its own for a message it did not send was not seen).
   Not built: the "needs you" badge of a room, a member's question or
   approval inside a room (`groups.approve`, `pending_actions` of
   `groups.state`), `groups.retry`.
   NEXT STEP for whoever owns the desktop app: move its rooms to `groups.*`;
   then drop the plugin and let the phone call `groups.*` itself.
9. **Cron**: DONE (`core/cron.ts`, `store/cron.ts`, `src/app/cron.tsx`;
   opened from the clock button of the Bots tab and from Settings). Checked
   in the Simulator on the owner's 5 jobs; create, resume, pause and delete
   ran on a paused test job. Eighth session, every "Left" line CLOSED and
   SEEN on test jobs (made, checked on the host, deleted): a schedule for
   another bot (the form sends `?profile=`), where the result goes
   (`GET /api/cron/delivery-targets`; `deliver` in the create body and in
   `updates`; `bot-chat:<profile>` shows as "The chat of <bot>"), templates
   (`GET /api/cron/blueprints`, `POST /api/cron/blueprints/instantiate
   {blueprint, values}` with `?profile=`; field types `time`, `enum`, `text`,
   `weekdays`), the whole text of a run (a run id `cron_output:<job>:<stamp>`
   is the file `<hermes_home>/cron/output/<job>/<stamp>.md`, read with
   `/api/fs/read-text`; any other run id is a session and opens as a chat).
   `components/choice.tsx` (`ChoiceRow`, `ChoiceSheet`) is the "button that
   opens a list": use it for every new choice. The driver presses a
   `ChoiceRow` by its label ("The result goes to") and an option by
   "<title>: <option>".
   DRIVER TRAP: `h.pressLike` now also matches the swipe actions of the chat
   rows ("Pin <title>"), which are mounted under every screen. Use `h.press`
   with the exact name.
10. **Workspace tab**: DONE (seventh session; `core/workspace.ts`,
    `store/workspace.ts`, `src/app/(tabs)/workspace.tsx`, `src/app/file.tsx`,
    `src/components/workspace/`). The user opens a folder of the host (the
    folder Hermes runs in, a project, a recent folder, a typed path). Four
    panels, only the one on screen is mounted. Checked in the Simulator on a
    scratch repository with a scratch remote: Files (one level at a time,
    folder above, text editor with save; a save is refused when the file
    changed on the host after it was opened), Changes (status, stage, unstage,
    diff, commit, commit and push: the commit reached the remote), Terminal
    (`shell.exec` in the folder, `cd` kept by the app, the host refused
    `rm -rf /` by its own guard), Preview (a port of the host loaded through
    the preview route). Host facts: `GET /api/fs/list|read-text`,
    `POST /api/fs/write-text {path, content}`, `GET /api/git/status`,
    `/api/git/review/list|diff`, `POST /api/git/review/stage|unstage|revert|
    commit|push {path, file?, message?, push?}`; a commit with nothing staged
    stages everything first; `shell.exec {command}` is one process with a 30 s
    limit and the last 4000 characters of output, no folder parameter.
    Added after the first check: "Browse the host" in the folder choice (from
    the home folder, into any folder; `shell.exec` gives the home folder), the
    Files panel goes above the opened folder, and the Preview is a browser
    (back, forward, the address). A local-development site of the host loads
    by its name (`app.test`): the app sends a `.test` or `.localhost` address
    through the host's preview route, and backend patch 0005 lets that route
    take such a name when `preview.local_domains` lists its domain and the
    name resolves to loopback (the owner's config lists `test`). The same
    patch fixes a page with no styles after an http to https redirect. Seen:
    a secured Herd site, fully styled.
    Eighth session CLOSED and SEEN on a scratch repository (made, used,
    deleted): a new file and a new folder (`/api/fs/write-text` with empty
    content, `/api/files/mkdir`), rename (the host has NO rename route:
    `shell.exec` runs `mv -n`, or `move` on a Windows host), delete
    (`DELETE /api/files {path, recursive}`), a search in the opened folder
    (`git grep` in a repository, `grep -rnI` or `findstr` elsewhere, through
    `shell.exec`), the branch list and a switch (`/api/git/branches`,
    `POST /api/git/branch/switch {path, branch}`), the other folders of the
    repository (`/api/git/worktrees`; a pick opens that folder), "Throw the
    changes away" (the question is in the panel now, and the file went back).
    Syntax colour was done in the seventh session.
    Built, NOT seen: "Open a pull request" (`ship-info` answers `{ghReady,
    pr}`; `create-pr` needs a GitHub remote, the scratch repository had none).
    CANNOT be closed here, and why:
    - An interactive terminal: `shell.exec` runs one command and ends. A
      program that waits for keys needs a PTY and a terminal emulator on the
      phone (escape codes, a cursor). That is a feature of its own size.
    - The `profile` of a folder (a bot with a remote file backend): the file
      routes of this host take a path only, and no bot here has such a
      backend to check against.
    The check cleared the list of recent folders of the Simulator.
11. **Kanban**: DONE (`core/kanban.ts`, `store/kanban.ts`,
    `src/app/kanban.tsx`; the "Board" button of the Bots tab). Routes under
    `/api/plugins/kanban`, each with `?board=<slug>`: `GET /boards`,
    `GET /board` (`columns: [{name, tasks}]`; a task carries its whole body,
    so the store keeps a short row), `GET /tasks/{id}` (`task`, `comments`),
    `PATCH /tasks/{id} {status, assignee, title, body, summary,
    block_reason}`, `POST /tasks/{id}/comments {body, author}`,
    `POST /tasks {title, body, assignee, triage}`, `DELETE /tasks/{id}`.
    Ninth session, SEEN in light and dark: a real card with its comments
    (255 ms; the board 190 ms), and on a throwaway card of the empty Default
    board: make, comment, move, assign, unassign, delete (each 130 to 350 ms).
    Host rules found and built in (`moveChoices`, `moveQuestion`,
    `cardFault`): the host refuses `running` ("In work" is not offered), it
    closes a card only with a `summary` (the sheet asks "What was done"), a
    block takes `block_reason` (the sheet asks, optional), and a refusal shows
    in plain words. A card in `ready` with a bot on it STARTS that bot: never
    put a test card there. The host itself rewrites a card that waits to be
    sorted (title, text, and it gave the card to `default`): that is its
    triage step, not the app.
    DRIVER: a card row is pressed by `h.pressLike("<title><last line>")`;
    `h.press("Board", -1)` presses the LAST control of that name (the Bots tab
    has a "Board" button under the screen).
    Not built: links between cards, attachments, runs of a card
    (`/runs/{id}`, terminate, reclaim), a new board, the live update
    (`latest_event_id`; the screen has pull to refresh).
12. **Capabilities**: DONE, PER PROFILE (ninth session; `core/capabilities.ts`,
    `store/capabilities.ts`, `src/app/capabilities.tsx`; Settings, "Skills and
    tools", and the same row in a bot's sheet, which opens the screen on that
    bot). The screen starts from a Bot row (the bot's picture, a list of the
    bots), then a Show row (Skills, Tools, MCP servers, Plugins, each with
    "N of M on"), a search field, and a virtual list with a switch a line.
    Every call sends the profile: `GET /api/skills?profile=`,
    `PUT /api/skills/toggle {name, enabled, profile}`,
    `GET /api/tools/toolsets?profile=`, `PUT /api/tools/toolsets/{name}
    {enabled, profile}`, `GET /api/mcp/servers?profile=`,
    `PUT /api/mcp/servers/{name}/enabled {enabled, profile}`,
    `plugins.manage {action: 'list' | 'toggle', key, enable, profile}`.
    SEEN on a throwaway bot, light and dark: a skill, a group of tools and a
    plugin switched off and on again; the host showed the change for that bot
    and the main bot kept its values. Times: skills 0.5 to 0.9 s (147 rows,
    25 KB), tools 0.3 s, MCP 0.1 s, plugins 0.8 s; a switch 150 ms. The lists
    are dropped when the screen closes.
    Rules built in: a row keeps its place when its switch moves; the sign-in
    plugin of the host (`dashboard_auth/*`) cannot be switched off from the
    phone; a group of tools the host cannot run is locked with the reason; a
    description made of tool keys shows as a count; a plugin change that
    needs a restart says so (`restart_required`).
    DRIVER: `h.flip("<title>", true|false)` sets a switch, `h.switches()`
    lists them.
    NOT pressed: the switch of an MCP server (the throwaway bot has none, and
    the owner's two servers were left alone).
    Not built: connectors (`connectors.list {profile, owner: {type:
    'account'}}` answers `available: false` on this host, so nothing can be
    checked), add or remove an MCP server, install a skill or a plugin, the
    text of a skill.
13. **Settings**: DONE: the vault (`src/app/vault.tsx`), Voice
    (`src/app/voice.tsx`), providers and models (`src/app/providers.tsx`), API
    keys (`src/app/keys.tsx`); rules in `core/providers.ts`. Eighth session,
    every "Left" line CLOSED (`src/app/host.tsx`, `core/host-settings.ts`,
    `store/host-settings.ts`; Settings, "Helper models and memory"): the
    helper models (`GET /api/model/auxiliary` → `tasks`; `POST /api/model/set
    {scope: 'auxiliary', task, provider, model}`, `provider: 'auto'` gives the
    choice back), own endpoints (`/api/providers/custom-endpoints`: list,
    `POST` to add, `/validate` to reach it first, `/{id}/activate`, `DELETE`),
    the kind of memory (`GET /api/memory`, `PUT /api/memory/provider
    {provider}`; `''` is the built-in memory), the key check
    (`POST /api/providers/validate {key: <env name>, value}` → `{ok,
    reachable, message}`; `saveProviderKey` calls it first). Seen: the screen
    in light and dark; the four calls with values that change nothing (a
    wrong key was refused, a dead address said so). NOT pressed in the app:
    add, use and remove of an endpoint (no endpoint server to add).
    Notifications: the row of Settings shows the state and opens the system
    settings (sixth session). WHICH requests push is `push.kinds` in the
    host's config: a host setting, no route sets it. Appearance is
    DONE (seventh session): System, Light or Dark in Settings, stored in the
    preferences and applied with `Appearance.setColorScheme` (the value for
    "system" is `'unspecified'` in this React Native, not null). Every new
    screen must be checked in dark mode too (the owner asked for both).
14. **Ops**: System (gateway status, logs, restart, update), Usage (tokens,
    cost), Maintenance (doctor, audit, backup, debug share, curator, memory
    reset), session import (`session.foreign.*`).
15. **Tablet layout**: list + detail split at 768 pt and wider
    (`useIsTablet`). Screens already cap their width at 760 pt.
16. **Android**: build, back gesture, permissions. Push needs FCM, which the
    backend does not have. Deferred.
17. **Release**: take over the old app's bundle ID and configuration (see
    "This app replaces the old one"), icons, splash, TestFlight via a local
    build.

Deferred by the owner: messaging and webhooks setup. Out: starmap, artifacts
gallery.
