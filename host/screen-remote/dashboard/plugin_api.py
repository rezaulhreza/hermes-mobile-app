"""REST routes for the phone app's screen view, mounted at ``/api/plugins/screen-remote``.

Everything goes through the computer-use backend that Hermes ships (cua-driver), so the routes
are the same on macOS, Windows and Linux, and they need the same permissions the agent's own
``computer_use`` tool needs. The driver works per window: the picture is one window, and a tap is
a position in that picture.

The routes are behind the dashboard's sign-in, like every other ``/api`` route. Input is taken
only while the user holds the screen, so the user and the agent never act at the same time.
"""

from __future__ import annotations

import base64
import hashlib
import importlib.util
import logging
from io import BytesIO
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

# The driver session of the phone's view. The agent's sessions keep their own target window.
SESSION = "screen-remote"
# The longest side of the picture a phone gets. A tap is scaled back to the screenshot by the phone.
MAX_SIDE = 1280
JPEG_QUALITY = 60


def _load_hold_state():
    path = Path(__file__).resolve().parent.parent / "hold_state.py"
    spec = importlib.util.spec_from_file_location("hermes_screen_remote_hold_state", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


hold_state = _load_hold_state()


def _tool():
    try:
        from tools.computer_use import tool
    except Exception as exc:  # noqa: BLE001 - reported to the phone as "not available"
        raise HTTPException(status_code=503, detail=f"computer use is not available on this host: {exc}") from exc
    return tool


def _unavailable_reason() -> Optional[str]:
    try:
        if _tool().check_computer_use_requirements():
            return None
    except HTTPException as exc:
        return str(exc.detail)
    except Exception as exc:  # noqa: BLE001
        return str(exc)
    return "The computer-use driver is not installed or has no permission. Run: hermes computer-use doctor"


def _agent_target(session_id: str) -> tuple[Optional[int], Optional[int]]:
    """The window the agent of this chat works in: the sticky target of its own driver session."""
    tool = _tool()
    with tool._backend_lock:
        backends = [backend for key, backend in tool._backends.items() if key.split("@")[0] == session_id]
    for backend in backends:
        pid, window_id = getattr(backend, "_active_pid", None), getattr(backend, "_active_window_id", None)
        if pid is not None and window_id is not None:
            return int(pid), int(window_id)
    return None, None


def _is_blank(png_b64: str) -> bool:
    """True for a picture of one shade: a whole-screen capture that the system did not fill."""
    try:
        from PIL import Image

        # Small, so the test costs little. A real screen has light and dark places; an unfilled capture is
        # near one value everywhere (a compressed black is not exactly one value).
        image = Image.open(BytesIO(base64.b64decode(png_b64, validate=False))).convert("L")
        image.thumbnail((64, 64))
        low, high = image.getextrema()
        return high - low <= 12
    except Exception:  # noqa: BLE001
        return False


def _phone_picture(png_b64: str, mime: Optional[str]) -> tuple[str, str]:
    """A small JPEG for the phone -> (data, mime). The driver's PNG when Pillow is not there."""
    try:
        from PIL import Image

        image = Image.open(BytesIO(base64.b64decode(png_b64, validate=False))).convert("RGB")
        image.thumbnail((MAX_SIDE, MAX_SIDE))
        out = BytesIO()
        image.save(out, format="JPEG", quality=JPEG_QUALITY)
        return base64.b64encode(out.getvalue()).decode("ascii"), "image/jpeg"
    except Exception as exc:  # noqa: BLE001
        logger.debug("screen-remote: picture not shrunk: %s", exc)
        return png_b64, mime or "image/png"


@router.get("/status")
def status() -> dict[str, Any]:
    reason = _unavailable_reason()
    return {"available": reason is None, "reason": reason, "hold": hold_state.read()}


@router.get("/windows")
def windows() -> dict[str, Any]:
    with _tool()._backend_for_call(SESSION) as backend:
        found = backend.list_windows()
    return {"windows": [
        {"pid": w.get("pid"), "window_id": w.get("window_id"), "app": w.get("app_name") or "", "title": w.get("title") or ""}
        for w in found if not w.get("off_screen") and w.get("pid") is not None and w.get("window_id") is not None
    ]}


@router.get("/frame")
def frame(pid: Optional[int] = None, window_id: Optional[int] = None, session_id: Optional[str] = None,
          last: Optional[str] = None, whole: bool = False) -> dict[str, Any]:
    """The picture of one window now. With no window: the window the agent of ``session_id`` works in, else the
    frontmost window. ``last`` is the digest of the picture the phone has: an unchanged picture is not sent again.
    ``whole`` gives the whole screen, every window on it: a picture to look at. It names no window, so the phone
    sends no input for it."""
    if not whole and (pid is None or window_id is None) and session_id:
        pid, window_id = _agent_target(session_id)
    exact = not whole and pid is not None and window_id is not None
    with _tool()._backend_for_call(SESSION) as backend:
        if whole:
            # This is the plugin's own driver session: the window the agent works in is in the agent's session.
            capture = backend.capture(mode="vision", app="screen")
            target = {"pid": None, "window_id": None}
        else:
            capture = backend.capture(mode="vision", **({"pid": pid, "window_id": window_id} if exact else {}))
            target = {"pid": getattr(backend, "_active_pid", None), "window_id": getattr(backend, "_active_window_id", None)}
    if not capture.png_b64:
        raise HTTPException(status_code=404, detail=capture.note or "The window gave no picture. It may be closed.")
    if whole and _is_blank(capture.png_b64):
        raise HTTPException(status_code=404, detail="The host gave an empty picture of the whole screen. Its screen "
                                                    "driver cannot capture every window here. Choose one window.")
    if hold_state.read():
        hold_state.hold()  # an open view keeps the hold alive
    digest = hashlib.sha256(capture.png_b64.encode("ascii", "ignore")).hexdigest()[:16]
    head = {**target, "app": "" if whole else capture.app, "title": "" if whole else capture.window_title, "width": capture.width,
            "height": capture.height, "digest": digest, "hold": hold_state.read()}
    if digest == last:
        return {**head, "unchanged": True}
    data, mime = _phone_picture(capture.png_b64, capture.image_mime_type)
    return {**head, "image": f"data:{mime};base64,{data}"}


class Hold(BaseModel):
    held: bool
    reason: str = ""


@router.post("/hold")
def hold(body: Hold) -> dict[str, Any]:
    if body.held:
        return {"hold": hold_state.hold(body.reason)}
    hold_state.release()
    return {"hold": None}


class Input(BaseModel):
    pid: int
    window_id: int
    action: Literal["click", "double_click", "right_click", "type", "key", "scroll", "drag"]
    # Positions are pixels of the screenshot (``width`` x ``height`` of the frame), not of the phone's picture.
    x: Optional[int] = None
    y: Optional[int] = None
    to_x: Optional[int] = None
    to_y: Optional[int] = None
    text: str = ""
    keys: str = ""
    direction: Literal["up", "down", "left", "right"] = "down"
    amount: int = 3


def _act(backend, body: Input, delivery_mode: Optional[str]):
    mode = {"delivery_mode": delivery_mode} if delivery_mode else {}
    if body.action in ("click", "double_click", "right_click"):
        return backend.click(x=body.x, y=body.y, button="right" if body.action == "right_click" else "left",
                             click_count=2 if body.action == "double_click" else 1, **mode)
    if body.action == "type":
        return backend.type_text(body.text, **mode)
    if body.action == "key":
        return backend.key(body.keys, **mode)
    if body.action == "scroll":
        return backend.scroll(direction=body.direction, amount=body.amount, x=body.x, y=body.y, **mode)
    return backend.drag(from_xy=(body.x, body.y), to_xy=(body.to_x, body.to_y), **mode)


@router.post("/input")
def send_input(body: Input) -> dict[str, Any]:
    """One tap, text, key or scroll from the phone, into the window of the last frame."""
    if not hold_state.read():
        raise HTTPException(status_code=409, detail="Take control first. Input is taken only while you hold the screen.")
    needs_point = body.action in ("click", "double_click", "right_click", "drag")
    if needs_point and (body.x is None or body.y is None):
        raise HTTPException(status_code=422, detail=f"{body.action} needs x and y")
    if body.action == "drag" and (body.to_x is None or body.to_y is None):
        raise HTTPException(status_code=422, detail="drag needs to_x and to_y")
    hold_state.hold()
    with _tool()._backend_for_call(SESSION) as backend:
        if (getattr(backend, "_active_pid", None), getattr(backend, "_active_window_id", None)) != (body.pid, body.window_id):
            backend.capture(mode="vision", pid=body.pid, window_id=body.window_id)  # sets the target of the input
        # A person expects the tap to land like a real one: front the window for the action when the
        # driver can, and fall back to background delivery when it cannot.
        result = _act(backend, body, "foreground")
        if not result.ok and result.code == "foreground_unsupported":
            result = _act(backend, body, None)
    return {"ok": bool(result.ok), "message": result.message, "effect": result.effect}
