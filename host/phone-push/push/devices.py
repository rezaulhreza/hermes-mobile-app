"""The APNs device registry: which phones asked to be buzzed, in ``<home>/push_devices.json``.

A device token is a capability — whoever holds it can push to that device — so the file is
written atomically (temp file + ``os.replace``) and with ``0600`` permissions, tokens are
deduplicated on write, and a token is only ever logged as a short prefix.

A token that Apple answers ``BadDeviceToken`` or ``Unregistered`` for is dead (the app was
reinstalled or the token was rotated); it is dropped rather than retried forever. Every other
failure just increments a counter, so a transient outage does not forget the phone.
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from hermes_constants import get_hermes_home

logger = logging.getLogger(__name__)

#: APNs device tokens are 64 lowercase hex characters; a stray value is refused rather than
#: stored (a malformed token would be re-sent to Apple on every request, forever).
TOKEN_RE = re.compile(r"^[0-9a-fA-F]{64}$")

ENVIRONMENTS = ("production", "sandbox")
STORE_NAME = "push_devices.json"


def is_valid_token(token: Any) -> bool:
    return isinstance(token, str) and TOKEN_RE.fullmatch(token.strip()) is not None


def normalize_token(token: str) -> str:
    return (token or "").strip().lower()


def token_prefix(token: str) -> str:
    """The only part of a token safe to log."""
    return (token or "")[:8]


def store_path() -> Path:
    """``~/.hermes/push_devices.json`` for the process home (profile-aware via HERMES_HOME)."""
    return get_hermes_home() / STORE_NAME


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_devices(path: Path | None = None) -> list[dict]:
    """The registry as a list of records; a missing or malformed file reads as empty."""
    path = path or store_path()
    try:
        # utf-8-sig: Windows tooling BOMs files it touches, and json.load fails on one.
        raw = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return []
    except OSError as exc:
        logger.warning("push: could not read device registry %s: %s", path, exc)
        return []
    try:
        data = json.loads(raw)
    except ValueError:
        logger.warning("push: device registry %s is not valid JSON; ignoring it", path)
        return []
    devices = data.get("devices") if isinstance(data, dict) else None
    if not isinstance(devices, list):
        return []
    return [d for d in devices if isinstance(d, dict) and is_valid_token(d.get("token"))]


def save_devices(devices: list[dict], path: Path | None = None) -> None:
    """Write the registry atomically and owner-only; never leave a half-written file."""
    path = path or store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".push_devices-", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump({"devices": devices}, fh, indent=2, sort_keys=True)
            fh.write("\n")
        os.chmod(tmp_name, 0o600)
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def register_device(token: str, *, environment: str = "production", platform: str = "ios",
                    profile: str = "default", label: str = "", path: Path | None = None) -> dict:
    """Add a device or refresh the one already registered for this token.

    Deduplication is on the token alone: re-registering the same phone updates its
    environment/profile/label and clears its failure count instead of appending a twin.
    Raises ``ValueError`` for a malformed token or environment so the route can answer 422.
    """
    token = normalize_token(token)
    if not is_valid_token(token):
        raise ValueError("device token must be 64 hex characters")
    environment = (environment or "production").strip().lower()
    if environment not in ENVIRONMENTS:
        raise ValueError("environment must be production or sandbox")

    devices = load_devices(path)
    for record in devices:
        if normalize_token(record.get("token", "")) == token:
            record["token"] = token
            record["environment"] = environment
            record["platform"] = platform or record.get("platform", "ios")
            # An empty profile means "every profile"; don't let a re-register blank a set one.
            wanted_profile = (profile or "").strip()
            if wanted_profile:
                record["profile"] = wanted_profile
            if label:
                record["label"] = label
            record["failures"] = 0
            save_devices(devices, path)
            return record

    record = {
        "token": token,
        "environment": environment,
        "platform": platform or "ios",
        "profile": (profile or "").strip(),
        "label": label or "",
        "registered_at": _now_iso(),
        "last_ok": None,
        "failures": 0,
    }
    devices.append(record)
    save_devices(devices, path)
    return record


def remove_device(token: str, *, path: Path | None = None) -> bool:
    """Forget a device. True when a record was removed."""
    token = normalize_token(token)
    devices = load_devices(path)
    kept = [d for d in devices if normalize_token(d.get("token", "")) != token]
    if len(kept) == len(devices):
        return False
    save_devices(kept, path)
    return True


def _mutate(token: str, path: Path | None, fn) -> dict | None:
    token = normalize_token(token)
    devices = load_devices(path)
    for record in devices:
        if normalize_token(record.get("token", "")) == token:
            fn(record)
            save_devices(devices, path)
            return record
    return None


def record_success(token: str, *, environment: str | None = None, path: Path | None = None) -> dict | None:
    """Mark a delivery good: stamp ``last_ok`` and clear the failure count."""
    def _apply(record: dict) -> None:
        record["last_ok"] = _now_iso()
        record["failures"] = 0
        if environment:
            record["environment"] = environment
    return _mutate(token, path, _apply)


def record_failure(token: str, *, path: Path | None = None) -> dict | None:
    """Count a non-fatal failure (network, 5xx, ExpiredProviderToken)."""
    def _apply(record: dict) -> None:
        try:
            record["failures"] = int(record.get("failures") or 0) + 1
        except (TypeError, ValueError):
            record["failures"] = 1
    return _mutate(token, path, _apply)


def devices_for_profile(profile: str, *, path: Path | None = None) -> list[dict]:
    """Devices that should hear about *profile*: those registered for it, plus profile-less ones."""
    wanted = (profile or "").strip()
    return [d for d in load_devices(path) if not d.get("profile") or d.get("profile") == wanted]
