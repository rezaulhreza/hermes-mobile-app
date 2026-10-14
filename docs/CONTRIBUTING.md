# Working on Hermes native

This file is for anyone who changes the app. It says how the code is laid out, how to check
a change, and what the repository must never hold.

## Layout

```
src/app/          expo-router routes. Thin: a route renders stores.
src/core/         pure logic. No React, no native module. Every file has a test.
  gateway/        vendored from the Hermes repository. Do not edit by hand.
src/store/        nanostores atoms and their side effects: they join core to the link.
src/components/   shared UI
src/native/       wrappers of native modules
src/theme/        tokens, the palette of light and dark
src/dev/          development builds only: the driver that scripts/drive.mjs talks to
modules/          local Expo modules (Swift)
host/             what a Hermes host needs for some features: plugins and one patch
scripts/          build, drive, release, and the host patch sync
```

The rule: logic goes in `src/core` with a test. A store wires `core` to the link. A route
renders stores.

`src/core/gateway/gateway-contract.generated.ts` is the source of truth for every gateway
method, event and payload shape. Search it before you write a store. To refresh the vendored
client, copy the files from `apps/shared/src` of the Hermes repository and remove the `.js`
suffix from their relative imports.

## Check a change

```bash
npm run verify        # type check, lint, tests
npm run host:check    # the host folder is in step with your Hermes checkout
```

Then run the change in the iOS Simulator. `scripts/drive.mjs` presses and types in a
development build, so a check needs no hands:

```bash
node scripts/drive.mjs 'h.press("Settings")' 'h.wait(500)' 'h.texts().slice(-10)'
```

`h.press` takes the exact name of a control. `h.times()` lists the requests since the last
call with their times and sizes, and `h.timeTo(action, text)` gives the time until a text
shows: measure every new screen with them. Look at every new screen in light and in dark
(`xcrun simctl ui <device> appearance dark`).

After a change to native code (`modules/`, a new native package, `plugins` in `app.json`):
`cd ios && pod install`, then `scripts/sim-build.sh <device id>`. The `ios/` folder is
generated and not in git; `npx expo prebuild -p ios` writes it again and removes the pods.

## Rules of the code

- Speed and memory are part of every change. A list is virtual. A store that a screen
  fills is emptied when the screen closes. No timer, socket or microphone stays open after
  its screen.
- A value that changes many times a second gets its own small atom that only a small
  component reads.
- A choice is a row that opens a list (`components/choice.tsx`), not a row of chips.
- No raw key of the host on screen: a readable name, and the bot's own picture where a
  bot is meant. A fault is said in plain words.
- A control that stops or deletes something asks first, inside the screen.
- Every call that is about one bot sends its profile.

## What the repository must never hold

A name, an address, a site, a path, an identifier or a detail of anyone's machine: not in
code, tests, comments, this file, a plugin or a commit message. A test uses `app.test`,
`/Users/me`, `h.example`. The bundle identifier, the signing team and the keys of a
release come from the environment (`app.config.js`, `scripts/release-ios.sh`).

## The host side

Prefer a Hermes plugin to a change in Hermes itself. A plugin lives in `host/<name>` with
an `install.sh`, uses public gateway methods where it can, and is listed in the README.
A change that only Hermes itself can carry goes into `host/patches` through
`npm run host:sync`, from a checkout of Hermes that has the change. Keep both portable:
a host may be macOS, Linux or Windows.

## Commits

One logical change a commit, in the imperative mood, with the reason in the body when the
diff does not show it.
