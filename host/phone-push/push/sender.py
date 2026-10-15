"""Sign an APNs provider token and POST one alert to Apple's HTTP/2 push endpoint.

Apple's endpoint speaks HTTP/2 only — Python's ``requests`` cannot — so the live transport is
``httpx`` with ``http2=True``. That needs the ``h2`` package, which ``plugin.yaml`` declares in
``python_dependencies``. The transport is a plain callable so tests inject a fake and never
touch the network.

The provider token is an ES256 JWT signed with the ``.p8`` auth key: PyJWT signs it when
installed, else the ``cryptography`` library does (both are project dependencies; the fallback
keeps a stripped runtime working). The key's bytes are never logged.

An APNs device token is only valid on the host that issued it: App Store and TestFlight builds
use ``api.push.apple.com``, a simulator Debug build uses ``api.sandbox.push.apple.com``. If a
push answers ``BadDeviceToken`` on the recorded host we retry once on the other host and report
which one worked, so neither the app nor the owner has to pick the environment by hand.
"""

from __future__ import annotations

import base64
import json
import logging
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, cast

from .devices import normalize_token, token_prefix

logger = logging.getLogger(__name__)

PRODUCTION_HOST = "https://api.push.apple.com"
SANDBOX_HOST = "https://api.sandbox.push.apple.com"
DEFAULT_TIMEOUT = 10.0
#: Apple's provider tokens live at most one hour; refresh well before then.
_TOKEN_LIFETIME_SECONDS = 50 * 60

#: ``transport(host, token, headers, body, jwt) -> (status_code, reason)``. ``reason`` is the
#: APNs ``reason`` string for a non-200 (``BadDeviceToken``, ``Unregistered``, ...) or ``None``.
Transport = Callable[[str, str, dict, bytes, str], "tuple[int | None, str | None]"]


@dataclass
class SendOutcome:
    ok: bool
    environment: str
    status: int | None = None
    reason: str | None = None
    dead_token: bool = False
    skipped: bool = False
    error: str | None = None


def host_for(environment: str) -> str:
    return SANDBOX_HOST if (environment or "").strip().lower() == "sandbox" else PRODUCTION_HOST


def other_environment(environment: str) -> str:
    return "sandbox" if (environment or "").strip().lower() != "sandbox" else "production"


#: Request kinds a phone can answer from the notification itself -> the category the app registers.
ACTION_CATEGORIES = {"approval": "hermes.approval"}


def build_payload(*, session_id: str, profile: str, kind: str, title: str, body: str,
                  sender: str = "") -> dict:
    """The APNs payload: a short alert plus the routing keys a tap needs.

    ``thread-id`` groups a session's notifications in iOS; ``session_id`` / ``profile`` /
    ``kind`` are the custom keys the app reads to open the right chat, and ``sender`` (when known)
    names who spoke. Never a secret.
    """
    payload = {
        "aps": {
            "alert": {"title": title, "body": body},
            "sound": "default",
            "thread-id": session_id,
        },
        "session_id": session_id,
        "profile": profile,
        "kind": kind,
    }
    if sender:
        payload["sender"] = sender
    if kind in ACTION_CATEGORIES:
        # The app shows the answers of this kind as buttons on the notification.
        payload["aps"]["category"] = ACTION_CATEGORIES[kind]
    return payload


def build_headers(*, bundle_id: str) -> dict:
    """The APNs request headers: the topic is the bundle id, the push type is ``alert``."""
    return {
        "apns-topic": bundle_id,
        "apns-push-type": "alert",
        "content-type": "application/json",
    }


def build_jwt(key_id: str, team_id: str, private_key_pem: str, *, now: float | None = None) -> str:
    """A fresh ES256 provider token (``{alg,kid}`` / ``{iss,iat}``)."""
    issued = int(now if now is not None else time.time())
    try:
        import jwt as _pyjwt  # PyJWT[crypto]; a project dependency
    except ImportError:
        return _encode_jwt_cryptography(key_id, team_id, private_key_pem, issued)
    return _pyjwt.encode(
        {"iss": team_id, "iat": issued}, private_key_pem,
        algorithm="ES256", headers={"kid": key_id})


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _encode_jwt_cryptography(key_id: str, team_id: str, pem: str, issued: int) -> str:
    """ES256 JWT without PyJWT: ECDSA P-256 / SHA-256, signature as raw r||s (JOSE form)."""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

    key = cast(ec.EllipticCurvePrivateKey,
               serialization.load_pem_private_key(pem.encode("utf-8"), password=None))
    header = _b64url(json.dumps({"alg": "ES256", "kid": key_id}, separators=(",", ":")).encode())
    claims = _b64url(json.dumps({"iss": team_id, "iat": issued}, separators=(",", ":")).encode())
    signing_input = f"{header}.{claims}".encode("ascii")
    der = key.sign(signing_input, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    signature = _b64url(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
    return f"{header}.{claims}.{signature}"


_key_cache: dict[str, tuple[int, str]] = {}
_key_lock = threading.Lock()


def _load_private_key_pem(key_path: str) -> str | None:
    """Read the ``.p8`` key, cached by mtime. ``None`` when the file is not there yet.

    The owner keeps the key outside Hermes until they move it in, so a missing file is a
    normal state, not an error: the caller logs one clear line and skips the push.
    """
    if not key_path:
        return None
    path = Path(key_path).expanduser()
    try:
        stat = path.stat()
    except OSError:
        return None
    key = str(path)
    with _key_lock:
        cached = _key_cache.get(key)
        if cached is not None and cached[0] == stat.st_mtime_ns:
            return cached[1]
    try:
        # utf-8-sig: a BOM-prefixed PEM is still the same key (Windows tooling adds one).
        pem = path.read_text(encoding="utf-8-sig")
    except OSError:
        return None
    with _key_lock:
        _key_cache[key] = (stat.st_mtime_ns, pem)
    return pem


def _httpx_transport(host: str, token: str, headers: dict, body: bytes, jwt_token: str) -> tuple[int | None, str | None]:
    """POST to ``https://<host>/3/device/<token>`` over HTTP/2. Network only."""
    import httpx

    url = f"{host}/3/device/{token}"
    request_headers = {**headers, "authorization": f"bearer {jwt_token}"}
    with httpx.Client(http2=True, timeout=DEFAULT_TIMEOUT) as client:
        response = client.post(url, content=body, headers=request_headers)
    reason = None
    if response.status_code != 200:
        try:
            reason = (response.json() or {}).get("reason")
        except ValueError:
            # APNs answered with something that is not JSON; the status code is the whole
            # story then. `httpx.Response.json` raises JSONDecodeError (a ValueError).
            reason = None
    return response.status_code, reason


def deliver(cfg: dict, device: dict, payload: dict, *, transport: Transport | None = None,
            now: float | None = None) -> SendOutcome:
    """Send *payload* to one device, with the one-shot environment fallback.

    Returns an outcome the caller uses to update the registry. A missing key or incomplete
    config is ``skipped`` (logged, never raised); ``BadDeviceToken``/``Unregistered`` set
    ``dead_token`` so the device is dropped.
    """
    token = normalize_token(device.get("token", ""))
    environment = (device.get("environment") or cfg.get("environment") or "production").strip().lower()
    key_path = cfg.get("apns_key_path") or ""
    key_id = cfg.get("apns_key_id") or ""
    team_id = cfg.get("apns_team_id") or ""
    bundle_id = cfg.get("bundle_id") or ""

    if not (key_path and key_id and team_id and bundle_id):
        logger.warning("push: config incomplete (key path / key id / team id / bundle id); "
                       "skipping push to %s…", token_prefix(token))
        return SendOutcome(ok=False, environment=environment, skipped=True, error="config incomplete")

    pem = _load_private_key_pem(key_path)
    if pem is None:
        logger.warning("push: APNs key not found at %s; skipping push to %s… "
                       "(move the .p8 key there or fix push.apns_key_path)", key_path, token_prefix(token))
        return SendOutcome(ok=False, environment=environment, skipped=True, error="apns key missing")

    try:
        jwt_token = build_jwt(key_id, team_id, pem, now=now)
    except Exception as exc:  # a bad key is our misconfiguration, not the device's
        # PyJWT's / cryptography's own exception types (PyJWTError, UnsupportedAlgorithm,
        # ValueError) differ by which signer is installed, so this stays a catch-all boundary and
        # logs the traceback for whoever has to fix the key.
        logger.warning("push: could not sign the APNs token: %s", exc, exc_info=True)
        return SendOutcome(ok=False, environment=environment, error="sign failed")

    headers = build_headers(bundle_id=bundle_id)
    body = json.dumps(payload).encode("utf-8")
    post = transport or _httpx_transport

    tried: list[str] = []
    last: tuple[int | None, str | None] = (None, None)
    for env in (environment, other_environment(environment)):
        if env in tried:
            continue
        tried.append(env)
        status, reason = post(host_for(env), token, headers, body, jwt_token)
        last = (status, reason)
        if status == 200:
            return SendOutcome(ok=True, environment=env, status=200)
        if status == 400 and reason == "BadDeviceToken":
            # The token may belong to the other host; try that once before calling it dead.
            continue
        if status == 410 or reason == "Unregistered":
            return SendOutcome(ok=False, environment=env, status=status, reason=reason, dead_token=True)
        return SendOutcome(ok=False, environment=env, status=status, reason=reason)

    status, reason = last
    return SendOutcome(ok=False, environment=tried[-1], status=status, reason=reason or "BadDeviceToken",
                       dead_token=True)
