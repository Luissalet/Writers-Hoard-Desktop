"""Session plans, attendance and author-written recaps, without changing legacy rows."""
from __future__ import annotations

import math
from typing import Any

from . import db, store

TEXT_FIELDS = ("timezone", "place", "hook", "dm_notes", "recap")
FIELDS = (*TEXT_FIELDS, "scheduled_at", "length_min", "status", "recap_posted", "attendance")
DEFAULTS = {**dict.fromkeys(TEXT_FIELDS, ""), "scheduled_at": None, "length_min": None,
            "status": "planned", "recap_posted": False, "attendance": []}


def validate_patch(patch: dict, conn=None, world_id: str | None = None) -> dict:
    if not isinstance(patch, dict) or set(patch) - set(FIELDS):
        raise ValueError("unknown session detail fields")
    result = dict(patch)
    for key in TEXT_FIELDS:
        if key in result and not isinstance(result[key], str):
            raise ValueError(f"{key} must be text")
    if "scheduled_at" in result:
        value = result["scheduled_at"]
        if value is not None and (type(value) not in (int, float) or not math.isfinite(value) or not -62135596800 <= value <= 253402300799):
            raise ValueError("scheduled_at must be a finite Unix timestamp in years 1–9999, or null")
    if "length_min" in result and result["length_min"] is not None:
        if type(result["length_min"]) is not int or result["length_min"] < 0:
            raise ValueError("length_min must be a nonnegative whole number or null")
    if "status" in result and result["status"] not in ("planned", "live", "played"):
        raise ValueError("status must be planned, live or played")
    if "recap_posted" in result and type(result["recap_posted"]) is not bool:
        raise ValueError("recap_posted must be boolean")
    if "attendance" in result:
        if not isinstance(result["attendance"], list):
            raise ValueError("attendance must be a list")
        attendees = []
        for entry in result["attendance"]:
            if not isinstance(entry, dict) or set(entry) - {"name", "entity_id", "present"}:
                raise ValueError("invalid attendance entry")
            if not isinstance(entry.get("name"), str) or not entry["name"].strip() or type(entry.get("present")) is not bool:
                raise ValueError("attendance needs a name and present boolean")
            clean = {"name": entry["name"].strip(), "present": entry["present"]}
            entity_id = entry.get("entity_id")
            if entity_id is not None:
                if not isinstance(entity_id, str) or not entity_id:
                    raise ValueError("entity_id must be a character id")
                if conn is not None:
                    entity = store.get_entity(conn, world_id, entity_id)
                    if entity["kind"] != "character":
                        raise ValueError("attendance entity must be a character of this world")
                    entity_id = entity["id"]
                clean["entity_id"] = entity_id
            attendees.append(clean)
        result["attendance"] = attendees
    return result


def read_details(conn, session_id: str) -> dict | None:
    row = conn.execute("SELECT * FROM session_details WHERE session_id = ?", (session_id,)).fetchone()
    if not row:
        return None
    result = dict(row)
    result["attendance"] = db.loads(result.pop("attendance_json"), [])
    result["recap_posted"] = bool(result["recap_posted"])
    return result


def session_view(conn, world_id: str, session_ref: str, include_dm_notes=False) -> dict:
    # An explicit ref is essential: the old resolver creates a session for None.
    if not isinstance(session_ref, str) or not session_ref.strip():
        raise ValueError("session is required")
    sid = store.resolve_session_id(conn, world_id, session_ref)
    session = dict(conn.execute("SELECT * FROM sessions WHERE id = ?", (sid,)).fetchone())
    details = read_details(conn, sid)
    if details is not None and not include_dm_notes:
        details.pop("dm_notes", None)
    current = store.get_current_session(conn, world_id)
    return {"session": session, "details": details, "is_current": bool(current and current["id"] == sid)}


def list_details(conn, world_id: str, session: str | None = None, include_dm_notes=False) -> dict:
    rows = [session_view(conn, world_id, session, include_dm_notes)] if session is not None else [
        session_view(conn, world_id, row["id"], include_dm_notes) for row in store.list_sessions(conn, world_id)]
    rows.sort(key=lambda row: ((row["details"] or {}).get("scheduled_at") is None,
                              (row["details"] or {}).get("scheduled_at") or 0, row["session"]["started_at"]))
    return {"sessions": rows}


def write_details(conn, sid: str, value: dict) -> None:
    conn.execute("""INSERT INTO session_details
        (session_id, scheduled_at, timezone, length_min, place, hook, dm_notes, status, recap,
         recap_posted, attendance_json, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(session_id) DO UPDATE SET scheduled_at=excluded.scheduled_at, timezone=excluded.timezone,
        length_min=excluded.length_min, place=excluded.place, hook=excluded.hook, dm_notes=excluded.dm_notes,
        status=excluded.status, recap=excluded.recap, recap_posted=excluded.recap_posted,
        attendance_json=excluded.attendance_json, updated_at=excluded.updated_at""",
        (sid, value["scheduled_at"], value["timezone"], value["length_min"], value["place"], value["hook"],
         value["dm_notes"], value["status"], value["recap"], int(value["recap_posted"]),
         db.dumps(value["attendance"]), db.now()))


def merged_details(previous: dict | None, patch: dict) -> dict:
    result = {**DEFAULTS, **(previous or {}), **patch}
    if "recap" in patch and previous and patch["recap"] != previous["recap"] and "recap_posted" not in patch:
        result["recap_posted"] = False
    if result["recap_posted"]:
        if not result["recap"].strip():
            raise ValueError("a recap is required before marking it ready to share")
        # Only an explicit ready action marks the session played; editing its
        # unrelated metadata does not silently override a later status choice.
        if patch.get("recap_posted"):
            result["status"] = "played"
    return result


def update_details(conn, world_id: str, session: str, patch: dict, include_dm_notes=False) -> dict:
    original = session_view(conn, world_id, session, True)
    sid = original["session"]["id"]
    clean = validate_patch(patch, conn, world_id)
    previous = original["details"]
    if previous is None and original["is_current"]:
        previous = {**DEFAULTS, "status": "live"}
    next_value = merged_details(previous, clean)
    with conn:
        write_details(conn, sid, next_value)
        if next_value["status"] == "live" and clean.get("status") == "live":
            current = store.get_current_session(conn, world_id)
            if current and current["id"] != sid:
                # Only sessions explicitly managed by this preparation flow
                # are completed. Legacy sessions without details stay intact.
                changed = conn.execute("UPDATE session_details SET status='played', updated_at=? WHERE session_id=? AND status='live'",
                                       (db.now(), current["id"]))
                if changed.rowcount:
                    conn.execute("UPDATE sessions SET ended_at=COALESCE(ended_at, ?) WHERE id=?", (db.now(), current["id"]))
            conn.execute("UPDATE worlds SET current_session_id=?, updated_at=? WHERE id=?", (sid, db.now(), world_id))
        elif clean.get("status") == "played" or clean.get("recap_posted"):
            conn.execute("UPDATE sessions SET ended_at=COALESCE(ended_at, ?) WHERE id=?", (db.now(), sid))
            conn.execute("UPDATE worlds SET current_session_id=NULL, updated_at=? WHERE id=? AND current_session_id=?",
                         (db.now(), world_id, sid))
        elif clean.get("status") == "planned":
            conn.execute("UPDATE worlds SET current_session_id=NULL, updated_at=? WHERE id=? AND current_session_id=?",
                         (db.now(), world_id, sid))
    return session_view(conn, world_id, sid, include_dm_notes)


def create_plan(conn, world_id: str, title: str = "", details: dict | None = None, include_dm_notes=False) -> dict:
    if not isinstance(title, str):
        raise ValueError("title must be text")
    clean = validate_patch(details if details is not None else {}, conn, world_id)
    if clean.get("status", "planned") != "planned" or clean.get("recap_posted"):
        raise ValueError("a new session plan starts planned; start it explicitly afterwards")
    value = merged_details(None, clean)
    world = store.get_world(conn, world_id)
    if not title.strip():
        count = len(store.list_sessions(conn, world_id)) + 1
        title = f"{'Sesión' if world['language'] == 'es' else 'Session'} {count}"
    with conn:
        session = store.insert_session(conn, world_id, title.strip(), db.now(), commit=False)
        write_details(conn, session["id"], value)
    return session_view(conn, world_id, session["id"], include_dm_notes)


def recap_markdown(conn, world_id: str, session: str, draft=False) -> str:
    view = session_view(conn, world_id, session)
    details = view["details"]
    if not details or not details["recap"].strip():
        raise ValueError("this session has no recap")
    if not details["recap_posted"] and not draft:
        raise ValueError("the recap is a draft; mark it ready or request draft=true explicitly")
    label = "\n\n_Borrador / Draft_" if not details["recap_posted"] else ""
    return f"# {view['session']['title']}{label}\n\n{details['recap'].strip()}\n"
