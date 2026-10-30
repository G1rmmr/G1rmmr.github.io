"""Generate the post listing before building the static blog."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def post_index():
    entries = []
    for path in (ROOT / "docs/posts").glob("*.md"):
        if path.stem == "index":
            continue
        title = next((line[2:].strip() for line in path.read_text(encoding="utf-8").splitlines() if line.startswith("# ")), path.stem)
        title = title.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")
        entries.append((path.stem, f"- [{title}]({path.name})"))
    return "# 게시물\n\n" + "\n".join(line for _, line in sorted(entries, reverse=True)) + "\n"


if __name__ == "__main__":
    (ROOT / "docs/posts/index.md").write_text(post_index(), encoding="utf-8")
    subprocess.run([sys.executable, "-m", "zensical", "build", "--clean"], cwd=ROOT, check=True)
