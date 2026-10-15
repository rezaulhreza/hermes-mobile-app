"""Fire a phone push when something in a chat needs the owner.

Two triggers, one delivery path:

* :func:`notify_request` — the backend just started waiting on a human. The hook is
  ``tui_gateway.server_requests._register``: every server→client request (clarify, approval,
  sudo, ...) passes through it, and a registered request is precisely "a human is being waited on".
* :func:`notify_mention` — an inbound message in one of the owner's chats addresses him as
  ``@user``, the bot-roster convention. The hook is the gateway's inbound delivery path
  (``tui_gateway.session_notifications._poll_bot_live_delivery_once``), where a durable envelope
  becomes a turn for a session.

Both hand the actual delivery to a daemon thread, wrapped so no push failure (a missing key, a
network error, a bug) can reach the caller or delay the work it announces. A short per-session
dedupe window means one event cannot buzz twice: a message that mentions the owner and then raises
a request in the same session produces one push, not two.

Which kinds are worth a buzz is a deliberate allow-list, not "everything": housekeeping requests
(``terminal.read``, ``tour``, ``preview.act``) never push, and ``config.push.kinds`` can only
narrow the built-in human-facing set — a typo cannot turn the phone into a firehose.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from typing import Any, Callable

from hermes_cli.config import load_config

logger = logging.getLogger(__name__)

#: Pushed unless ``config.push.kinds`` overrides the list.
DEFAULT_KINDS = ("clarify", "approval", "mention")
#: The built-in human-facing requests. A phone buzz is defensible for these; housekeeping
#: (terminal.read, window.read, preview.*, tour) is excluded, and a configured kind outside this
#: set is ignored. ``mention`` is not a server request but rides the same allow-list.
KNOWN_KINDS = frozenset({
    "clarify", "approval", "mention", "sudo", "secret",
    "vault.unlock_prompt", "vault.save_login", "vault.code",
})

#: ``@user`` as a standalone mention: not glued to a preceding word (``email@user.com``), not the
#: prefix of a longer handle (``@username``, ``@user-1``). Case-insensitive for the convention.
MENTION_RE = re.compile(r"(?<![A-Za-z0-9_])@user(?![A-Za-z0-9_-])", re.IGNORECASE)
#: A relayed DM's human-facing signature, stripped before a mention summary is built.
_ATTRIBUTION_RE = re.compile(r"^Message from 🤖 .*?\(@[^)]+\):\s*", re.DOTALL)

#: One buzz per session per window, so a mention and the request it provokes collapse to one push.
DEDUPE_WINDOW_S = 120.0
_recent_buzzes: dict[str, float] = {}
_recent_lock = threading.Lock()

#: What each request kind asks of the owner, in the words of the notification.
_KIND_LABELS = {
    "clarify": "has a question",
    "approval": "needs approval",
    "sudo": "needs your sudo password",
    "secret": "needs a secret",
    "vault.unlock_prompt": "needs the vault unlocked",
    "vault.save_login": "asks to save a login",
    "vault.code": "needs a sign-in code",
}

_MAX_SUMMARY_CHARS = 140
_MAX_BODY_CHARS = 220


def _push_config() -> dict:
    """The ``push:`` block from the loaded config, or ``{}``."""
    try:
        config = load_config()
    except Exception:
        logger.debug("push: config read failed", exc_info=True)
        return {}
    block = config.get("push") if isinstance(config, dict) else None
    return block if isinstance(block, dict) else {}


def _active_profile() -> str:
    try:
        from hermes_cli.profiles import get_active_profile_name
        return get_active_profile_name() or "default"
    except Exception:
        # The payload's profile label is cosmetic: a lookup failure must never block a push, and
        # the traceback says which import or resolution broke.
        logger.debug("push: active profile lookup failed", exc_info=True)
        return "default"


def _readable_name(profile: str) -> str:
    """The name the owner knows the bot by: its Bots-roster title, else its display name, else
    the profile key. A notification that says "default" names nobody."""
    try:
        from hermes_cli.profiles import get_profile_dir, read_profile_meta
        meta = read_profile_meta(get_profile_dir(profile or "default"))
        return meta.get("bot_title") or meta.get("display_name") or profile
    except Exception:
        # Cosmetic, like the profile label above: an unknown profile must never block a push.
        logger.debug("push: readable name lookup failed for %s", profile, exc_info=True)
        return profile


def _spawn_daemon(fn: Callable[[], None]) -> threading.Thread:
    """Run *fn* on a daemon thread under the caller's contextvars.

    A bare ``threading.Thread`` starts with an empty context, so under a gateway that serves
    several profiles the delivery would read the launch profile's home and secrets.
    """
    from agent.memory_provider import spawn_context_thread

    thread = spawn_context_thread(fn, name="hermes-push")
    thread.start()
    return thread


def _kind_enabled(config: dict, kind: str) -> bool:
    kinds = config.get("kinds") or DEFAULT_KINDS
    return isinstance(kinds, (list, tuple, set)) and kind in kinds


def mentions_owner(text: Any) -> bool:
    """Whether *text* addresses the owner as ``@user`` (a standalone mention, not a substring)."""
    return isinstance(text, str) and MENTION_RE.search(text) is not None


def _should_buzz(session_id: str, *, now: float | None = None) -> bool:
    """False when this session was already buzzed inside :data:`DEDUPE_WINDOW_S`."""
    key = (session_id or "").strip()
    if not key:
        return True
    moment = time.monotonic() if now is None else now
    with _recent_lock:
        last = _recent_buzzes.get(key)
        if last is not None and moment - last < DEDUPE_WINDOW_S:
            return False
        _recent_buzzes[key] = moment
        if len(_recent_buzzes) > 512:  # opportunistic prune; keys are session ids
            cutoff = moment - DEDUPE_WINDOW_S
            for stale in [k for k, seen in _recent_buzzes.items() if seen < cutoff]:
                _recent_buzzes.pop(stale, None)
    return True


def reset_dedupe_for_tests() -> None:
    with _recent_lock:
        _recent_buzzes.clear()


def summarize(method: str, params: Any) -> str:
    """One short, newline-free line from a request's params — never the full prompt.

    Clarify uses the first question's text; approval uses its description (the command itself is
    deliberately not used: it can carry arguments or secrets). Everything else gets no summary.
    """
    if not isinstance(params, dict):
        return ""
    if method == "clarify":
        questions = params.get("questions")
        text = ""
        if isinstance(questions, list) and questions and isinstance(questions[0], dict):
            text = str(questions[0].get("question") or "")
    else:
        text = str(params.get("description") or "")
    return " ".join(text.split())[:_MAX_SUMMARY_CHARS]


def mention_summary(text: Any) -> str:
    """A short preview of a mentioning message, with the ``Message from …`` stamp stripped."""
    body = _ATTRIBUTION_RE.sub("", text or "", count=1)
    return " ".join(str(body).split())[:_MAX_SUMMARY_CHARS]


def _body(profile: str, kind: str, summary: str, sender: str = "") -> str:
    if kind == "mention":
        who = f"@{sender}" if sender else "A teammate"
        parts = [profile, f"{who} mentioned you", summary]
    else:
        parts = [profile, _KIND_LABELS.get(kind, "needs your attention"), summary]
    return " · ".join(part for part in parts if part)[:_MAX_BODY_CHARS]


def _dispatch(config: dict, *, profile: str, kind: str, session_id: str, summary: str,
              sender_name: str = "", all_devices: bool = False) -> bool:
    """Dedupe, then hand one delivery to a daemon thread. False when the window suppressed it."""
    if not _should_buzz(session_id):
        return False
    _spawn_daemon(lambda: _deliver_safely(
        config, profile=profile, kind=kind, session_id=session_id, summary=summary,
        sender_name=sender_name, all_devices=all_devices))
    return True


def notify_request(method: str, sid: str, params: Any) -> bool:
    """Best-effort, off-thread push for one registered server→client request.

    Returns immediately. Never raises: the caller is the request path itself.
    """
    try:
        if method not in KNOWN_KINDS:
            return False
        config = _push_config()
        if not config.get("enabled") or not _kind_enabled(config, method):
            return False
        return _dispatch(config, profile=_active_profile(), kind=method, session_id=sid,
                         summary=summarize(method, params))
    except Exception:
        # Defence in depth: a bug here must never break the request it was announcing.
        logger.debug("push: notify_request failed for %s", method, exc_info=True)
        return False


def notify_mention(session_id: str, *, profile: str = "", sender: str = "", text: Any = "") -> bool:
    """Push when an inbound chat message mentions the owner as ``@user``.

    ``profile`` is informational (it rides the payload); the mention goes to every registered
    device, because the owner wants to hear about a mention whichever profile or chat it landed in.
    """
    try:
        if not mentions_owner(text):
            return False
        config = _push_config()
        if not config.get("enabled") or not _kind_enabled(config, "mention"):
            return False
        return _dispatch(config, profile=profile, kind="mention", session_id=session_id,
                         summary=mention_summary(text), sender_name=sender, all_devices=True)
    except Exception:
        logger.debug("push: notify_mention failed", exc_info=True)
        return False


def _deliver_safely(config: dict, *, profile: str, kind: str, session_id: str, summary: str,
                    sender_name: str = "", all_devices: bool = False) -> None:
    try:
        deliver(config, profile=profile, kind=kind, session_id=session_id, summary=summary,
                sender_name=sender_name, all_devices=all_devices)
    except Exception:
        logger.warning("push: delivery failed for kind %s", kind, exc_info=True)


def deliver(config: dict, *, profile: str, kind: str, session_id: str, summary: str = "",
            sender_name: str = "", all_devices: bool = False,
            transport: Any = None, now: float | None = None) -> int:
    """Push one event to the owner's devices; return how many landed.

    Normally only devices registered for *profile*; ``all_devices`` ignores the profile filter (the
    mention trigger). Updates the registry per outcome: success stamps ``last_ok`` and remembers the
    environment that worked, a dead token drops the device, anything else counts a failure.
    """
    from . import devices as store
    from . import sender as sender_mod

    payload = sender_mod.build_payload(
        session_id=session_id, profile=profile, kind=kind, title="Hermes",
        body=_body(_readable_name(profile), kind, summary, sender_name), sender=sender_name)
    targets = store.load_devices() if all_devices else store.devices_for_profile(profile)
    sent = 0
    for device in targets:
        outcome = sender_mod.deliver(config, device, payload, transport=transport, now=now)
        token = device.get("token", "")
        if outcome.ok:
            store.record_success(token, environment=outcome.environment)
            sent += 1
        elif outcome.dead_token:
            logger.info("push: dropping dead device %s… (%s)", store.token_prefix(token), outcome.reason)
            store.remove_device(token)
        else:
            store.record_failure(token)
    return sent
