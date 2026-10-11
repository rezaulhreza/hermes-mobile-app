"""The hold: the user has the screen, the agent's screen tools wait.

The state is one small file, not a variable, for two reasons. The agent half (a plugin package)
and the route half (a file the dashboard loads by path) are two module objects, and a bot that
runs in another process (the messaging gateway) must see the same hold. The file is under the
root Hermes home, not a profile home: the screen belongs to the machine, not to one profile.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

# A phone that died must not block the agent for ever. The phone renews the hold while its view is open.
DEFAULT_TTL_SECONDS = 30 * 60


def _path() -> Path:
    from hermes_constants import get_default_hermes_root

    return get_default_hermes_root() / "cache" / "screen-remote" / "hold.json"


def read() -> dict[str, Any] | None:
    """The hold that is active now, or None."""
    try:
        state = json.loads(_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(state, dict) or float(state.get("expires_at") or 0) <= time.time():
        return None
    return state


def hold(reason: str = "", ttl_seconds: int = DEFAULT_TTL_SECONDS) -> dict[str, Any]:
    now = time.time()
    current = read()
    state = {
        "reason": reason.strip() or (current or {}).get("reason", ""),
        "since": (current or {}).get("since", now),
        "expires_at": now + ttl_seconds,
    }
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(state), encoding="utf-8")
    os.replace(temp, path)
    return state


def release() -> None:
    try:
        _path().unlink()
    except FileNotFoundError:
        pass
