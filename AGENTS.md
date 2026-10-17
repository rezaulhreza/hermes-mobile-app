# Guide for an agent in this repository

This repository is the Hermes phone app (React Native, Expo) and everything the app needs on
a Hermes host. Read the page for your task before you change anything.

| Your task | Read first |
|---|---|
| Change the app (screens, logic, stores) | `docs/CONTRIBUTING.md` |
| Anything on the Hermes host: an update, a plugin, the backend, a fault | `host/README.md` |
| Change Hermes itself for the app (the patch) | `host/patches/LEDGER.md` |
| Release a build | `scripts/release-ios.sh` (its header) |

## Where a change goes

- **App behaviour:** `src/`. Logic in `src/core` with a test, a store wires it, a route renders it.
- **A feature that needs the host:** a plugin in `host/<name>/`. Prefer a plugin over a patch.
- **Hermes itself:** only when no plugin can do it. One small hunk in
  `host/patches/hermes-backend.patch`, with its comment block and a row in the ledger.
- **Never** in the installed copies (`~/.hermes/plugins`, `~/.hermes/skills`) and never by hand
  in the Hermes checkout. Change the source here, then run `host/setup.sh`.

## One host, one install

The phone, the desktop app and the gateway all run from one Hermes install. Do not start a
second backend for the phone, and do not make a second checkout or a branch of Hermes. After
`hermes update`, run `host/setup.sh`. `host/setup.sh --check` reports the state and changes
nothing.

## Before you say that a change is done

1. `npm run verify` passes (type check, lint, tests).
2. A change to a plugin or to the patch: `host/setup.sh`, then check it on the host.
3. A change that a person sees: run it in the iOS Simulator (`scripts/drive.mjs`).
4. Say plainly what you did not check.

## Rules of this repository

- Nothing that belongs to one person goes in the source: no bundle identifier, team, key,
  token, host address or tunnel name. Those are in files outside the tree.
- In the Hermes checkout, never reset, stash or discard changes: the patch lives there as
  uncommitted changes.
- Metro for this app: use a port that no other project on the machine uses.
