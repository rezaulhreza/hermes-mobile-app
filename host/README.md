# The host of the phone app

This page is for a person, or for an agent (Hermes, Claude, Codex) that looks after a Hermes
host for the phone app. It says how the parts run, where to change each one, and what to do
after an update. Paths are for the default setup: change them if yours differ.

## How it runs

One Hermes install runs everything. The desktop app and the phone app are two ways into it.

| Part | Runs from | Started by |
|---|---|---|
| Gateway (the agent) | `~/.hermes/hermes-agent` | Launch service `ai.hermes.gateway` |
| Desktop app | `~/.hermes/hermes-agent` | `hermes desktop` |
| Backend for the phone, port 9130 | `~/.hermes/hermes-agent` | Launch service `com.hermes.backend.mobile` |
| Tunnel to the phone | Your tunnel config (for example `~/.cloudflared/hermes-mobile.yml`) | Your tunnel service |

The phone adds three things to stock Hermes. All of them come from this folder:

- One patch on the Hermes checkout: `patches/hermes-backend.patch`.
- Four plugins: `phone-push`, `phone-preview`, `screen-remote`, `group-rooms`.
- Two skills for the agent of the host: `skills/`.

## The one command

```bash
host/setup.sh            # the patch, the plugins, the skills, the backend service, a check
host/setup.sh --check    # change nothing: print the state of the host
```

It is safe to run again. It reads `HERMES_HOME` (default `~/.hermes`), `HERMES_REPO` (default
`$HERMES_HOME/hermes-agent`) and `HERMES_PHONE_PORT` (default `9130`).

## Where to do what

Change a thing at its source, never in the installed copy.

| To | Where | How |
|---|---|---|
| Update Hermes | Anywhere | `hermes update`, then `host/setup.sh` |
| Check the phone setup | This repository | `host/setup.sh --check` |
| Repair the phone setup | This repository | `host/setup.sh` |
| Change a phone plugin | `host/<plugin>/` | Edit there, then `host/setup.sh` |
| Change Hermes itself for the phone | `host/patches/` | Read `patches/LEDGER.md` first. Keep it small. |
| Change the phone app | `src/` | `npm run verify`, then `scripts/release-ios.sh upload` |
| Read why the backend failed | `~/.hermes/logs/hermes-backend-mobile.err.log` | Read the last lines |
| Restart the backend for the phone | Anywhere | `launchctl kickstart -k gui/$(id -u)/com.hermes.backend.mobile` |

Never do these:

- Edit a file under `~/.hermes/plugins` or in the Hermes checkout by hand. The next setup or
  update overwrites it.
- Start a second Hermes backend for the phone, or make a second checkout or a branch of Hermes.
- Reset, stash or discard changes in the Hermes checkout. The patch lives there as uncommitted
  changes.

## Run an update

1. Run `hermes update`.
2. Run `host/setup.sh`.
3. Read the last block it prints: `Patch: applied`, each plugin
   `installed, same as this repository`, `GET /api/status: 200`.
4. Open the phone app and open one chat.

Without step 2 the phone still works in the normal case: the update puts the patch back by
itself and does not touch the plugins. The update also starts a copy of the backend of its own;
the launcher waits while that copy holds the port, and step 2 gives the port back.

When step 2 stops:

- "The patch does not apply": the new Hermes code changed under the patch. Nothing was changed.
  Follow `patches/LEDGER.md` from step 3.
- "The backend did not answer": read `~/.hermes/logs/hermes-backend-mobile.err.log`.

## When something is wrong

| Sign | First check |
|---|---|
| The phone cannot connect | `host/setup.sh --check`: the status must be 200 and the port must be served from the Hermes checkout. Then check the tunnel. |
| A group chat takes no message | The check must list `group-rooms` as installed. If not, run `host/setup.sh`. |
| No push notifications | The check must list `phone-push` as installed. |
| "Port 9130 is already in use" in the log | A second copy of the backend runs. `host/setup.sh` ends it and starts one. |
| A fix works on the desktop and not on the phone | A second copy of Hermes runs. Find it: `lsof -nP -iTCP:9130 -sTCP:LISTEN`. |

## A new machine

1. Install Hermes.
2. Bring your Hermes home (`~/.hermes`: config, profiles, memories, keys).
3. Clone this repository and run `host/setup.sh`.
4. Set up the tunnel to port 9130. The setup command does not do this part.
5. Open the phone app.
