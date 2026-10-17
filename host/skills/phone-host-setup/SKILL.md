---
name: phone-host-setup
description: "Use when the user asks to update Hermes (hermes update), when an update just ran, or when the Hermes phone app cannot connect, shows no group chat, sends no push, or a plugin of the phone (phone-push, phone-preview, screen-remote, group-rooms) is missing. Gives the one command that puts everything the phone app needs back on this host."
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [update, hermes update, phone, mobile, app, plugins, patch, backend, launch agent, setup, host]
    category: devops
---

# The phone app on this host

The Hermes phone app needs three things on this host. All three come from one repository,
and one command installs them. Do not change them by hand.

- One small patch on the Hermes checkout (two functions).
- Four plugins: `phone-push`, `phone-preview`, `screen-remote`, `group-rooms`.
- One launch agent (`com.hermes.backend.mobile`) that runs the backend for the phone from the
  one Hermes install, on port 9130.

The repository is at `{{REPO}}`.

## After `hermes update`

1. Run `{{REPO}}/host/setup.sh`.
2. Read what it prints. The last block must say: `Patch: applied`, each plugin
   `installed, same as this repository`, and `GET /api/status: 200`.
3. Tell the user the result in one or two lines.

`hermes update` puts the patch back by itself and does not touch the plugins, so the phone
usually works right after an update. The command makes sure, and gives the port back to the
launch agent.

## When the command stops

- "The patch does not apply": the update changed the code under the patch. Do NOT reset,
  stash, drop or discard anything in the Hermes checkout. Open
  `{{REPO}}/host/patches/LEDGER.md` and follow it from step 3. If a step is not clear, stop
  and tell the user what the command printed.
- "The backend did not answer": read `~/.hermes/logs/hermes-backend-mobile.err.log` and tell
  the user its last lines.

## To look without changing anything

`{{REPO}}/host/setup.sh --check` prints the state of the host and changes nothing.

## The whole picture

`{{REPO}}/host/README.md` says how the parts run, where to change each one, and the first
check for each sign of trouble. Read it before you change anything on this host.

## Rules

- Never start a second Hermes backend for the phone, and never make a second checkout or a
  branch of Hermes for it. One install serves the desktop app, the gateway and the phone.
- A change to a plugin or to the patch is made in the repository, then installed with the
  command. Never edit the copy under `~/.hermes/plugins/` or the Hermes checkout by hand.
