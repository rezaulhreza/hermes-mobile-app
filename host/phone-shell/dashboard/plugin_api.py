"""A login shell on the host for the terminal of the phone app: mounted at
``/api/plugins/phone-shell``.

Stock Hermes has a pseudo-terminal socket, ``/api/pty``, but it runs the Hermes chat TUI, not a
shell. This plugin opens the user's own login shell behind a pseudo-terminal, with the stock
``PtyBridge`` and ``PtySessionRegistry`` that ``/api/pty`` uses.

* ``WS /api/plugins/phone-shell/pty?id=<id>&cwd=<folder>&cols=<n>&rows=<n>``: the shell named
  ``id``. The first connection starts it in ``cwd`` (the home folder when ``cwd`` is not an
  existing folder). Output arrives as binary frames; input goes back as text or binary frames.
  The frame ``ESC[RESIZE:<cols>;<rows>]`` resizes the terminal, as on ``/api/pty``.
  The shell outlives the socket: a dev server keeps running when the phone leaves the screen,
  and the next connection with the same ``id`` gets the output it missed (up to 512 KB) first.
  A shell with no connection for two hours is closed.
* ``GET /api/plugins/phone-shell/shells``: the shells that run, ``{"shells": [{"id", "cwd",
  "started", "attached"}]}``.
* ``POST /api/plugins/phone-shell/shells/<id>/close``: end a shell and its programs.

Sign-in. The HTTP routes are behind the dashboard's sign-in, like every other ``/api`` route.
The sign-in middleware never sees a WebSocket upgrade, so the socket checks the credential
itself, with the same check as the core sockets (``?ticket=`` or ``?token=``) and the same
host and origin guard as ``/api/ws``. When that check cannot run, the socket is refused: a
shell is never open without a sign-in.

This gives the phone the same power as ``shell.exec``: any command, as the user that runs
Hermes. It adds no new kind of access, only a terminal for it.
"""

from __future__ import annotations

import asyncio
import os
import re
import time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

router = APIRouter()

_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_RESIZE = re.compile(rb"\x1b\[RESIZE:(\d+);(\d+)\]")
# The keys of this plugin's shells in the registry. The registry is this plugin's own.
_PREFIX = "phone-shell\0"
_IDLE_SECONDS = 2 * 60 * 60
_MAX_SHELLS = 8
_REPLAY_BYTES = 512 * 1024
_REAP_EVERY = 5 * 60

_registry = None
_reaper: Optional[asyncio.Task] = None
_started: dict[str, dict] = {}


def _shells():
    """The registry of the shells, made at the first use: importing this file must not need Hermes."""
    global _registry, _reaper
    if _registry is None:
        from hermes_cli.pty_session import PtySessionRegistry

        _registry = PtySessionRegistry(ttl=_IDLE_SECONDS, max_sessions=_MAX_SHELLS, buffer_cap=_REPLAY_BYTES, read_timeout=0.2)
    if _reaper is None or _reaper.done():
        _reaper = asyncio.get_running_loop().create_task(_reap_forever())
    return _registry


async def _reap_forever() -> None:
    # The registry closes an idle shell only when it is used. A shell left alone overnight must
    # still end, so the reaper looks every few minutes.
    while True:
        await asyncio.sleep(_REAP_EVERY)
        try:
            await _registry.reap_idle()
        except Exception:
            pass
        for shell_id in [known for known in _started if _PREFIX + known not in _registry._sessions]:
            _started.pop(shell_id, None)


def _signed_in(ws: WebSocket) -> bool:
    """The credential check of the core sockets. Fails closed: no check, no shell."""
    try:
        from hermes_cli import web_server_chat as chat

        return bool(chat._ws_auth_ok(ws)) and bool(chat._ws_request_is_allowed(ws))
    except Exception:
        return False


def _shell_argv() -> list[str]:
    """The user's login shell. Windows has no login shell: its command shell, as Windows Terminal opens."""
    if os.name == "nt":
        return [os.environ.get("COMSPEC") or "cmd.exe"]
    return [_login_shell(), "-l"]


def _login_shell() -> str:
    shell = os.environ.get("SHELL")
    if not shell:
        try:
            import pwd

            shell = pwd.getpwuid(os.getuid()).pw_shell
        except Exception:
            shell = None
    return shell or "/bin/sh"


def _start_folder(raw: Optional[str]) -> str:
    home = str(Path.home())
    if not raw:
        return home
    path = Path(raw).expanduser()
    return str(path) if path.is_absolute() and path.is_dir() else home


def _size(raw: Optional[str], default: int, top: int) -> int:
    try:
        return max(2, min(top, int(raw or default)))
    except ValueError:
        return default


@router.websocket("/pty")
async def shell_socket(ws: WebSocket) -> None:
    shell_id = ws.query_params.get("id") or ""
    if not _signed_in(ws) or not _ID.match(shell_id):
        await ws.close(code=1008)
        return
    await ws.accept()

    from hermes_cli.pty_bridge import PtyBridge, PtyUnavailableError
    from hermes_cli.pty_session import RegistryFull

    registry = _shells()
    key = _PREFIX + shell_id
    folder = _start_folder(ws.query_params.get("cwd"))
    cols = _size(ws.query_params.get("cols"), 80, 500)
    rows = _size(ws.query_params.get("rows"), 24, 200)
    env = {**os.environ, "TERM": "xterm-256color", "COLORTERM": "truecolor"}

    def spawn():
        return PtyBridge.spawn(_shell_argv(), cwd=folder, env=env, cols=cols, rows=rows)

    try:
        session, created = await registry.attach_or_spawn(key, spawn=spawn)
    except (PtyUnavailableError, RegistryFull, OSError) as exc:
        await ws.send_text(f"\r\nThe host could not open a shell: {exc}\r\n")
        await ws.close(code=1011)
        return
    if created:
        _started[shell_id] = {"cwd": folder, "started": time.time()}

    if not await session.attach(ws):
        registry.detach(key, ws)
        return
    try:
        while True:
            message = await ws.receive()
            if message.get("type") == "websocket.disconnect":
                break
            raw = message.get("bytes")
            if raw is None:
                text = message.get("text")
                raw = text.encode("utf-8") if isinstance(text, str) else b""
            if not raw:
                continue
            resize = _RESIZE.fullmatch(raw)
            if resize:
                session.bridge.resize(cols=int(resize.group(1)), rows=int(resize.group(2)))
                continue
            if not await session.write(ws, raw):
                break
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        # The shell keeps running for the next connection.
        registry.detach(key, ws)


@router.get("/shells")
async def list_shells() -> dict:
    registry = _shells()
    await registry.reap_idle()
    shells = []
    # The registry has no public listing. Its map is read, never changed, here.
    for key, session in list(registry._sessions.items()):
        if key.startswith(_PREFIX) and session.alive:
            shell_id = key[len(_PREFIX):]
            known = _started.get(shell_id, {})
            shells.append({"id": shell_id, "cwd": known.get("cwd"), "started": known.get("started"), "attached": session.attached})
    return {"shells": shells}


@router.post("/shells/{shell_id}/close")
async def close_shell(shell_id: str) -> dict:
    if not _ID.match(shell_id):
        raise HTTPException(status_code=400, detail="Not a shell id")
    registry = _shells()
    session = registry._sessions.pop(_PREFIX + shell_id, None)
    _started.pop(shell_id, None)
    if session is not None:
        await session.close()
    return {"closed": session is not None}
