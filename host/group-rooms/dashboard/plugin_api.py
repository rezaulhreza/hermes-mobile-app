"""REST routes for group chats of bots, mounted at ``/api/plugins/group-rooms``.

Two things exist in Hermes already, and this plugin only joins them:

- The room RECORD that the desktop app keeps on the main profile (``ui_meta['hermes-bots-groups']``):
  the rooms, their members and the newest messages. Every client reads it.
- The room ENGINE of the gateway (the ``groups.*`` methods): it gives a message to each member in turn
  and logs the answers. Its roster is fixed when a room is made.

A message posted here goes into the record, then into an engine room with the same members, and each
answer of the engine is copied back into the record. So the round runs on the host: a client that
goes to sleep loses nothing. Everything goes through the gateway's public methods, called in this
process; the plugin reads no private name of Hermes.

The routes are behind the dashboard's sign-in, like every other ``/api`` route.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import time
import uuid
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

META_KEY = "hermes-bots-groups"
# Each bot also names its groups in its own record. The desktop app draws a group from those names.
BOT_META_KEY = "hermes-bots"
MAIN_PROFILE = "default"
# The limits of the desktop app for the record: it rides on every list of the bots.
MAX_MESSAGES = 16
MAX_TEXT = 1200
MAX_BYTES = 48_000
TRUNCATED = "… [truncated]"
# The engine takes two to six members.
MIN_MEMBERS, MAX_MEMBERS = 2, 6
# A message within this time of the one before continues its thread.
THREAD_GAP_MS = 15 * 60_000
ROUND_LIMIT_S = 20 * 60
POLL_S = 1.5
QUIET_POLLS = 20
WRITE_TRIES = 5

_followers: dict[str, threading.Thread] = {}
_followers_lock = threading.Lock()


class Refused(Exception):
    """The gateway answered a call with an error."""


def _stamp(number: int) -> str:
    """A number in base 36, as the desktop app writes its ids."""
    digits, out = "0123456789abcdefghijklmnopqrstuvwxyz", ""
    while number:
        number, rest = divmod(number, 36)
        out = digits[rest] + out
    return out or "0"


def _rpc(method: str, params: dict) -> dict:
    from tui_gateway import server

    answer = server.handle_request({"jsonrpc": "2.0", "id": f"group-rooms-{uuid.uuid4().hex}", "method": method, "params": params})
    if not isinstance(answer, dict) or "error" in answer:
        error = (answer or {}).get("error") if isinstance(answer, dict) else None
        raise Refused(str((error or {}).get("message") or f"{method} gave no answer"))
    result = answer.get("result")
    return result if isinstance(result, dict) else {}


# --- the record -----------------------------------------------------------------------------


def _read() -> tuple[dict, int, dict[str, dict]]:
    """The record, its revision, and the profiles of this host by name."""
    profiles = [row for row in _rpc("profiles.list", {"include_sessions": False}).get("profiles") or [] if isinstance(row, dict)]
    main = next((row for row in profiles if row.get("name") == MAIN_PROFILE), {})
    record = (main.get("ui_meta") or {}).get(META_KEY)
    record = json.loads(json.dumps(record)) if isinstance(record, dict) else {}
    record.setdefault("version", 3)
    if not isinstance(record.get("rooms"), dict):
        record["rooms"] = {}
    if not isinstance(record.get("deleted"), dict):
        record["deleted"] = {}
    revision = int((main.get("ui_meta_revisions") or {}).get(META_KEY) or 0)
    return record, revision, {str(row.get("name")): row for row in profiles}


def _fit(room: dict) -> None:
    """Keep the newest messages of a room inside the limits of the record."""
    log = [entry for entry in room.get("log") or [] if isinstance(entry, dict)]
    for entry in log:
        text = str(entry.get("text") or "")
        if len(text) > MAX_TEXT:
            entry["text"] = text[: MAX_TEXT - len(TRUNCATED)] + TRUNCATED
            entry["truncated"] = True
    dropped = max(0, len(log) - MAX_MESSAGES)
    room["log"] = log[dropped:]
    if dropped:
        room["omitted"] = int(room.get("omitted") or 0) + dropped


def _write(change) -> Any:
    """Apply ``change(record, next_revision, profiles)`` and store the record. Another client may
    write at the same time: the host then refuses, and the change runs again on the new record."""
    for _ in range(WRITE_TRIES):
        record, revision, profiles = _read()
        answer = change(record, revision + 1, profiles)
        record["updatedAt"] = int(time.time() * 1000)
        while len(json.dumps(record)) > MAX_BYTES:
            longest = max(record["rooms"].values(), key=lambda room: len(room.get("log") or []), default=None)
            if not longest or not longest.get("log"):
                raise HTTPException(status_code=507, detail="The record of the rooms is full.")
            longest["log"] = longest["log"][1:]
            longest["omitted"] = int(longest.get("omitted") or 0) + 1
        result = _rpc("profiles.configure", {"name": MAIN_PROFILE, "ui_meta": {META_KEY: record}, "ui_meta_expected_revisions": {META_KEY: revision}})
        if (result.get("applied") or {}).get("ui_meta"):
            return answer
        time.sleep(0.15)
    raise HTTPException(status_code=409, detail="Another client changes the rooms at this moment. Try again.")


def _key(record: dict, room_id: str) -> str:
    for key, room in record["rooms"].items():
        if isinstance(room, dict) and (room.get("roomId") == room_id or key == room_id):
            return key
    raise HTTPException(status_code=404, detail="This room is closed or does not exist.")


def _members(names: list[str], profiles: dict[str, dict], known: Optional[list] = None) -> list[dict]:
    """Member rows for these profiles. A row the desktop app wrote stays as it is."""
    kept = {str(row.get("name")): row for row in known or [] if isinstance(row, dict)}
    rows, taken = [], set()
    for name in dict.fromkeys(str(name).strip() for name in names):
        if name not in profiles:
            raise HTTPException(status_code=400, detail=f"This host has no bot named {name}.")
        row = kept.get(name) or {"name": name, "handle": _handle(name, profiles[name]), "connectionId": "local", "connectionKind": "local", "sourceScoped": True}
        while str(row.get("handle") or "").casefold() in taken:
            row = {**row, "handle": f"{row.get('handle')}2"}
        taken.add(str(row.get("handle") or "").casefold())
        rows.append(row)
    if not MIN_MEMBERS <= len(rows) <= MAX_MEMBERS:
        raise HTTPException(status_code=400, detail=f"A room has {MIN_MEMBERS} to {MAX_MEMBERS} bots.")
    return rows


def _title(row: dict) -> str:
    bots = (row.get("ui_meta") or {}).get("hermes-bots")
    title = bots.get("title") if isinstance(bots, dict) else None
    return str(title or row.get("display_name") or row.get("name") or "")


def _handle(name: str, row: dict) -> str:
    words = re.sub(r"[^A-Za-z0-9]+", "-", _title(row)).strip("-").lower()
    return words or re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").lower() or "bot"


def _name_in_bots(name: str, members: Optional[list[str]], old_name: Optional[str] = None) -> None:
    """Make the bots' own records agree with a room: the bots in ``members`` name the group, no
    other bot does, and nobody names ``old_name``. ``members=None`` takes the group out of every
    record (the room is closed). The desktop app keeps the same field in step on every change of
    a room; without this a closed or renamed room comes back as a group with no messages."""
    profiles = [row for row in _rpc("profiles.list", {"include_sessions": False}).get("profiles") or [] if isinstance(row, dict)]
    gone = {value.casefold() for value in (name, old_name) if value}
    for row in profiles:
        record = (row.get("ui_meta") or {}).get(BOT_META_KEY)
        record = dict(record) if isinstance(record, dict) else {}
        before = [group for group in record.get("groups") or [] if isinstance(group, str)]
        after = [group for group in before if group.casefold() not in gone]
        if members is not None and row.get("name") in members:
            after.append(name)
        if after == before:
            continue
        current = record.get("group")
        record["groups"] = after
        record["group"] = current if current in after else (after[0] if after else None)
        revision = int((row.get("ui_meta_revisions") or {}).get(BOT_META_KEY) or 0)
        try:
            _rpc("profiles.configure", {"name": row.get("name"), "ui_meta": {BOT_META_KEY: record}, "ui_meta_expected_revisions": {BOT_META_KEY: revision}})
        except Refused:
            logger.warning("group-rooms: could not update the groups of %s", row.get("name"))


# --- the engine -----------------------------------------------------------------------------


def _engine_id(room: dict) -> str:
    """The engine room of a room with THESE members. A change of the members gives a new one."""
    names = sorted(str(row.get("name")) for row in room.get("members") or [] if isinstance(row, dict))
    return "gr-" + hashlib.sha256(json.dumps([room.get("roomId"), names]).encode()).hexdigest()[:24]


def _engine_members(room: dict, profiles: dict[str, dict]) -> list[dict]:
    rows = []
    for row in room.get("members") or []:
        name = str(row.get("name"))
        if name not in profiles:
            raise HTTPException(status_code=409, detail=f"The bot {name} of this room is not on this host any more. Take it out of the room first.")
        handle = re.sub(r"[^A-Za-z0-9._:-]+", "-", str(row.get("handle") or name)).strip("-") or name
        rows.append({"member_id": name, "profile": name, "handle": handle, "display_name": _title(profiles[name])[:200]})
    if not MIN_MEMBERS <= len(rows) <= MAX_MEMBERS:
        raise HTTPException(status_code=409, detail=f"The host runs a round for {MIN_MEMBERS} to {MAX_MEMBERS} bots. This room has {len(rows)}.")
    return rows


def _copy_answers(room_id: str, engine_id: str, since: int) -> tuple[int, bool, bool]:
    """Copy the answers the engine logged after ``since`` into the record. Returns the new cursor,
    whether the engine works on the room at this moment, and whether it closed a round."""
    page = _rpc("groups.log", {"room_id": engine_id, "since_seq": since, "limit": 200})
    events = [event for event in page.get("events") or [] if isinstance(event, dict)]
    said = [event for event in events if event.get("kind") == "message.member"]
    if said:
        def add(record, _next, _profiles):
            room = record["rooms"][_key(record, room_id)]
            have = {entry.get("id") for entry in room.get("log") or []}
            for event in said:
                payload = event.get("payload") or {}
                if event.get("event_id") not in have and str(payload.get("text") or "").strip():
                    room.setdefault("log", []).append({
                        "id": event["event_id"], "from": {"kind": "member", "name": str((event.get("actor") or {}).get("id") or payload.get("member_id"))},
                        "text": str(payload["text"]), "at": int(float(event.get("created_at") or time.time()) * 1000), "thread": str(payload.get("thread_id") or "")})
            _fit(room)
        _write(add)
    cursor = max([since, *(int(event.get("seq") or 0) for event in events)])
    status = _rpc("groups.state", {"room_id": engine_id}).get("driver_status") or {}
    closed = any(event.get("kind") == "room.activity" for event in events)
    return cursor, bool(status.get("working")) or bool(page.get("has_more")), closed


def _follow(room_id: str, engine_id: str, since: int) -> None:
    """Copy the answers of one round as they come. One follower a room."""
    def run() -> None:
        cursor, quiet, end = since, 0, time.time() + ROUND_LIMIT_S
        try:
            # The engine says when a round is closed. Between two members it rests, so a quiet
            # moment is no end: only a long one is (a stopped round logs no close).
            while time.time() < end and quiet < QUIET_POLLS:
                time.sleep(POLL_S)
                moved, working, closed = _copy_answers(room_id, engine_id, cursor)
                if closed:
                    break
                quiet = 0 if working or moved > cursor else quiet + 1
                cursor = moved
        except Exception:  # noqa: BLE001 - the next read of the room copies what is left
            logger.exception("group-rooms: the follower of %s stopped", room_id)
        finally:
            with _followers_lock:
                _followers.pop(room_id, None)

    with _followers_lock:
        if room_id in _followers:
            return
        thread = threading.Thread(target=run, name=f"group-rooms-{room_id}", daemon=True)
        _followers[room_id] = thread
    thread.start()


def _following(room_id: str) -> bool:
    with _followers_lock:
        return room_id in _followers


def _round(engine_id: str) -> list[dict]:
    """The turns of the round that runs, or that ran last: which bot works, which one waits, which
    one is done. In the order the engine gave them out.

    No RPC of the gateway names the bot of a turn (``groups.state`` gives counts only), so this
    reads the task list of the engine, and reads only. IF A HERMES UPDATE MOVES IT: the list is
    empty, and the phone says "The bots answer in turn" as it did before. See LEDGER.md."""
    try:
        from gateway.hosted_room_driver import list_tasks
        from gateway.hosted_rooms import default_db_path

        tasks = [task for task in list_tasks(default_db_path(), room_id=engine_id) if isinstance(task.get("payload"), dict)]
        if not tasks:
            return []
        # A message of the user starts a discussion. Its turns name the place of that message in the log.
        last = str(tasks[-1]["payload"].get("source_event_seq"))
        ms = lambda at: int(float(at) * 1000) if at else 0  # noqa: E731
        return [
            {"member": str(task["payload"].get("target_member_id") or ""), "status": str(task.get("status") or ""),
             "started_at": ms(task.get("started_at")), "ended_at": ms(task.get("terminal_at"))}
            for task in tasks if str(task["payload"].get("source_event_seq")) == last]
    except Exception:  # noqa: BLE001 - the room is readable without it
        logger.debug("group-rooms: the turns of %s cannot be read", engine_id, exc_info=True)
        return []


def _engine_state(engine_id: str) -> Optional[dict]:
    try:
        return _rpc("groups.state", {"room_id": engine_id})
    except Refused:
        return None


def _shown(key: str, room: dict, working: bool = False) -> dict:
    return {"key": key, "room_id": room.get("roomId") or key, "name": room.get("name") or "", "members": room.get("members") or [],
            "log": room.get("log") or [], "omitted": int(room.get("omitted") or 0), "working": working}


# --- the routes -----------------------------------------------------------------------------


class NewRoom(BaseModel):
    name: str
    members: list[str]


class RoomChange(BaseModel):
    name: Optional[str] = None
    members: Optional[list[str]] = None


class NewMessage(BaseModel):
    text: str
    # A key of the client for this message: a second post with the same key adds nothing.
    id: Optional[str] = None
    # The thread the message goes on with. Without it, ``fresh`` starts a new thread, and a client
    # that says neither gets the thread of the message before when that one is recent.
    thread: Optional[str] = None
    fresh: bool = False


def _guard(work):
    try:
        return work()
    except Refused as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/status")
def status() -> dict:
    """Whether this host can run a round."""
    try:
        _rpc("groups.list", {"limit": 1})
        return {"ok": True, "min_members": MIN_MEMBERS, "max_members": MAX_MEMBERS}
    except Exception as exc:  # noqa: BLE001 - said to the client in words
        return {"ok": False, "reason": str(exc)}


@router.get("/rooms/{room_id}")
def read_room(room_id: str) -> dict:
    """One room, with the answers of a round that ended while no follower ran."""
    def work():
        record, _revision, _profiles = _read()
        key = _key(record, room_id)
        engine_id = _engine_id(record["rooms"][key])
        state = _engine_state(engine_id)
        working = False
        if state is not None:
            latest = int((state.get("room") or {}).get("latest_seq") or 0)
            working = bool((state.get("driver_status") or {}).get("working"))
            if working:
                _follow(room_id, engine_id, max(0, latest - 1))
            else:
                _copy_answers(room_id, engine_id, max(0, latest - 60))
                record, _revision, _profiles = _read()
        # Between two members the engine rests for a moment: the follower says that the round goes on.
        shown = _shown(key, record["rooms"][_key(record, room_id)], working or _following(room_id))
        return {**shown, "round": _round(engine_id) if state is not None else []}
    return _guard(work)


@router.get("/rooms/{room_id}/messages/{message_id}")
def read_message(room_id: str, message_id: str) -> dict:
    """One message in full. The record keeps only the start of a long message (``MAX_TEXT``); the
    log of the engine keeps all of it. A message of a round the desktop app ran, or of the room
    before its members changed, is not in that log."""
    def work():
        record, _revision, _profiles = _read()
        room = record["rooms"][_key(record, room_id)]
        engine_id = _engine_id(room)
        # The engine gives a message of the user an id of its own. Such a message is found by the
        # start that the record kept: more than a thousand characters, so no other message has it.
        kept = next((str(entry.get("text") or "") for entry in room.get("log") or [] if isinstance(entry, dict) and entry.get("id") == message_id), "")
        start = kept[: -len(TRUNCATED)] if kept.endswith(TRUNCATED) else ""
        same_start, cursor = "", 0
        try:
            while True:
                page = _rpc("groups.log", {"room_id": engine_id, "since_seq": cursor, "limit": 200})
                for event in page.get("events") or []:
                    text = str((event.get("payload") or {}).get("text") or "") if isinstance(event, dict) else ""
                    if text.strip() and event.get("event_id") == message_id:
                        return {"id": message_id, "text": text}
                    if start and len(text) > len(start) and text.startswith(start):
                        same_start = text
                moved = int(page.get("cursor") or 0)
                if not page.get("has_more") or moved <= cursor:
                    break
                cursor = moved
        except Refused:
            pass  # The engine has no room for these members: it has no log of them.
        if same_start:
            return {"id": message_id, "text": same_start}
        raise HTTPException(status_code=404, detail="The host does not have the rest of this message.")
    return _guard(work)


@router.post("/rooms")
def make_room(body: NewRoom) -> dict:
    name = body.name.strip()[:64]
    if not name:
        raise HTTPException(status_code=400, detail="A room needs a name.")
    room_id = f"r{_stamp(int(time.time() * 1000))}-{uuid.uuid4().hex[:5]}"

    def change(record, revision, profiles):
        if any(isinstance(room, dict) and str(room.get("name") or "").casefold() == name.casefold() for room in record["rooms"].values()):
            raise HTTPException(status_code=409, detail="A room has this name already.")
        record["rooms"][f"id:{room_id}"] = {"name": name, "roomId": room_id, "members": _members(body.members, profiles), "log": [], "holdDetection": True, "revision": revision}
        return _shown(f"id:{room_id}", record["rooms"][f"id:{room_id}"])

    def work():
        shown = _write(change)
        _name_in_bots(name, [str(row.get("name")) for row in shown["members"]])
        return shown
    return _guard(work)


@router.patch("/rooms/{room_id}")
def change_room(room_id: str, body: RoomChange) -> dict:
    """Rename a room or set its members. The engine starts a new room for new members; the
    messages stay in the record."""
    old: dict = {}

    def change(record, revision, profiles):
        key = _key(record, room_id)
        room = record["rooms"][key]
        old.setdefault("name", str(room.get("name") or ""))
        if body.name is not None:
            name = body.name.strip()[:64]
            if not name:
                raise HTTPException(status_code=400, detail="A room needs a name.")
            room["name"] = name
        if body.members is not None:
            room["members"] = _members(body.members, profiles, room.get("members"))
        room["revision"] = revision
        return _shown(key, room)

    def work():
        shown = _write(change)
        _name_in_bots(shown["name"], [str(row.get("name")) for row in shown["members"]], old.get("name"))
        return shown
    return _guard(work)


@router.delete("/rooms/{room_id}")
def close_room(room_id: str) -> dict:
    engine_ids: list[str] = []
    names: list[str] = []

    def change(record, revision, _profiles):
        key = _key(record, room_id)
        room = record["rooms"].pop(key)
        engine_ids.append(_engine_id(room))
        names.append(str(room.get("name") or ""))
        record["deleted"][key] = revision
        return {"ok": True}

    def work():
        answer = _write(change)
        for name in names:
            _name_in_bots(name, None)
        return answer
    answer = _guard(work)
    for engine_id in engine_ids:
        try:
            _rpc("groups.disband", {"room_id": engine_id, "cancel_id": "room-closed"})
        except Refused:
            pass  # No round was ever run for these members.
    return answer


@router.delete("/groups")
def forget_group(name: str) -> dict:
    """Remove a group that has no room record: only the bots' own records name it. That is all
    the desktop app does for such a group too."""
    wanted = name.strip()
    if not wanted:
        raise HTTPException(status_code=400, detail="A group needs a name.")
    return _guard(lambda: (_name_in_bots(wanted, None), {"ok": True})[1])


@router.post("/rooms/{room_id}/messages")
def post_message(room_id: str, body: NewMessage) -> dict:
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="The message is empty.")
    message_id = (body.id or uuid.uuid4().hex)[:96]
    found: dict = {}

    def change(record, _revision, profiles):
        key = _key(record, room_id)
        room = record["rooms"][key]
        found.update(engine_id=_engine_id(room), members=_engine_members(room, profiles), name=str(room.get("name") or "Room"))
        log = room.setdefault("log", [])
        now = int(time.time() * 1000)
        if not any(entry.get("id") == message_id for entry in log):
            last = log[-1] if log else {}
            thread = re.sub(r"[^A-Za-z0-9._:-]+", "-", body.thread or "")[:128]
            if not thread and not body.fresh:
                thread = str(last.get("thread") or "") if now - int(last.get("at") or 0) < THREAD_GAP_MS else ""
            found["thread"] = thread or f"t{_stamp(now)}-{uuid.uuid4().hex[:5]}"
            log.append({"id": message_id, "from": {"kind": "user", "name": "You"}, "text": text, "at": now, "thread": found["thread"]})
            _fit(room)
        else:
            found["thread"] = next(str(entry.get("thread") or "") for entry in log if entry.get("id") == message_id)
        return _shown(key, room, True)

    def work():
        shown = _write(change)
        try:
            _rpc("groups.create", {"room_id": found["engine_id"], "name": found["name"][:200], "members": found["members"]})
        except Refused:
            # The engine room exists under the name the room had before a rename.
            if _engine_state(found["engine_id"]) is None:
                raise
        sent = _rpc("groups.send", {"room_id": found["engine_id"], "event_id": message_id, "payload": {"text": text, "thread_id": re.sub(r"[^A-Za-z0-9._:-]+", "-", found["thread"])}})
        _follow(room_id, found["engine_id"], int((sent.get("event") or {}).get("seq") or 0))
        return shown
    return _guard(work)


@router.post("/rooms/{room_id}/stop")
def stop_round(room_id: str) -> dict:
    """Stop the round that runs in this room."""
    def work():
        record, _revision, _profiles = _read()
        return {"cancelled": int(_rpc("groups.stop", {"room_id": _engine_id(record["rooms"][_key(record, room_id)]), "cancel_id": f"stop-{uuid.uuid4().hex[:8]}"}).get("cancelled") or 0)}
    return _guard(work)
