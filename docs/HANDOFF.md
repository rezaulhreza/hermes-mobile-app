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

## Working rules (from the owner)

- Do the work inline. Subagents only when clearly worth the cost: Sonnet at
  medium effort, or Haiku for a simple search.
- Protect memory and CPU. The machine has 16 GB and is often loaded. Do not
  start the iOS Simulator, Playwright or a browser unless the owner asks. Check
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
  chat/[id].tsx          one conversation
src/core/                pure logic, no React, no native modules. Tested.
  gateway/               VENDORED from hermes-mobile/apps/shared/src. Do not edit by hand.
  api.ts                 REST client: proxy headers, sign-in + replay on 401 no_cookie
  workspaces.ts          workspace model, validation, storage parsing
  transcript.ts          gateway events -> chat rows (reducer)
  requests.ts            agent -> user requests (approval, clarify, secret, sudo, code, vault)
  commands.ts            slash commands on a phone: blocked ones, the app's own actions, the sheet
  composer.ts            completion triggers, what a slash answer means
  attachments.ts         kinds, the size limit, the prompt text an attachment adds
src/store/               nanostores atoms + side effects
  workspaces.ts          SecureStore persistence
  link.ts                the ONE live link (REST + socket), redial with backoff
  sessions.ts, chat.ts, requests.ts
  commands.ts            the backend command catalog, one copy per link
  attachments.ts         pickers + upload; the staged list per conversation
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

Done on 2026-10-09 (second session), `npm run verify` green, NOT yet seen on
a screen by the owner:

- The slash list hides commands with no phone surface. Typing one gives the
  reason as a notice.
- `/help` opens a command sheet built from `commands.catalog`; a tap puts the
  command in the composer.
- `/new`, `/branch` switch the screen to the new conversation. `/title` renames.
  `/model` opens the model sheet. `/resume` goes back to the list.
- Queue + steer: during a turn the send button queues and a Steer button
  appears. The user row says what the backend did.
- Attachments: a plus button offers photo library, camera, file. Chips show
  upload state. Needs the native build with expo-image-picker,
  expo-document-picker, expo-file-system.
- Composer gap closed; one `MONO` font token for both platforms.

Known rough edges, not fixed:

- A chat opened with `live=1` whose conversation is no longer in the store
  (the stores reset on a JS reload) shows a spinner forever. Resume it by its
  stored id, or go back.
- A resumed conversation shows the raw prompt of an old message with
  attachments (`@file:...` lines), not the file names.
- `/model <name>` ignores the name and opens the sheet. `/resume <query>`
  ignores the query.
- `/compress` only prints a notice. The rows on screen stay as they were.
- Stop during a turn with queued messages: UNVERIFIED whether the backend
  still runs the queue. The rows keep their "Queued" label until a turn starts.
- An attachment staged while the link drops stays "uploading" until the
  request times out (180 s).

Not checked yet: everything in the "second session" list above, the request
cards (no approval came up), workspace
switching, sign-out, tablet width, a Tailscale or LAN
address on a real phone (the backend listens on 127.0.0.1:9130 only; the
Simulator reaches it as `127.0.0.1:9130`).

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
- `xcrun simctl openurl <device> "hermes://settings"` opens a screen by deep
  link, but iOS shows an "Open in Hermes?" dialog that needs a tap. Dark mode
  needs no tap: `xcrun simctl ui <device> appearance dark`.
- Synthetic taps do not reach the Simulator on this Mac. Check screens with
  `xcrun simctl io <device> screenshot`; the owner does the typing.

## Remaining work, in order

Each item is one or more commits. Check the contract file for the RPC names.

1. **Finish the device check**: the "Not checked yet" list above.
2. **Chat quality**: Markdown tables (the parser in `core/markdown.ts` has no
   table block yet), tool row
   detail sheet (args, output, inline diff), copy and share, scroll-to-bottom
   button, keep position when reading history, haptics.
3. **Composer**: DONE in code (queue + steer, attachments). Left: the device
   check, image thumbnails in the chips and in the user row, paste an image
   from the clipboard, a way to see and cancel the backend queue.
4. **Session actions**: rename (`session.title`), pin, archive
   (`session.archive`), delete (`session.delete`), export, branch
   (`session.branch_stored`), projects and filters, source/channel filter.
5. **Subagents**: live list and transcript (`subagent.*` events,
   `subagent.list`, `subagent.tail`), steer, interrupt. Todo list
   (`todo.updated`).
6. **Push notifications (iOS)**: expo-notifications, register the APNs token
   with `POST /api/push/register`, open the named session on tap. Backend
   code: `hermes_cli/push/` and `hermes_cli/web_routers/push.py` in the Hermes
   repo. Sandbox vs production environment must match the build type.
7. **Voice**: live voice conversation, both engines (`chained`, `gpt-live`).
   Read the desktop code first: `apps/desktop/src/app/chat/composer/voice-*`
   and the `voice.*` RPCs and events. Full-screen call view and in-chat voice
   are two views of ONE call. Needs microphone permission, background audio
   mode, barge-in, mute, end. The Iris app (`~/Developer/indie/iris-rs/mobile`)
   uses `react-native-audio-api` and has a working voice controller to learn
   from. This is the largest item.
8. **Bots tab**: profiles (list, create, rename, delete; `profiles.create`
   and REST), agents, hermes-bots (bot chat, bot cron). Profile scope: every
   REST call takes `?profile=`, RPCs take a `profile` param.
9. **Cron**: list, create, edit, pause, run, history (REST under `/api/cron`,
   event `cron.changed`).
10. **Workspace tab**: file tree with edit and save (REST `files` router),
    terminal (interactive; a small xterm WebView is acceptable here, or a
    native text view over `agent.terminal.output` + `shell.exec`), preview
    (WebView onto the backend preview host, `preview.*` events, take over and
    hand back), git review (diff, stage, commit, push, PR).
11. **Kanban**: boards, tasks, comments (plugin REST API).
12. **Capabilities**: skills, MCP servers, toolsets, plugins, connectors
    (`connectors.*`).
13. **Settings**: providers, API keys (`model.save_key`), models, memory,
    vault (`vault.*`), notifications, appearance. Adding credentials for the
    agent is a main use on the phone: make it fast.
14. **Ops**: System (gateway status, logs, restart, update), Usage (tokens,
    cost), Maintenance (doctor, audit, backup, debug share, curator, memory
    reset), session import (`session.foreign.*`).
15. **Tablet layout**: list + detail split at 768 pt and wider
    (`useIsTablet`). Screens already cap their width at 760 pt.
16. **Android**: build, back gesture, permissions. Push needs FCM, which the
    backend does not have. Deferred.
17. **Release**: real bundle ID (the committed one is a placeholder), icons,
    splash, TestFlight via a local build.

Deferred by the owner: messaging and webhooks setup. Out: starmap, artifacts
gallery.
