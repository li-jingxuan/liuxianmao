#!/usr/bin/env python3
"""Create a clean fnpack input tree with explicit, deployable image references."""
import os
import json
from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]


def data_directory():
    """Validate a literal POSIX bind source without consulting the build host FS."""
    value = os.environ.get("FNOS_DATA_DIR")
    if value is None:
        return None
    # Keep the value literal in YAML double quotes, Compose interpolation and
    # Docker's comma-delimited --mount argument. No normalization may hide '..'.
    if (not re.fullmatch(r"/[A-Za-z0-9_./-]+", value)
            or any(part in ("", ".", "..") for part in value.split("/")[1:])):
        raise SystemExit("FNOS_DATA_DIR must be a canonical absolute path using letters, digits, _, ., / and -.")
    path = Path(value)
    protected = (
        "/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc",
        "/run", "/sbin", "/sys", "/usr", "/System", "/Library",
        "/Applications", "/var/run", "/var/lib/docker", "/var/lib/containerd",
    )
    if len(path.parts) < 3 or value in (
        "/var/lib", "/var/local", "/var/tmp",
    ) or any(path == Path(root) or Path(root) in path.parents for root in protected):
        raise SystemExit("FNOS_DATA_DIR must be a dedicated data directory outside system directories.")
    return value


def image(name, default=None):
    value = os.environ.get(name, default or "")
    if not value or value.startswith("example.invalid/") or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_./:@-]+", value):
        raise SystemExit(f"Set {name} to a real image reference before staging a package.")
    # The release process must choose a tag or digest, never an implicit latest.
    if "@sha256:" not in value and ":" not in value.rsplit("/", 1)[-1]:
        raise SystemExit(f"{name} requires an explicit tag or digest.")
    return value


def main():
    data_dir = data_directory()
    master_env = os.environ.get("FNOS_MASTER_ENV")
    if master_env:
        if not re.fullmatch(r"/[A-Za-z0-9_./-]+", master_env) or any(part in ("", ".", "..") for part in master_env.split("/")[1:]):
            raise SystemExit("FNOS_MASTER_ENV must be a canonical absolute file path.")
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
    if data_dir is not None:
        content = content.replace("${TRIM_PKGVAR:?}", data_dir)
    compose.write_text(content, encoding="utf-8")
    (destination / "app" / "docker" / "api-image").write_text(references["api"] + "\n", encoding="utf-8")
    bootstrap = destination / "cmd" / "bootstrap"
    bootstrap.mkdir()
    shutil.copy2(ROOT / "app/docker/initialize.py", bootstrap / "initialize.py")
    (bootstrap / "api-image").write_text(references["api"] + "\n", encoding="utf-8")
    if master_env:
        (bootstrap / "master-env").write_text(master_env + "\n", encoding="utf-8")
        shutil.copy2(ROOT.parent / "configure.py", bootstrap / "render-config.py")
        for name in ("install", "config"):
            wizard = destination / "wizard" / name
            pages = json.loads(wizard.read_text())
            for page in pages:
                page["items"] = [{"type": "tips", "helpText": "本机统一配置模式：请维护 deploy/.env；方舟密钥、数据库凭据和管理密钥从主配置读取。此处不另行生成或填写密钥。"}]
            wizard.write_text(json.dumps(pages, ensure_ascii=False, indent=2) + "\n")
    if data_dir is not None:
        metadata = destination / "app" / "docker" / "data-dir"
        metadata.write_text(data_dir + "\n", encoding="utf-8")
        shutil.copy2(metadata, bootstrap / "data-dir")
    for script in (destination / "cmd").iterdir():
        script.chmod(0o755)
    if version:
        manifest = destination / "manifest"
        manifest.write_text(re.sub(r"(?m)^version=.*$", "version=" + version,
                                   manifest.read_text(encoding="utf-8")), encoding="utf-8")
    print(destination)


if __name__ == "__main__":
    main()
