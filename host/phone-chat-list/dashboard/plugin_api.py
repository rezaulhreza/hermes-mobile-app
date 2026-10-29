"""The last message of each chat in the chat list of the phone: mounted at
``/api/plugins/phone-chat-list``.

Stock Hermes gives a session row the FIRST user message as its ``preview``. The chat list of
the phone shows the LAST message, of the user or of the assistant, as a messaging app does.

* ``POST /api/plugins/phone-chat-list/last`` with ``{"ids": ["<id>", ...]}``: the last message
  of each of these chats, ``{"last": {"<id>": {"role": "user" | "assistant", "text": "..."}}}``.
  One request for a page of the list, not one for each chat. A chat with no message has no
  entry. The ids go in the body: a page of 100 ids is 7 KB, too long for a safe address.
* ``GET /api/plugins/phone-chat-list/status``: how many stores the route reads.

The route reads the ``messages`` table of each profile's ``state.db``, read-only, with its own
SQL, and imports nothing of Hermes: an update of Hermes cannot rename what it uses. A filter
column that a store does not have is left out.

The routes are behind the dashboard's sign-in, like every other ``/api`` route.
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel


router = APIRouter()

# A page of the list is 100 rows. The cap keeps one request bounded.
_MAX_IDS = 200
# The phone shows one line. Enough text for that line after the Markdown is gone.
_TEXT_CHARS = 400

_NEEDED_COLUMNS = frozenset({"id", "session_id", "role", "content", "timestamp"})


def _hermes_root() -> Path:
    """The home of the default profile. A profile's process runs with ``HERMES_HOME=<root>/profiles/<name>``."""
    home = Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes").expanduser()
    return home.parent.parent if home.parent.name == "profiles" else home


def _stores() -> list[Path]:
    """The ``state.db`` of every profile of this host."""
    root = _hermes_root()
    stores = [root / "state.db", *sorted((root / "profiles").glob("*/state.db"))]
    return [path for path in stores if path.is_file()]


def _filters(columns: set[str]) -> str:
    """The messages the chat screen shows: words of the user or of the assistant. Not a tool
    call with no words, not hidden scaffolding, not a compaction summary, not a turn that the
    user took back (``active = 0`` and not ``compacted``)."""
    clauses = ["role IN ('user', 'assistant')", "content IS NOT NULL", "TRIM(content) <> ''"]
    if "display_kind" in columns:
        clauses.append("COALESCE(display_kind, '') <> 'hidden'")
    if "_compressed_summary" in columns:
        clauses.append("_compressed_summary = 0")
    if "active" in columns and "compacted" in columns:
        clauses.append("(active = 1 OR compacted = 1)")
    elif "active" in columns:
        clauses.append("active = 1")
    return " AND ".join(clauses)


def _last_in(path: Path, ids: list[str]) -> dict[str, dict[str, str]]:
    """The last message of each of ``ids`` that this store holds."""
    found: dict[str, dict[str, str]] = {}
    connection = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True, timeout=2)
    try:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(messages)")}
        if not _NEEDED_COLUMNS <= columns:
            return found
        marks = ",".join("?" * len(ids))
        here = [row[0] for row in connection.execute(f"SELECT DISTINCT session_id FROM messages WHERE session_id IN ({marks})", ids)]
        query = (f"SELECT role, SUBSTR(content, 1, {_TEXT_CHARS * 4}) FROM messages"
                 f" WHERE session_id = ? AND {_filters(columns)} ORDER BY timestamp DESC, id DESC LIMIT 1")
        for session_id in here:
            row = connection.execute(query, (session_id,)).fetchone()
            if row:
                found[session_id] = {"role": row[0], "text": " ".join(str(row[1]).split())[:_TEXT_CHARS]}
    finally:
        connection.close()
    return found


class LastBody(BaseModel):
    ids: list[str] = []


@router.post("/last")
def last_messages(body: LastBody) -> dict:
    wanted = list(dict.fromkeys(session_id.strip() for session_id in body.ids if session_id.strip()))
    if len(wanted) > _MAX_IDS:
        raise HTTPException(status_code=400, detail=f"At most {_MAX_IDS} ids")
    last: dict[str, dict[str, str]] = {}
    for path in _stores():
        missing = [session_id for session_id in wanted if session_id not in last]
        if not missing:
            break
        try:
            last.update(_last_in(path, missing))
        except sqlite3.Error:
            # A store that is locked or damaged leaves its chats with the first message.
            continue
    return {"last": last}


@router.get("/status")
def status() -> dict:
    return {"ok": True, "stores": len(_stores())}
