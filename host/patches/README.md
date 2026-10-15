# The backend change for the app

Almost all of the app works with stock Hermes and the four plugins in `host/`. One change must
be in Hermes itself, in a place that a plugin cannot reach. It is in this folder as one small
patch, written by hand on stock Hermes.

| File | What it is |
|---|---|
| `hermes-backend.patch` | The change, as one `git` patch. Each hunk has a comment block in the code: why it exists, how to tell that upstream has it, what to do on a conflict. |
| `BASE` | The Hermes commit on which the patch applies cleanly. |
| `apply.sh` | Applies the patch to a Hermes checkout. Safe to run again. |
| `LEDGER.md` | Every local change of a host for the app, and what to do after `hermes update`. Read it after every update. |

## What is in the patch

| Part | What the app gets from it | File |
|---|---|---|
| Session slot release | A turn that ends gives its slot back, for every client, so a chat that the Desktop has open does not refuse the phone. | `tui_gateway/session_lifecycle.py` |

## Install

1. Find your Hermes checkout (the folder with `hermes_cli/` in it).
2. Run `host/patches/apply.sh /path/to/that/checkout`.
3. Restart the Hermes backend.

On Windows, run the script in Git Bash or WSL, or run `git apply --3way hermes-backend.patch` in
the Hermes checkout.

To take the change out again: `git apply --reverse /path/to/hermes-backend.patch` in the Hermes
checkout.

## After a Hermes update

`hermes update` stashes the applied patch before the pull and puts it back after it. Then run
`apply.sh` again: it says whether the change is still there, applies it again, or says that it
does not apply. `LEDGER.md` says what to do in each case.

## For maintainers

```bash
HERMES_REPO=/path/to/hermes-checkout npm run host:check   # the patch applies (or is applied) there
HERMES_REPO=/path/to/hermes-checkout npm run host:sync    # write the patch again after a rebuild
```

`host:sync` takes the uncommitted change of the files that the patch names, from a checkout that
has the patch applied, and writes `BASE`. Change a hunk in that checkout, never in the patch file
by hand, and keep its comment block true. Commit the new patch with the app change that needs it.
A new hunk needs a reason that no plugin can carry: prefer a plugin in `host/`.
