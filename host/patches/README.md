# Backend changes for the app

The app works against a Hermes backend. Most of it needs only what stock Hermes has. Some
features need changes in the backend itself, in places a plugin cannot reach. Those changes
are in this folder as one patch, made from the checkout the app is developed against, so a
host can be set up with one command.

| File | What it is |
|---|---|
| `hermes-backend.patch` | Every backend change, as one `git` patch. Source only: no tests, no apps. |
| `BASE` | The Hermes commit the patch was made on. It applies cleanly there. |
| `apply.sh` | Applies the patch to a Hermes checkout. Safe to run again. |

## Install

1. Find your Hermes checkout (the folder with `hermes_cli/` in it).
2. Run `host/patches/apply.sh /path/to/that/checkout`.
3. Restart Hermes.

On Windows, run the script in Git Bash or WSL, or run
`git apply --3way hermes-backend.patch` in the Hermes checkout.

To take the changes out again: `git checkout . && git clean -fd hermes_cli/push hermes_cli/web_routers/push.py hermes_cli/web_routers/preview_host.py tui_gateway/gui_bridges.py tui_gateway/session_notifications.py`
in the Hermes checkout, when you have no other change there. Else use `git apply --reverse`.

## After a Hermes update

Run `apply.sh` again. If the update moved the same lines, the script tries a three-way merge
and says what it did. If that fails, the patch needs a new version: check out the commit in
`BASE`, or wait for a release of the app with a patch for the new Hermes.

## What is in the patch

| Part | What the app gets from it | Main files |
|---|---|---|
| Push notifications | A notification when the agent needs the user (an approval, a question, a secret, a sign-in), which opens the exact chat. The backend sends through the Apple Push Notification service with YOUR key. | `hermes_cli/push/`, `hermes_cli/web_routers/push.py`, `tui_gateway/server_requests.py`, `tui_gateway/session_notifications.py` |
| Preview route | A page of a server on the host (`localhost:3000`) loads on the phone, through the backend, with the app's sign-in. A page is rewritten against the address it came from after a redirect. | `hermes_cli/web_routers/preview_host.py`, `hermes_cli/web_server.py` |
| Local-development sites | A site that only the host's own resolver serves (`app.test`) loads by its name. Off until you list the domain (see below). | `hermes_cli/web_routers/preview_host.py` |
| The agent's preview on a phone | The agent opens, reads and drives a page in the app's preview. | `tui_gateway/gui_bridges.py`, `tools/*preview*`, `tools/desktop_ui.py` |
| Session slot release | A turn that ends gives its slot back, on every surface, so a chat from the phone does not hold a session open. | `tui_gateway/session_lifecycle.py`, `tui_gateway/prompt_turn.py` |
| HTTP/2 for the push sender | The `http2` extra of `httpx`. | `pyproject.toml`, `uv.lock` |

## Settings

All of them go in the `config.yaml` of the Hermes home. Nothing is on until you set it.

```yaml
# Push notifications. The key file, the key ID, the team ID and the bundle identifier are
# yours, from your Apple developer account. The bundle identifier is the one the app is
# built with.
push:
  enabled: true
  apns_key_path: /path/to/AuthKey.p8
  apns_key_id: "<key id>"
  apns_team_id: "<team id>"
  bundle_id: "<the app's bundle identifier>"
  environment: production        # or: development
  kinds: [clarify, approval, mention, sudo, secret]

# Local-development sites for the preview. List a domain only when a resolver on the host
# serves it (Laravel Herd and Valet serve "test"). A name is taken only when it ends in a
# listed domain AND resolves to the host itself.
preview:
  local_domains: [test]
```

## For maintainers: keep this folder in step

The patch is generated, never edited by hand.

```bash
HERMES_REPO=/path/to/hermes-checkout npm run host:sync    # after every backend change
HERMES_REPO=/path/to/hermes-checkout npm run host:check   # fails when the folder is stale
```

Commit the new patch together with the app change that needs it. A backend change that the
app depends on and that is not in this folder is a broken install for everyone else.
