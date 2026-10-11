"""Screen remote: the agent half.

While the user holds the screen (see ``hold_state``), every screen tool the agent calls is
refused, and the refusal is the tool result: it says that the user stopped the work, why, and
that the agent must wait. So the agent is told by the tool itself, in any profile and on any
surface, and cannot go on blind.
"""

from __future__ import annotations

import logging
import time

from . import hold_state

logger = logging.getLogger(__name__)

# Tools that act on the user's screen or drive a browser. A name that ends with "_" or "__" is a prefix.
DEFAULT_SCREEN_TOOLS = ("computer_use", "browser_", "mcp__chrome__")


def _screen_tools() -> tuple[str, ...]:
    try:
        from hermes_cli.config import load_config_readonly

        section = (load_config_readonly() or {}).get("screen_remote")
        names = section.get("tools") if isinstance(section, dict) else None
        if isinstance(names, list) and names:
            return tuple(str(name) for name in names)
    except Exception as exc:  # noqa: BLE001 - a broken config must not stop a tool call
        logger.debug("screen-remote: config read failed: %s", exc)
    return DEFAULT_SCREEN_TOOLS


def is_screen_tool(tool_name: str, names: tuple[str, ...] = DEFAULT_SCREEN_TOOLS) -> bool:
    return any(tool_name.startswith(name) if name.endswith("_") else tool_name == name for name in names)


def block_message(state: dict) -> str:
    since = time.strftime("%H:%M", time.localtime(float(state.get("since") or time.time())))
    reason = str(state.get("reason") or "").strip()
    return (
        f"BLOCKED: the user stopped your screen work at {since} and took control of the screen from their phone."
        + (f" Their reason: {reason}." if reason else "")
        + " Do not use computer_use or any browser tool until the user says that you can continue. Do not try another"
        " way to reach the screen. Tell the user in one or two sentences what you were doing and what is left, then wait."
    )


def _refuse_while_held(tool_name: str = "", **_kwargs):
    if not is_screen_tool(tool_name, _screen_tools()):
        return None
    try:
        state = hold_state.read()
    except Exception as exc:  # noqa: BLE001 - a broken state file must not stop every screen tool
        logger.debug("screen-remote: hold lookup failed: %s", exc)
        return None
    return {"action": "block", "message": block_message(state)} if state else None


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", _refuse_while_held)
