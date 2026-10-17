# Ledger of the local changes: read this after every `hermes update`

This file is for the Hermes agent (or a person) that maintains a Hermes host for the phone
app. It lists every change that the app puts on a stock Hermes, says how each one can break
after an update, and says what to do. Work through it from the top.

A host that runs the phone app is stock Hermes plus:

1. One small patch: `hermes-backend.patch` in this folder. It changes one function.
2. Four plugins in `$HERMES_HOME/plugins/`: `phone-push`, `phone-preview`, `screen-remote`
   and `group-rooms`. Their source and `install.sh` are in `host/<name>/` of this repository.
3. Some keys in `$HERMES_HOME/config.yaml` (see the last table).

Nothing else of the app goes into the Hermes checkout. This repository is the only place to
change the patch or a plugin. Never edit the copy in the Hermes checkout or in
`$HERMES_HOME/plugins/` by hand: change the source here, then apply or install it again.

## After `hermes update`: the steps

1. Look at what the update did with the applied patch. `hermes update` stashes local changes
   before the pull and puts them back after it.
   - `git -C <checkout> status --short` shows `tui_gateway/session_lifecycle.py` as modified:
     the update put the patch back. Go to step 2.
   - `git -C <checkout> stash list` has a new entry and the file is not modified: the update
     kept the patch aside. Do NOT drop, pop or reset anything. Go to step 2: `apply.sh`
     applies the patch again on the new code. Tell the owner about the stash entry: it holds
     the local changes from before the update, and only the owner decides when to drop it.
   - The update reports a conflict, or the file has conflict markers: stop. Do not reset or
     discard anything. Tell the owner what the update said, and wait.
2. Run `host/patches/apply.sh <checkout>`. It answers one of these:
   - "already applied": nothing to do.
   - "Applied" or "Applied with a three-way merge": go to step 4.
   - "does not apply": go to step 3.
3. The patch does not apply. Open `hermes-backend.patch`. Each hunk has a comment block:
   - Do its UPSTREAM CHECK first. When upstream has the same behaviour, the hunk is not
     necessary any more: remove it from the patch file, and remove its row below.
   - Else do what its ON CONFLICT line says, on the new code, in the checkout.
   - Then write the patch again from the checkout: `HERMES_REPO=<checkout> npm run host:sync`
     in this repository. The comments are in the code, so they come back with the diff.
   - Commit the new patch and `BASE` in this repository.
4. Restart the Hermes backend that serves the app (the dashboard process). A plugin and the
   patch load only when the process starts.
5. Check the plugins (the table below). Each one has a check that fails in a known way when
   an update renamed what it uses.

## The patch

| Hunk | What it does | Why it cannot be a plugin | Upstream check | Drop when |
|---|---|---|---|---|
| `tui_gateway/session_lifecycle.py`, `_release_hosted_room_turn_slot` | Releases the session slot at the end of every turn, for every client. Stock releases it only for a hosted room. Without it, a chat that the Desktop has open refuses the phone ("opened by desktop ... ago"). | No plugin hook runs at the end of a turn, and the release must run under the session's `history_lock`. | `grep -n "ROOM_SESSION_SOURCE" tui_gateway/session_lifecycle.py` in a stock checkout. No source test in the end-of-turn release means upstream has it. | Upstream has no source test there. |

`BASE` names the Hermes commit on which the patch applies cleanly.

## The plugins

| Plugin | What it uses of Hermes | How an update breaks it | Check | Fix |
|---|---|---|---|---|
| `phone-push` | Wraps `tui_gateway.server_requests._register` and `tools.bot_live_delivery.claim_pending_delivery` when the process starts. Needs the `h2` package (Apple's push service is HTTP/2 only). `plugin.yaml` declares it in `python_dependencies`, so the package manager installs it when the plugin is enabled and keeps it through `hermes update`. | A renamed function: push of that kind stops. A missing `h2`: every push fails. | `GET /api/plugins/phone-push/status`: `hooks.request` and `hooks.mention` are both `true`. `POST /api/plugins/phone-push/test` reaches the phone. | A `false` hook: `push/hooks.py` names the function and what to look for. A missing `h2`: `hermes plugins disable phone-push`, then `hermes plugins enable phone-push` (the enable installs the declared packages). |
| `phone-preview` | Public dashboard plugin routes only. | Not by a rename. | `GET /api/plugins/phone-preview/host?url=http://127.0.0.1:<port>/` shows the page of a local server. | Not expected. |
| `screen-remote` | The `pre_tool_call` hook, and the private names `_backend_for_call`, `_backends` and `_backend_lock` of `tools/computer_use/tool.py`. | A renamed private name: its routes answer 500. | `GET /api/plugins/screen-remote/status` and `/windows` answer 200. | Find the new names in `tools/computer_use/tool.py` and change `host/screen-remote/dashboard/plugin_api.py`. |
| `group-rooms` | Public gateway methods (`profiles.list`, `profiles.configure`, `groups.*`) and the Desktop's room record in `ui_meta`. For the turns of a round also the read-only `gateway.hosted_room_driver.list_tasks` with `gateway.hosted_rooms.default_db_path`: no method names the bot of a turn. To stop one turn, `get_hosted_room_service` of `tui_gateway/methods_groups.py` and `runtime.cancel` of that service: `groups.stop` stops the whole room. | A changed method shape. A moved `list_tasks`: a room still reads and writes, and the phone shows "The bots answer in turn" with no names. A moved service or `cancel`: "Stop this bot" answers 502, and the stop of the room still works. | `GET /api/plugins/group-rooms/status` answers 200. `GET /api/plugins/group-rooms/rooms/<id>` has a `round` list that is not empty after a round. | Read `host/group-rooms/README.md`. A `round` that stays empty: find the task list in `gateway/hosted_room_driver.py` and change `_round` in `host/group-rooms/dashboard/plugin_api.py`. Drop the plugin when the Desktop moves its rooms to `groups.*`. |

Install or update a plugin with `host/<name>/install.sh`, then restart the backend.

## Config keys the app uses

| Key | For | Default when absent |
|---|---|---|
| `plugins.enabled` lists the four plugins | Loads them | Not loaded |
| `push.*` (see `host/phone-push/README.md`) | Push | No push |
| `push.kinds` | Which requests make a push | `clarify`, `approval`, `mention` |
| `preview.local_domains` | Local-development sites in the preview (for example `test`) | Only `localhost` |

## Removed from the old patch, on purpose

Until 2026-10-09 the patch was the whole difference between a development branch and stock
Hermes. These parts were in it. The phone app does not need them. Do not add them again.

| Part | Why it is not necessary |
|---|---|
| `tools/desktop_ui.py`, `tui_gateway/gui_bridges.py`, `agent_callbacks.py`, `server.py`, `session_notifications.py`, `tools/open_preview_tool.py`, `close_preview_tool.py`, `read_terminal_tool.py` | A fail-fast answer when no client is attached. Stock already keeps an unanswered request for the reconnect replay, and the app answers `preview.read` and `preview.act` itself. |
| `tools/read_preview_tool.py` | A fetch on the host for a client that cannot read its own page. The app reads the page in its own WebView. |
| `hermes_cli/web_server.py` | CORS origins of an old web shell (`capacitor://`, `ionic://`). The native app does not send a browser preflight. |
| `pyproject.toml`, `uv.lock` | `h2` for push. The `phone-push` plugin now declares it. |
| `tui_gateway/prompt_turn.py`, `tui_gateway/session_workdir.py` | A rename of the release function and a fix for the rename. The patch now keeps the stock name. |
| `hermes_cli/config_defaults.py`, `config_defaults_updates.py`, `update_cmd_maint.py`, `web_routers/actions.py`, `web_routers/files.py` | Changes of the development branch that the app never calls. |

## Other local changes of a host

A host can have local changes that are not part of the phone app (another plugin with local
edits, a launch agent, a backup). They are not in this repository, because it must hold no
detail of anyone's machine. Keep them in `$HERMES_HOME/local-changes.md` on that host, and
read that file after this one.
