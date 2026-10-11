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

NOT YET. Until this app is complete the owner uses the old app. Keep the
placeholder bundle ID `com.example.hermesnative` so both apps install side by
side. Do the switch only when the owner says so.

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

## Working rules (from the owner)

- Do the work inline. Subagents only when clearly worth the cost: Sonnet at
  medium effort, or Haiku for a simple search.
- Protect memory and CPU. The machine has 16 GB and is often loaded. Do not
  start the iOS Simulator, Playwright or a browser unless the owner asks.
  When the owner asks for a device check and the Simulator runs, drive it
  with `scripts/drive.mjs` (see "Build notes"). Check
  with `npm run verify`, plus `npx expo export --platform ios` for a bundle
  check. The owner runs the app on a device.
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
    `stt.streaming`; this host says false, so the phone sends each turn as a
    WAV to `/api/audio/transcribe`) and `/api/audio/speak-stream`. Both sockets
    sign in with `?ticket=` like `/api/ws` (`openSiblingSocket`).
  - `gpt-live`: WebRTC. `POST /api/audio/voice-live/session {sdp, history}`.
- This host's `speak-stream` answers `{"type":"fallback"}`: its log says
  "ffmpeg is required to decode TTS audio" (the backend's PATH has no
  `/opt/homebrew/bin`). The relay engine then asks `/api/audio/speak` for each
  sentence. To get the faster PCM path, give the backend ffmpeg on its PATH.
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
- More: `~/.hermes/hermes-mobile-handover.md` (sections "Auth contract" and
  "Traps that cost time").

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

- Dictation into the message field and "read aloud" under an answer (they use
  the same listen, transcribe and speak code as the call).
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
- `h.voiceTrace` holds what the Deepgram engine heard and did (development
  builds). `h.audio.stats()` gives numbers of the native audio. `h.gptLive()`
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

## Remaining work, in order

Each item is one or more commits. Check the contract file for the RPC names.

1. **Finish the device check**: the "Not checked yet" list above.
2. **Chat quality**: DONE (tables, tool detail sheet, copy and share,
   scroll-to-newest button, reading position). Left: haptics (needs
   expo-haptics and a native build), copy for a user message, syntax colour
   in code blocks.
3. **Composer**: queue + steer, attachments, thumbnails, preview, photo
   resize and paste are DONE. Left:
   - A way to see and cancel the backend queue.
   - A REST upload (`/api/files/upload-stream`) to remove the 12 MB limit.
   - Swipe actions on a list row (pin, archive) with gesture-handler.
   - Old notes, kept for context:
   - The device check.
   - Thumbnails (the owner asked for this): a small image preview in the
     staged chip and in the sent user row; for a file, an icon by type with
     the name and the size. The picker already gives a local `uri` for the
     image, so the chip needs no download. Keep the `uri` on the `Attachment`
     and on the user row. A resumed conversation has no local `uri`; show the
     file name there.
   - Large files: a file over 12 MB is refused with a red chip. Shrink large
     images on the phone before upload (long side about 2048 px,
     `expo-image-manipulator`, needs a native rebuild), and say the limit in
     the attach menu. A REST upload would remove the limit; check first if
     the backend has such a route.
   - Paste an image from the clipboard.
   - A way to see and cancel the backend queue.
4. **Session actions**: DONE (rename, pin, archive, delete, export, branch,
   source filter, archive view). Left: projects, full-text search
   (`GET /api/sessions/search`), bulk delete, export as Markdown.
4b. **Browser preview**: DONE (`core/preview/browser.ts`, `store/browser.ts`,
   `components/preview-pane.tsx`). Left: several tabs (the phone shows the
   last opened page), the annotation actions (`pin`, `hold`, `strobe` draw
   nothing on the phone), file and artifact previews from `preview.open`
   (only web addresses load), `preview.restart`.
5. **Subagents and the todo list**: DONE (`core/work.ts`, `store/work.ts`,
   `components/work-sheet.tsx`). Left: check steer and stop on a helper that
   runs long, the spawn tree (`spawn_tree.*`), failed async delegations
   (`delegations` of `subagent.list`), `delegation.pause`.
6. **Push notifications (iOS)**: expo-notifications, register the APNs token
   with `POST /api/push/register`, open the named session on tap. Use the
   old app's push setup, not a new key: see "This app replaces the old one".
   A push test needs the old app's bundle ID, so it needs the owner's word. Backend
   code: `hermes_cli/push/` and `hermes_cli/web_routers/push.py` in the Hermes
   repo. Sandbox vs production environment must match the build type.
7. **Voice**: DONE in the Simulator: full duplex, live words, speech while
   the answer streams, barge-in, wake word, gpt-live (built, see what is
   untested above), background audio. Left:
   - A check on a real phone: echo cancellation, the lock screen, a headset.
     The duck gain is 1 (`MIC_GAIN_WITH_ECHO_CANCELLING`); if the voice
     interrupts itself on a phone, look at `PLAYBACK_TAIL_MS` and the echo
     check first.
   - gpt-live with an OpenAI key on the host.
   - The relay engine with `stt.streaming` on the host (live words), and with
     ffmpeg on the host (the PCM stream, with no fallback).
   - Dictation still records a file with expo-audio and sends it. Move it to
     the call's audio and `transcribe-stream`, so the words show while the
     user talks.
   - Read aloud still waits for the whole speech file. Use `speak-stream`.
   - The earpiece (`duplexAudio.setSpeaker(false)` exists, no button), a
     voice picker, the wake word on Android (the module is iOS only).
   - The level in the call view is the microphone. Show the voice's level
     while it speaks.
   - A relay call in a loud room: `SPEECH_LEVEL` and `BARGE_LEVEL` in
     `store/voice-relay.ts` are first guesses.
7b. **Bot screen (computer use)**: not started; needs a Linux or Docker host
   to run. Plan: a card with `display.status`, a picture from
   `display.thumbnail` every 2 s, "Take over" / "Hand back" with
   `display.lease.acquire` / `.release`, then the live screen with noVNC in a
   WebView on `/api/display/ws` (ticket from `display.observe`).
8. **Bots tab**: DONE for profiles (`core/bots.ts`, `store/bots.ts`,
   `src/app/(tabs)/bots.tsx`): the list with pictures, the bot's own chat in
   its profile, role, SOUL.md, rename, delete, add (new or a copy). Checked
   in the Simulator on the owner's 12 bots; create, describe, rename and
   delete ran on a throwaway bot through the same calls. Left: the model of a
   bot (`PUT /api/profiles/{name}/model`), a picture from the phone
   (`profiles.set_asset`), `agents.list`, the bot cron of hermes-bots, and
   the other calls of a bot's chat: `session.resume` takes `profile`, and the
   calls after it go by the live session id, but REST calls for that chat
   (tool output of a stored row, file download) do not send `?profile=` yet.
9. **Cron**: DONE (`core/cron.ts`, `store/cron.ts`, `src/app/cron.tsx`;
   opened from the clock button of the Bots tab and from Settings). Checked
   in the Simulator on the owner's 5 jobs; create, resume, pause and delete
   ran on a paused test job. Left: where the result goes (`deliver`, from
   `/api/cron/delivery-targets`), a schedule for another bot than the main
   one (the create form sends no profile), blueprints
   (`/api/cron/blueprints`), the whole text of a past run.
10. **Workspace tab**: NEXT. Not started. File tree with edit and save (REST `files` router),
    terminal (interactive; a small xterm WebView is acceptable here, or a
    native text view over `agent.terminal.output` + `shell.exec`), preview
    (WebView onto the backend preview host, `preview.*` events, take over and
    hand back), git review (diff, stage, commit, push, PR).
11. **Kanban**: boards, tasks, comments (plugin REST API).
12. **Capabilities**: skills, MCP servers, toolsets, plugins, connectors
    (`connectors.*`).
13. **Settings**: DONE: the vault (`src/app/vault.tsx`), Voice
    (`src/app/voice.tsx`), providers and models (`src/app/providers.tsx`), API
    keys (`src/app/keys.tsx`); rules in `core/providers.ts`. Left: custom
    endpoints (`/api/providers/custom-endpoints`), the auxiliary models
    (`POST /api/model/set` with `scope: "auxiliary"`), a key check before the
    save (`/api/providers/validate`), memory, notifications, appearance.
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
