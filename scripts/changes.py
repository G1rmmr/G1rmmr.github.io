"""Conservatively skip Worker checks only for posts and published image files."""
from pathlib import PurePosixPath
import os
import re
import subprocess


def content_only(paths):
    if not paths:
        return False
    for name in paths:
        path = PurePosixPath(name)
        post = name.startswith("docs/posts/") and path.suffix == ".md"
        image = name.startswith("docs/img/uploads/") and path.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp"}
        if not (post or image):
            return False
    return True


def detect():
    before, after = os.environ.get("BEFORE_SHA", ""), os.environ.get("AFTER_SHA", "")
    if os.environ.get("GITHUB_EVENT_NAME") != "push" or not all(re.fullmatch(r"[0-9a-f]{40}", sha) and sha != "0" * 40 for sha in [before, after]):
        return True
    if subprocess.run(["git", "cat-file", "-e", before], capture_output=True).returncode:
        subprocess.run(["git", "fetch", "--no-tags", "--depth=1", "origin", before], check=True)
    names = subprocess.check_output(["git", "diff", "--name-only", "--no-renames", "-z", before, after]).decode("utf-8").split("\0")
    return not content_only([name for name in names if name])


if __name__ == "__main__":
    checks = detect()
    value = f"worker_tests={'true' if checks else 'false'}\n"
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(value)
    print("Worker checks: " + ("required" if checks else "skipped (content only)"))
