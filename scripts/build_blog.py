"""Generate the post listing before building the static blog."""
from pathlib import Path
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def post_files():
    return sorted((path for path in (ROOT / "docs/posts").glob("*.md") if path.stem != "index"), reverse=True)


def post_index():
    entries = []
    for path in post_files():
        title = next((line[2:].strip() for line in path.read_text(encoding="utf-8").splitlines() if line.startswith("# ")), path.stem)
        title = title.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")
        entries.append((path.stem, f"- [{title}]({path.name})"))
    return "# 게시물\n\n" + "\n".join(line for _, line in sorted(entries, reverse=True)) + "\n"


def navigation_config(source, names):
    start = source.index("    # BEGIN GENERATED POSTS")
    end = source.index("    # END GENERATED POSTS", start)
    entries = ["posts/index.md", *names]
    return source[:start] + "    # BEGIN GENERATED POSTS\n" + "".join("    " + json.dumps(name, ensure_ascii=False) + ",\n" for name in entries) + source[end:]


if __name__ == "__main__":
    (ROOT / "docs/posts/index.md").write_text(post_index(), encoding="utf-8")
    generated = ROOT / ".zensical-build.toml"
    generated.write_text(navigation_config((ROOT / "zensical.toml").read_text(encoding="utf-8"), [f"posts/{path.name}" for path in post_files()]), encoding="utf-8")
    try:
        subprocess.run([sys.executable, "-m", "zensical", "build", "--clean", "--config-file", str(generated)], cwd=ROOT, check=True)
    finally:
        generated.unlink(missing_ok=True)
