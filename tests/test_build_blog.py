import importlib.util
from pathlib import Path
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_blog", ROOT / "scripts/build_blog.py")
build_blog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_blog)


class NavigationTests(unittest.TestCase):
    def test_navigation_contains_every_current_post(self):
        source = (ROOT / "zensical.toml").read_text(encoding="utf-8")
        names = ["posts/new-post.md", "posts/old-post.md"]
        config = tomllib.loads(build_blog.navigation_config(source, names))
        posts = next(group["P O S T"] for group in config["project"]["nav"] if "P O S T" in group)
        self.assertEqual(posts, ["posts/index.md", *names])

    def test_removed_posts_do_not_remain_in_navigation(self):
        source = (ROOT / "zensical.toml").read_text(encoding="utf-8")
        config = build_blog.navigation_config(source, ["posts/alive.md"])
        self.assertNotIn("posts/2025-12-8.md", config)
        self.assertIn("posts/alive.md", config)


if __name__ == "__main__":
    unittest.main()
