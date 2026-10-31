#!/usr/bin/env python3
"""Create a clean fnpack input tree with explicit, deployable image references."""
import os
from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]


def image(name, default=None):
    value = os.environ.get(name, default or "")
    if not value or value.startswith("example.invalid/") or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_./:@-]+", value):
        raise SystemExit(f"Set {name} to a real image reference before staging a package.")
    # The release process must choose a tag or digest, never an implicit latest.
    if "@sha256:" not in value and ":" not in value.rsplit("/", 1)[-1]:
        raise SystemExit(f"{name} requires an explicit tag or digest.")
    return value


def main():
    references = {
        "api": image("API_IMAGE"), "web": image("WEB_IMAGE"), "proxy": image("PROXY_IMAGE"),
        "postgres": image("POSTGRES_IMAGE", "postgres:17-alpine"),
    }
    version = os.environ.get("PACKAGE_VERSION", "")
    if version and not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?", version):
        raise SystemExit("PACKAGE_VERSION must be a semantic version.")
    destination = ROOT / "dist" / "pindou"
    # Only the generated package staging tree is replaced. No user-supplied rm path.
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    for name in ("app", "cmd", "config", "wizard"):
        target = destination / name
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(ROOT / name, target)
    for cache in destination.rglob("__pycache__"):
        shutil.rmtree(cache)
    for name in ("manifest", "ICON.PNG", "ICON_256.PNG"):
        shutil.copy2(ROOT / name, destination / name)
    compose = destination / "app" / "docker" / "docker-compose.yaml"
    content = compose.read_text(encoding="utf-8")
    for service in ("api", "web", "proxy"):
        content = content.replace(f"example.invalid/pindou/{service}:0.1.0-fnos", references[service])
    content = content.replace("image: postgres:17-alpine", "image: " + references["postgres"])
    compose.write_text(content, encoding="utf-8")
    (destination / "app" / "docker" / "api-image").write_text(references["api"] + "\n", encoding="utf-8")
    bootstrap = destination / "cmd" / "bootstrap"
    bootstrap.mkdir()
    shutil.copy2(ROOT / "app/docker/initialize.py", bootstrap / "initialize.py")
    (bootstrap / "api-image").write_text(references["api"] + "\n", encoding="utf-8")
    for script in (destination / "cmd").iterdir():
        script.chmod(0o755)
    if version:
        manifest = destination / "manifest"
        manifest.write_text(re.sub(r"(?m)^version=.*$", "version=" + version,
                                   manifest.read_text(encoding="utf-8")), encoding="utf-8")
    print(destination)


if __name__ == "__main__":
    main()
