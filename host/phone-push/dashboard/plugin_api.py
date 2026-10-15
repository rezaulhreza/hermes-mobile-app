"""REST routes for the phone app's notifications, mounted at ``/api/plugins/phone-push``.

The routes are behind the dashboard's sign-in, like every other ``/api`` route. A device token
is checked for its shape before it is stored, because a wrong token would be sent to Apple again
on every notification.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

router = APIRouter()

MODULE = "hermes_phone_push"
_ENVIRONMENTS = ("production", "sandbox")
_CHOICES = ("once", "session", "always", "deny")


def _push():
    """The push package under its one module name (see the plugin's ``__init__.py``)."""
    if MODULE not in sys.modules:
        root = Path(__file__).resolve().parent.parent / "push"
        spec = importlib.util.spec_from_file_location(MODULE, root / "__init__.py", submodule_search_locations=[str(root)])
        module = importlib.util.module_from_spec(spec)
        sys.modules[MODULE] = module
        spec.loader.exec_module(module)
    return sys.modules[MODULE]


# The dashboard loads this file when it starts: the gateway is in the process by then.
_push().hooks.install()


class Registration(BaseModel):
    """A phone's token from Apple and where it came from. ``profile`` empty: every bot."""
    token: str
    environment: str = "production"
    platform: str = "ios"
    profile: str = ""
    label: str = ""
    unregister: bool = False


class Answer(BaseModel):
    session_id: str
    choice: str


def _checked(body: Registration) -> tuple[str, str]:
    store = _push().devices
    token = (body.token or "").strip()
    if not store.is_valid_token(token):
        raise HTTPException(status_code=422, detail="token must be 64 hex characters")
    environment = (body.environment or "production").strip().lower()
    if environment not in _ENVIRONMENTS:
        raise HTTPException(status_code=422, detail="environment must be production or sandbox")
    return store.normalize_token(token), environment


@router.get("/status")
def status() -> dict:
    """Whether notifications are on, how many phones are known, and whether the plugin sees
    the two moments it needs (see ``push/hooks.py``)."""
    push = _push()
    config = push.service._push_config()
    return {"enabled": bool(config.get("enabled")), "devices": len(push.devices.load_devices()), "hooks": push.hooks.install()}


@router.post("/register")
async def register_device(body: Registration):
    """Store this phone's token, or forget it with ``unregister``."""
    store = _push().devices
    token, environment = _checked(body)
    if body.unregister:
        return {"ok": True, "removed": await run_in_threadpool(store.remove_device, token)}
    record = await run_in_threadpool(
        lambda: store.register_device(
            token, environment=environment, platform=(body.platform or "ios").strip() or "ios",
            profile=(body.profile or "").strip(), label=(body.label or "").strip()))
    # The token is a capability: only its first characters leave the host.
    return {"ok": True, "token_prefix": store.token_prefix(record["token"]),
            "environment": record["environment"], "profile": record["profile"]}


@router.delete("/register")
async def forget_device(body: Registration):
    store = _push().devices
    token, _environment = _checked(body)
    return {"ok": True, "removed": await run_in_threadpool(store.remove_device, token)}


def _approval_respond(session_id: str, choice: str) -> dict:
    """The gateway's own answer to ``approval.respond``, as its JSON-RPC envelope."""
    from tui_gateway import server
    return server.handle_request({
        "jsonrpc": "2.0", "id": "push-answer", "method": "approval.respond",
        "params": {"session_id": session_id, "choice": choice}}) or {}


@router.post("/answer")
async def answer_from_notification(body: Answer):
    """Answer the approval a notification announced, with one request: a phone that is woken for
    a button of the notification has seconds and no socket."""
    session_id = (body.session_id or "").strip()
    choice = (body.choice or "").strip().lower()
    if not session_id:
        raise HTTPException(status_code=422, detail="session_id is required")
    if choice not in _CHOICES:
        raise HTTPException(status_code=422, detail="choice must be once, session, always or deny")
    answer = await run_in_threadpool(_approval_respond, session_id, choice)
    if "error" in answer:
        raise HTTPException(status_code=409, detail=str((answer["error"] or {}).get("message") or "no approval waits"))
    resolved = (answer.get("result") or {}).get("resolved")
    if not resolved:
        # Nothing waited: answered on another device, timed out, or the turn was stopped.
        raise HTTPException(status_code=409, detail="no approval waits in this session")
    return {"ok": True, "resolved": resolved}


def _send_test() -> dict:
    push = _push()
    config = push.service._push_config()
    if not config.get("enabled"):
        return {"sent": 0, "devices": 0, "reason": "Notifications are off on this host (push.enabled in config.yaml)."}
    payload = push.sender.build_payload(
        session_id="", profile="", kind="test", title="Hermes", body="This is a test notification from your Hermes host.")
    devices = push.devices.load_devices()
    sent, reasons = 0, []
    for device in devices:
        outcome = push.sender.deliver(config, device, payload)
        if outcome.ok:
            push.devices.record_success(device.get("token", ""), environment=outcome.environment)
            sent += 1
        else:
            reasons.append(str(outcome.reason or "refused"))
    return {"sent": sent, "devices": len(devices), "reason": "; ".join(sorted(set(reasons)))}


@router.post("/test")
async def send_test():
    """Send one test notification to every registered phone, and say how many Apple accepted.
    It proves the key, the bundle identifier and the network in one step."""
    return await run_in_threadpool(_send_test)
