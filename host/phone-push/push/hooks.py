"""Where the plugin learns that Hermes waits for the user. No file of Hermes is changed.

Hermes has no plugin hook for these two moments, so the plugin wraps two functions of Hermes
when its process starts:

* ``tui_gateway.server_requests._register``: every request from the agent to a person (a
  question, an approval, a password) passes through it.
* ``tools.bot_live_delivery.claim_pending_delivery``: a message from another bot becomes a turn
  here. It is a push when it addresses the owner as ``@user``.

IF A HERMES UPDATE RENAMES OR MOVES ONE OF THEM: nothing breaks, the notifications of that kind
stop, and ``GET /api/plugins/phone-push/status`` says ``"request": false`` or ``"mention": false``.
The fix is in this file only: point the wrap at the new name. If Hermes gets a real hook for
"the agent waits for a person" (look for one in ``hermes_cli/plugins.py``), use that hook and
delete the wrap.

A wrap never changes what the wrapped function does or returns, and a failure in the push code
never reaches Hermes.
"""

from __future__ import annotations

import logging
import sys

from . import service

logger = logging.getLogger(__name__)

_MARK = "_hermes_phone_push"
state = {"request": False, "mention": False}


def _quiet(work) -> None:
    try:
        work()
    except Exception:  # noqa: BLE001 - a push must never break the request it announces
        logger.debug("phone-push: a notification was skipped", exc_info=True)


def _wrap_requests() -> bool:
    module = sys.modules.get("tui_gateway.server_requests")
    original = getattr(module, "_register", None)
    if original is None:
        return False
    if getattr(original, _MARK, False):
        return True

    def _register(req):
        original(req)
        _quiet(lambda: service.notify_request(req.method, req.sid, req.params))

    setattr(_register, _MARK, True)
    module._register = _register
    return True


def _wrap_mentions() -> bool:
    module = sys.modules.get("tools.bot_live_delivery")
    original = getattr(module, "claim_pending_delivery", None)
    if original is None:
        return False
    if getattr(original, _MARK, False):
        return True

    def claim_pending_delivery(home, owner, *args, **kwargs):
        claimed = original(home, owner, *args, **kwargs)
        if isinstance(claimed, dict):
            _quiet(lambda: _mention(home, owner, claimed))
        return claimed

    setattr(claim_pending_delivery, _MARK, True)
    module.claim_pending_delivery = claim_pending_delivery
    return True


def _mention(home, owner, claimed: dict) -> None:
    try:
        from hermes_constants import profile_name_for_home
        profile = profile_name_for_home(home) or ""
    except Exception:  # noqa: BLE001 - the profile on the notification is a label only
        profile = ""
    author = claimed.get("author")
    sender = str(author.get("name") or "") if isinstance(author, dict) else ""
    session_id = str((owner or {}).get("live_session_id") or "")
    service.notify_mention(session_id, profile=profile, sender=sender, text=claimed.get("message"))


def install() -> dict:
    """Wrap what can be wrapped now. Safe to call again: a process that has not loaded the
    gateway yet gets its wraps on a later call."""
    if not state["request"]:
        state["request"] = _wrap_requests()
    if not state["mention"]:
        # The delivery module loads on first use. Load it only in a process that runs the gateway.
        if "tools.bot_live_delivery" not in sys.modules and "tui_gateway.server_requests" in sys.modules:
            try:
                import tools.bot_live_delivery  # noqa: F401
            except Exception:  # noqa: BLE001
                logger.debug("phone-push: the delivery module is not there", exc_info=True)
        state["mention"] = _wrap_mentions()
    return dict(state)
