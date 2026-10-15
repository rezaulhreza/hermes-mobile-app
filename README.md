# Hermes native

## What it is

A phone app for [Hermes](https://github.com/NousResearch/hermes-agent), built
with React Native (Expo). Hermes is an AI agent that runs on your own computer.
This app is its remote control.

## What it is for

Hermes works all day on your machine. With this app you can talk to it, see
what it does, and answer when it needs you, from anywhere.

## Features

- **Chats**: all your conversations, with search. Answers stream in. You can
  attach files, queue messages, and steer a running answer.
- **Hermes needs you**: approvals, questions and passwords show in the chat
  and as push notifications. You can approve or deny from the notification.
- **Voice**: a live call with the agent, dictation, read aloud, a wake word.
- **Bots**: each bot is its own agent. Talk to one, edit one, add one. Group
  chats of bots.
- **Background work**: see the commands a chat left running, and stop them.
- **Screen**: watch the window the agent works in, stop it, take over.
- **Workspace**: files, git changes, a terminal and a page preview of a
  folder on the host.
- **Board and schedules**: Kanban cards and cron jobs of the bots.
- **Skills and tools**: switch them on or off, bot by bot.
- **The host**: state, usage, logs, health check.
- **Settings**: models, API keys, logins, voice, light and dark.
- **Tablet**: the chat list stays beside the open chat.

## Requirements

- A Mac with Xcode (for the iOS build).
- A current Node release.
- CocoaPods.

## Before you start

You need a running Hermes that your phone can reach:

1. Hermes runs its dashboard server (`hermes dashboard`).
2. The server has a user name and a password.
3. The phone can reach its address (same Wi-Fi, Tailscale, or a tunnel such
   as Cloudflare).

## Install and run

```bash
npm install
npm run verify              # type check, lint, tests
npx expo run:ios            # build and start in the iOS Simulator
```

On first launch, type the address of your Hermes, your user name and your
password. The app keeps them in the Keychain.

Useful commands:

| Command | What it does |
|---|---|
| `npm run verify` | Type check, lint and tests |
| `npx expo start --port 8082` | Start the development server |
| `scripts/sim-build.sh <device id>` | Build and install after a native change |
| `node scripts/drive.mjs 'h.press("Settings")'` | Press and type in the app from a script |
| `scripts/release-ios.sh upload` | Build and send to TestFlight |

## Extra parts for the host

Most features work with a plain Hermes. A few need an add-on on the host. All
of them are in [`host/`](host):

| Feature | What to install |
|---|---|
| Screen view | `host/screen-remote/install.sh` |
| Write into group chats | `host/group-rooms/install.sh` |
| Push notifications | `host/phone-push/install.sh` |
| Page preview of the host | `host/phone-preview/install.sh` |
| One session fix: a chat open on the desktop does not refuse the phone | `host/patches/apply.sh /path/to/hermes` |

Restart Hermes after each one. Without an add-on the app still works; the
feature says what is missing. Details: [`host/patches/README.md`](host/patches/README.md).
After a Hermes update, follow [`host/patches/LEDGER.md`](host/patches/LEDGER.md).

## Release your own build

Your bundle identifier, team and keys are yours. They never go in the source.

1. Put them in a file outside the project (`~/.config/hermes-native/release.env`).
   `app.config.js` and `scripts/release-ios.sh` list the names.
2. Run `scripts/release-ios.sh upload`.

## Change or extend the app

```
src/app/         screens
src/core/        logic, with tests
src/store/       state, one file per feature
src/components/  shared UI
modules/         native code
host/            add-ons for the Hermes host
```

Rules in short:

- Put logic in `src/core` and write a test for it.
- Check every new screen in light and dark.
- Never commit a name, an address or a key of your own.

More: [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md).

## Status

- iOS works.
- Android is not fully built and may need more work. The screens and the
  logic are shared, but the app was never built or run on Android.
- The app needs the Hermes backend; it does not run an agent itself.

What Android still needs:

1. The Android project (`npx expo prebuild -p android`) and a first build.
2. Plain `http` to a host on your Wi-Fi: Android blocks it until a setting
   allows it.
3. Voice calls: the call audio is a Swift module. It needs an Android side
   in Kotlin.
4. Push notifications: the host sends through Apple only. Android needs
   Firebase on the host and in the app.
5. A check of every screen on an Android phone, in light and dark.
6. A signed release build for the Play Store.
