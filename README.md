# Hermes native

A React Native (Expo) app for [Hermes](https://github.com/NousResearch/hermes-agent):
the remote control for an agent that runs on your own machine. The app has no
WebView for its own screens. It talks to a Hermes backend over REST and a
JSON-RPC WebSocket.

## What it does

- **Chats**: every conversation of every profile, with search in titles and
  messages, filters by channel and by profile, streaming answers, tool rows,
  attachments, queue and steer during a turn.
- **Hermes needs you**: approvals, questions, secrets and sign-in codes, in the
  chat, in the Activity tab and as push notifications.
- **Voice**: a full-duplex call with the agent, dictation, read aloud, and a
  wake word.
- **Bots**: the profiles of the host. Talk to one, edit one, add one.
- **Screen**: watch the window the agent works in, stop the agent with a
  reason, act in the window from the phone, hand back.
- **Workspace**: a folder of the host. Browse and edit files, review and
  commit git changes, run commands, preview a page.
- **Settings**: providers and models, API keys, logins and cards, schedules,
  voice, appearance (system, light, dark).

## Requirements

- A Hermes backend that the phone can reach (the dashboard server), with a
  user name and a password. An access proxy in front of it is supported.
- A current Node release, and Xcode for an iOS build.

## Build and run

```bash
npm install
npm run verify        # type check, lint, tests
npx expo run:ios      # local build; no cloud build service
```

On first launch, enter the address of your Hermes and your account. The app
stores them in the Keychain / Keystore. Nothing about a host is in the source.

The bundle identifier and the signing team come from the environment at build
time. Do not commit them.

## The host side

The app works with a stock Hermes. Two features need a small addition on the
host:

| Feature | What the host needs |
|---|---|
| Screen view (watch, stop, take over) | The plugin in [`host/screen-remote`](host/screen-remote). Run `install.sh` on the host, then restart Hermes. It is plain Python on the computer-use driver that Hermes ships, so it is the same on macOS, Linux and Windows. |
| Push notifications | A push service on the backend that sends to the Apple Push Notification service, with your own key and bundle identifier. |

A host with no plugin still works: the screen view says what is missing.

## Layout

```
src/app/         routes (thin)
src/core/        pure logic, no React and no native modules, with tests
src/store/       state and side effects: the link to the host, one store per feature
src/components/  shared UI
src/native/      wrappers of native modules
modules/         local native modules
host/            plugins for the Hermes host
scripts/         build and check helpers
```

Rule: logic goes in `src/core` with a test. Stores connect `core` to the host.
Routes draw stores.

## Checks

`npm run verify` runs the type check, the linter and the tests. Run it before
every commit.

## Privacy

The app sends data only to the Hermes host you sign in to. It has no analytics
and no third-party service of its own.
