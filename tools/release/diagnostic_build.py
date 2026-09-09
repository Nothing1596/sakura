"""Create a version-specific source/resource mapping without user data."""

import hashlib
import json
import subprocess
from pathlib import Path


def write_mapping(repo: Path, stage: Path, target: str, resources: dict) -> dict:
    commit = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=repo, text=True
    ).strip()
    sources = []
    for base in ("app", "desktop/frontend", "desktop/src-tauri/src", "plugins/builtin"):
        for path in sorted((repo / base).rglob("*")):
            if not path.is_file() or path.suffix not in {
                ".py",
                ".rs",
                ".js",
                ".html",
                ".css",
                ".json",
                ".yaml",
            }:
                continue
            if any(
                part in {"node_modules", "__pycache__", "tests"}
                for part in path.relative_to(repo).parts
            ):
                continue
            sources.append(
                {
                    "file": path.relative_to(repo).as_posix(),
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                }
            )
    dirty = (
        subprocess.run(
            [
                "git",
                "diff",
                "--quiet",
                "HEAD",
                "--",
                "app",
                "desktop/frontend",
                "desktop/src-tauri",
                "plugins/builtin",
            ],
            cwd=repo,
        ).returncode
        != 0
    )
    mapping = {
        "schemaVersion": 2,
        "environment": "development" if dirty else "production",
        "gitCommit": commit,
        "target": target,
        "version": resources["version"],
        "sources": sources,
        "resources": resources["files"],
    }
    digest = hashlib.sha256(
        json.dumps(mapping, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    mapping["buildId"] = f"{commit[:16]}-{target}-{digest[:16]}"
    (stage / "diagnostic-build.json").write_text(
        json.dumps(mapping, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (stage / "diagnostic-build-id.txt").write_text(
        mapping["buildId"] + "\n", encoding="utf-8"
    )
    return mapping
