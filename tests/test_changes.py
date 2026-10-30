import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("changes", Path(__file__).resolve().parents[1] / "scripts/changes.py")
changes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(changes)


class ChangesTests(unittest.TestCase):
    def test_post_and_uploaded_images_only(self):
        self.assertTrue(changes.content_only(["docs/posts/new.md", "docs/img/uploads/a.png"]))

    def test_code_and_unknown_changes_keep_checks(self):
        for paths in [[], ["docs/posts/new.md", "publishing-worker/src/worker.mjs"], [".github/workflows/docs.yml"], ["scripts/changes.py"], ["analytics-worker/package-lock.json"], ["docs/posts/code.js"], ["docs/img/uploads/script.js"], ["docs/stylesheets/extra.css"]]:
            self.assertFalse(changes.content_only(paths), paths)


if __name__ == "__main__":
    unittest.main()
