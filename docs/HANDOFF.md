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
src/store/               nanostores atoms + side effects
  workspaces.ts          SecureStore persistence
  link.ts                the ONE live link (REST + socket), redial with backoff
  sessions.ts, chat.ts, requests.ts
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
sending a message and the streamed answer.

Not checked yet: the request cards (no approval came up), stop, new chat,
workspace switching, sign-out, dark mode, tablet width, a Tailscale or LAN
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
- `react-dom` is pinned only to stop npm resolving a mismatched optional peer.
- To open a screen without a tap: `xcrun simctl openurl <device> "hermes://settings"`
  (expo-router deep link, scheme `hermes`).
- Synthetic taps do not reach the Simulator on this Mac. Check screens with
  `xcrun simctl io <device> screenshot`; the owner does the typing.

## Remaining work, in order

Each item is one or more commits. Check the contract file for the RPC names.

1. **Finish the device check**: the "Not checked yet" list above.
2. **Chat quality**: Markdown tables (the parser in `core/markdown.ts` has no
   table block yet), tool row
   detail sheet (args, output, inline diff), copy and share, scroll-to-bottom
   button, keep position when reading history, haptics.
3. **Composer**: model picker and reasoning picker (`model.options`,
   `config.set`), slash commands (`complete.slash`, `slash.exec`,
   `command.dispatch`), `@` file references (`complete.path`), queue + steer
   (`prompt.submit` status `queued` / `steered`, `queued` param), attachments
   (`image.attach_bytes`, `file.attach`, `pdf.attach`; expo-image-picker,
   expo-document-picker, camera).
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
