from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = (ROOT / "migrations/0003_likes.sql").read_text(encoding="utf-8")
LIKE = (ROOT / "sql/set_like.sql").read_text(encoding="utf-8")
UNLIKE = (ROOT / "sql/unset_like.sql").read_text(encoding="utf-8")


class LikesTests(unittest.TestCase):
    def test_idempotent_like_unlike_and_post_isolation(self):
        with closing(sqlite3.connect(":memory:")) as db:
            db.executescript(SCHEMA)
            for _ in range(5):
                db.execute(LIKE, ("/posts/a/", "one"))
            db.execute(LIKE, ("/posts/a/", "two"))
            db.execute(LIKE, ("/posts/b/", "one"))
            self.assertEqual(db.execute("SELECT count(*) FROM post_likes WHERE path = ?", ("/posts/a/",)).fetchone(), (2,))
            for _ in range(5):
                db.execute(UNLIKE, ("/posts/a/", "one"))
            self.assertEqual(db.execute("SELECT count(*) FROM post_likes").fetchone(), (2,))

    def test_concurrent_duplicates_are_counted_once(self):
        with tempfile.TemporaryDirectory(dir=ROOT, prefix=".test-") as directory:
            filename = str(Path(directory) / "likes.sqlite")
            with closing(sqlite3.connect(filename)) as db:
                db.executescript(SCHEMA)
            shared = str(uuid.uuid4())
            def like(identifier):
                with closing(sqlite3.connect(filename, timeout=15)) as db:
                    db.execute(LIKE, ("/posts/a/", identifier))
                    db.commit()
            with ThreadPoolExecutor(max_workers=8) as executor:
                list(executor.map(like, [shared] * 20 + [str(uuid.uuid4()) for _ in range(20)]))
            with closing(sqlite3.connect(filename)) as db:
                self.assertEqual(db.execute("SELECT count(*) FROM post_likes").fetchone(), (21,))


if __name__ == "__main__":
    unittest.main()
