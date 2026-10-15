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

To take the changes out again: `git checkout . && git clean -fd tui_gateway/gui_bridges.py`
in the Hermes checkout, when you have no other change there. Else use `git apply --reverse`.

## After a Hermes update

Run `apply.sh` again. If the update moved the same lines, the script tries a three-way merge
and says what it did. If that fails, the patch needs a new version: check out the commit in
`BASE`, or wait for a release of the app with a patch for the new Hermes.

## What is in the patch

| Part | What the app gets from it | Main files |
|---|---|---|
| The agent's preview on a phone | The agent opens, reads and drives a page in the app's preview. | `tui_gateway/gui_bridges.py`, `tools/*preview*`, `tools/desktop_ui.py` |
| Session slot release | A turn that ends gives its slot back, on every surface, so a chat from the phone does not hold a session open. | `tui_gateway/session_lifecycle.py`, `tui_gateway/prompt_turn.py` |

## For maintainers: keep this folder in step

The patch is generated, never edited by hand.

```bash
HERMES_REPO=/path/to/hermes-checkout npm run host:sync    # after every backend change
HERMES_REPO=/path/to/hermes-checkout npm run host:check   # fails when the folder is stale
```

Commit the new patch together with the app change that needs it. A backend change that the
app depends on and that is not in this folder is a broken install for everyone else.
