"""CPU-only native session regressions. All databases live under a disposable directory."""
import asyncio
import copy
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "story"))
from writer_story import db, export, sessions, store


class SessionDetailsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="writer-B2-")
        self.conn = db.connect(Path(self.directory.name) / "world.db")
        self.world = store.create_world(self.conn, "Synthetic B2")
        self.wid = self.world["id"]

    def tearDown(self):
        self.conn.close()
        self.directory.cleanup()

    def test_legacy_schema_and_lazy_migration(self):
        session = store.start_session(self.conn, self.wid, "Legacy")
        before = store.list_sessions(self.conn, self.wid)
        self.conn.execute("DROP TABLE session_details")
        self.conn.execute("UPDATE meta SET value='1' WHERE key='schema_version'")
        self.conn.commit()
        self.conn.close()
        self.conn = db.connect(Path(self.directory.name) / "world.db")
        self.assertEqual(store.list_sessions(self.conn, self.wid), before)
        self.assertEqual(set(session), {"id", "world_id", "title", "started_at", "ended_at"})
        self.assertIsNone(sessions.session_view(self.conn, self.wid, session["id"])["details"])
        self.assertEqual(self.conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0], "2")
        count = len(store.list_sessions(self.conn, self.wid))
        self.assertEqual(len(sessions.list_details(self.conn, self.wid)["sessions"]), count)

    def test_plan_current_status_and_partial_patch(self):
        active = store.start_session(self.conn, self.wid)
        plan = sessions.create_plan(self.conn, self.wid, "Tomorrow", {"scheduled_at": 2_000_000_000, "place": "Table"})
        self.assertEqual(store.get_current_session(self.conn, self.wid)["id"], active["id"])
        self.assertFalse(plan["is_current"])
        sid = plan["session"]["id"]
        started = sessions.update_details(self.conn, self.wid, sid, {"status": "live", "hook": "Open door"})
        self.assertTrue(started["is_current"])
        self.assertEqual(started["details"]["place"], "Table")
        ended = sessions.update_details(self.conn, self.wid, sid, {"status": "played"})
        self.assertIsNone(store.get_current_session(self.conn, self.wid))
        self.assertIsNotNone(ended["session"]["ended_at"])
        self.assertIsNone(next(s for s in store.list_sessions(self.conn, self.wid) if s["id"] == active["id"])["ended_at"])

    def test_invalid_patch_is_atomic_and_world_scoped(self):
        made = sessions.create_plan(self.conn, self.wid)
        sid = made["session"]["id"]
        other = store.create_world(self.conn, "Other")
        person = store.create_entity(self.conn, other["id"], "character", "Foreign")
        for invalid in [{"length_min": True}, {"length_min": -1}, {"scheduled_at": float("nan")},
                        {"status": "no"}, {"hook": None}, {"unknown": 3},
                        {"attendance": [{"name": "X", "present": True, "entity_id": person["id"]}]}]:
            with self.assertRaises((ValueError, store.NotFound)):
                sessions.update_details(self.conn, self.wid, sid, {"place": "Must not save", **invalid})
            self.assertEqual(sessions.session_view(self.conn, self.wid, sid), made)
        with self.assertRaises(store.NotFound):
            sessions.session_view(self.conn, other["id"], sid)
        with self.assertRaises(ValueError):
            sessions.session_view(self.conn, self.wid, "")

    def test_replan_and_switch_live_keep_current_and_history_consistent(self):
        first = sessions.create_plan(self.conn, self.wid, "First")["session"]
        second = sessions.create_plan(self.conn, self.wid, "Second")["session"]
        sessions.update_details(self.conn, self.wid, first["id"], {"status": "live"})
        turn = store.append_turn(self.conn, self.wid, first["id"], "action", "user", text="Retain this turn")
        sessions.update_details(self.conn, self.wid, second["id"], {"status": "planned"})
        self.assertEqual(store.get_current_session(self.conn, self.wid)["id"], first["id"])
        sessions.update_details(self.conn, self.wid, first["id"], {"status": "planned"})
        self.assertIsNone(store.get_current_session(self.conn, self.wid))
        replanned = sessions.session_view(self.conn, self.wid, first["id"])
        self.assertEqual(replanned["session"]["started_at"], first["started_at"])
        self.assertIsNone(replanned["session"]["ended_at"])
        sessions.update_details(self.conn, self.wid, first["id"], {"status": "live"})
        sessions.update_details(self.conn, self.wid, second["id"], {"status": "live"})
        ended = sessions.session_view(self.conn, self.wid, first["id"])
        self.assertEqual(ended["details"]["status"], "played")
        self.assertIsNotNone(ended["session"]["ended_at"])
        self.assertEqual(store.get_current_session(self.conn, self.wid)["id"], second["id"])
        self.assertEqual(store.list_turns(self.conn, first["id"])[0]["id"], turn["id"])

    def test_recap_ready_is_local_atomic_and_private(self):
        plan = sessions.create_plan(self.conn, self.wid, "Recap", {"dm_notes": "PRIVATE DM"})
        sid = plan["session"]["id"]
        self.assertNotIn("dm_notes", plan["details"])
        with self.assertRaises(ValueError):
            sessions.update_details(self.conn, self.wid, sid, {"recap_posted": True})
        sessions.update_details(self.conn, self.wid, sid, {"recap": "We found a key."})
        with self.assertRaises(ValueError):
            sessions.recap_markdown(self.conn, self.wid, sid)
        self.assertIn("Draft", sessions.recap_markdown(self.conn, self.wid, sid, True))
        ready = sessions.update_details(self.conn, self.wid, sid, {"recap_posted": True})
        self.assertEqual(ready["details"]["status"], "played")
        self.assertTrue(ready["details"]["recap_posted"])
        self.assertNotIn("PRIVATE", sessions.recap_markdown(self.conn, self.wid, sid))
        self.assertEqual(sessions.session_view(self.conn, self.wid, sid, True)["details"]["dm_notes"], "PRIVATE DM")
        changed = sessions.update_details(self.conn, self.wid, sid, {"recap": "Edited recap"})
        self.assertFalse(changed["details"]["recap_posted"])
        self.assertNotIn("PRIVATE", export.session_to_markdown(self.conn, self.wid, sid))
        self.assertNotIn("PRIVATE", export.world_bible_markdown(self.conn, self.wid))

    def test_backup_old_new_and_attendance_remap(self):
        person = store.create_entity(self.conn, self.wid, "character", "Synthetic character")
        made = sessions.create_plan(self.conn, self.wid, "Archive", {"recap": "Shared", "dm_notes": "Private archive",
            "attendance": [{"name": "Player", "entity_id": person["id"], "present": True}]})
        sessions.update_details(self.conn, self.wid, made["session"]["id"], {"recap_posted": True})
        backup = export.export_world_json(self.conn, self.wid)
        self.assertEqual(len(backup["session_details"]), 1)
        imported = export.import_world_json(self.conn, backup)
        row = sessions.list_details(self.conn, imported["id"], include_dm_notes=True)["sessions"][0]
        self.assertNotEqual(row["session"]["id"], made["session"]["id"])
        self.assertNotEqual(row["details"]["attendance"][0]["entity_id"], person["id"])
        self.assertEqual(row["details"]["dm_notes"], "Private archive")
        self.assertTrue(row["details"]["recap_posted"])
        self.assertFalse(row["is_current"])
        old = copy.deepcopy(backup)
        old.pop("session_details")
        imported_old = export.import_world_json(self.conn, old)
        self.assertIsNone(sessions.list_details(self.conn, imported_old["id"])["sessions"][0]["details"])
        bad = copy.deepcopy(backup)
        bad["session_details"][0]["length_min"] = -1
        count = len(store.list_worlds(self.conn))
        with self.assertRaises(ValueError):
            export.import_world_json(self.conn, bad)
        self.assertEqual(len(store.list_worlds(self.conn)), count)

    def test_native_api_and_agent_catalog_without_network(self):
        from fastapi.testclient import TestClient
        from writer_story.api import create_app
        class NoHub:
            def __getattr__(self, name):
                raise AssertionError(f"No hub calls expected: {name}")
        app = create_app(Path(self.directory.name) / "api", hub=NoHub())
        try:
            with patch("socket.create_connection", side_effect=AssertionError("No network in session QA")):
                client = TestClient(app, base_url="http://127.0.0.1:8816", headers={"X-Hoard-Client": "ui"})
                world = client.post("/api/worlds", json={"name": "ASGI B2"}).json()
                wid = world["id"]
                catalog = client.get("/api/agent/tools").json()
                names = {tool["name"] for tool in catalog["tools"]}
                self.assertTrue({"wh_story_session_list", "wh_story_session_create", "wh_story_session_update"} <= names)
                person = client.post("/api/agent/entity_upsert", json={"world": wid, "kind": "character", "name": "Retired synthetic", "status": "retired"})
                self.assertEqual(person.status_code, 200, person.text)
                self.assertEqual(person.json()["status"], "retired")
                context = client.post("/api/agent/world_context", json={"world": wid, "scene": {"present": [person.json()["ref"]]}})
                self.assertEqual(context.status_code, 200, context.text)
                self.assertIn("retired", context.text)
                archive = client.get(f"/api/worlds/{wid}/export.json").json()
                copied = client.post("/api/worlds/import", json=archive)
                self.assertEqual(copied.status_code, 200, copied.text)
                restored = client.get(f"/api/worlds/{copied.json()['id']}/entities").json()
                self.assertEqual(restored[0]["status"], "retired")
                made = client.post("/api/agent/wh_story_session_create", json={"world": wid, "details": {"dm_notes": "SECRET"}})
                self.assertEqual(made.status_code, 200, made.text)
                sid = made.json()["session"]["id"]
                self.assertNotIn("dm_notes", made.json()["details"])
                self.assertEqual(client.get(f"/api/worlds/{wid}/session-details").json()["sessions"][0]["details"]["dm_notes"], "SECRET")
                self.assertNotIn("SECRET", client.post("/api/agent/wh_story_session_list", json={"world": wid}).text)
                self.assertIn("SECRET", client.post("/api/agent/wh_story_session_list", json={"world": wid, "include_dm_notes": True}).text)
                changed = client.post("/api/agent/wh_story_session_update", json={"world": wid, "session": sid,
                    "patch": {"recap": "Public recap", "recap_posted": True}})
                self.assertEqual(changed.status_code, 200, changed.text)
                recap = client.get(f"/api/worlds/{wid}/sessions/{sid}/recap.md")
                self.assertEqual(recap.status_code, 200)
                self.assertNotIn("SECRET", recap.text)
                self.assertEqual(client.patch(f"/api/worlds/{wid}/sessions/{sid}/details", json={"length_min": -1}).status_code, 400)
                self.assertEqual(len(client.get(f"/api/worlds/{wid}/sessions").json()), 1)
        finally:
            asyncio.run(app.state.link.aclose())
            app.state.conn.close()

if __name__ == "__main__":
    unittest.main(verbosity=2)
