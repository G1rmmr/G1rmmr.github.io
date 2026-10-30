"""Exercise the exact D1 schema and recording statement with SQLite locally."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest
import uuid


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = (ROOT / "migrations/0001_views.sql").read_text(encoding="utf-8")
RECORD = (ROOT / "sql/record_view.sql").read_text(encoding="utf-8")


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript(SCHEMA)

    def tearDown(self):
        self.db.close()

    def record(self, path="/posts/2025-12-8/", visit_id=None):
        visit_id = visit_id or str(uuid.uuid4())
        self.db.execute(RECORD, (visit_id, path))
        self.db.commit()
        return visit_id

    def test_retries_increment_once_and_new_visits_increment(self):
        visit_id = self.record()
        for _ in range(10):
            self.record(visit_id=visit_id)
        self.record()
        self.assertEqual(self.db.execute("SELECT views FROM post_views").fetchone(), (2,))
        self.assertEqual(self.db.execute("SELECT count(*) FROM view_requests").fetchone(), (2,))

    def test_same_request_cannot_be_replayed_against_another_path(self):
        visit_id = self.record()
        self.record("/posts/2024-12-12/", visit_id)
        self.assertEqual(self.db.execute("SELECT count(*), sum(views) FROM post_views").fetchone(), (1, 1))

    def test_separate_posts_and_server_timestamp(self):
        before = int(time.time())
        self.record("/posts/2025-12-8/")
        self.record("/posts/2024-12-12/")
        rows = self.db.execute("SELECT views, first_viewed_at, last_viewed_at FROM post_views").fetchall()
        self.assertEqual(len(rows), 2)
        for count, first, last in rows:
            self.assertEqual(count, 1)
            self.assertLessEqual(before, first)
            self.assertLessEqual(first, int(time.time()))
            self.assertEqual(first, last)

    def test_counter_failure_rolls_back_request_and_retry_remains_possible(self):
        self.db.executescript("""
            CREATE TRIGGER reject_counter BEFORE INSERT ON post_views
            BEGIN SELECT RAISE(ABORT, 'test failure'); END;
        """)
        visit_id = str(uuid.uuid4())
        with self.assertRaises(sqlite3.IntegrityError):
            self.record(visit_id=visit_id)
        self.assertEqual(self.db.execute("SELECT count(*) FROM view_requests").fetchone(), (0,))
        self.db.execute("DROP TRIGGER reject_counter")
        self.record(visit_id=visit_id)
        self.assertEqual(self.db.execute("SELECT views FROM post_views").fetchone(), (1,))

    def test_retention_removes_expired_ids_but_preserves_counts(self):
        now = int(time.time())
        old_id, boundary_id = str(uuid.uuid4()), str(uuid.uuid4())
        self.db.execute("INSERT INTO view_requests VALUES (?, ?, ?)", (old_id, "/posts/old/", now - 604801))
        self.db.execute("INSERT INTO view_requests VALUES (?, ?, ?)", (boundary_id, "/posts/boundary/", now - 604800))
        self.db.execute("INSERT INTO view_requests VALUES (?, ?, ?)", (str(uuid.uuid4()), "/posts/new/", now))
        self.assertIsNone(self.db.execute("SELECT visit_id FROM view_requests WHERE visit_id = ?", (old_id,)).fetchone())
        self.assertIsNotNone(self.db.execute("SELECT visit_id FROM view_requests WHERE visit_id = ?", (boundary_id,)).fetchone())
        self.assertEqual(self.db.execute("SELECT sum(views) FROM post_views").fetchone(), (3,))

    def test_concurrent_duplicate_and_distinct_requests_do_not_lose_updates(self):
        with tempfile.TemporaryDirectory(dir=ROOT, prefix=".test-") as directory:
            filename = str(Path(directory) / "views.sqlite")
            with closing(sqlite3.connect(filename)) as db:
                db.executescript(SCHEMA)
            shared = str(uuid.uuid4())
            requests = [shared] * 20 + [str(uuid.uuid4()) for _ in range(20)]

            def record(visit_id):
                with closing(sqlite3.connect(filename, timeout=15)) as db:
                    db.execute(RECORD, (visit_id, "/posts/concurrent/"))
                    db.commit()

            with ThreadPoolExecutor(max_workers=8) as executor:
                list(executor.map(record, requests))
            with closing(sqlite3.connect(filename)) as db:
                self.assertEqual(db.execute("SELECT views FROM post_views").fetchone(), (21,))
                self.assertEqual(db.execute("SELECT count(*) FROM view_requests").fetchone(), (21,))


if __name__ == "__main__":
    unittest.main()
