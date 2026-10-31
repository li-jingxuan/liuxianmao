#!/usr/bin/env python3
"""Offline checks: package syntax, config preservation and Compose rendering.

No Docker daemon, provider request, image pull, real .env file, or NAS is used.
"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import struct
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def load_initializer():
    spec = importlib.util.spec_from_file_location("fnos_initialize", ROOT / "app/docker/initialize.py")
    module = importlib.util.module_from_spec(spec)
    # Execute in memory without creating __pycache__ in the package payload.
    exec(compile(Path(spec.origin).read_bytes(), spec.origin, "exec"), module.__dict__)
    return module


def expect_error(action):
    try:
        action()
    except ValueError:
        return
    raise AssertionError("Unsafe configuration was accepted")


def main():
    for relative in ("config/resource", "config/privilege", "app/ui/config",
                     "wizard/install", "wizard/config", "wizard/upgrade", "wizard/uninstall"):
        json.loads((ROOT / relative).read_text(encoding="utf-8"))
    for script in list((ROOT / "cmd").iterdir()) + list((ROOT / "proxy").glob("*.sh")) + list((ROOT / "scripts").glob("*.sh")):
        subprocess.run(["sh", "-n", str(script)], check=True)
        assert script.stat().st_mode & stat.S_IXUSR, f"Script is not executable: {script.name}"
    for script in ROOT.rglob("*.py"):
        if "dist" not in script.relative_to(ROOT).parts:
            compile(script.read_bytes(), str(script), "exec")
    for size, filename in ((64, "ICON.PNG"), (256, "ICON_256.PNG")):
        image = (ROOT / filename).read_bytes()
        assert image.startswith(b"\x89PNG\r\n\x1a\n")
        assert struct.unpack(">II", image[16:24]) == (size, size)
        assert len(image) < 1024 * 1024
        assert image == (ROOT / f"app/ui/images/icon_{size}.png").read_bytes()
        assert image == (ROOT.parents[1] / f"apps/web/src/assets/app_icon_{size}_{size}.png").read_bytes()
    ui = json.loads((ROOT / "app/ui/config").read_text())[".url"]["pindou.main"]
    assert ui["gatewayPrefix"] == "/app/pindou" and ui["gatewaySocket"] == "pindou.sock"
    assert "port" not in ui
    resource = json.loads((ROOT / "config/resource").read_text())
    project = resource["docker-project"]["projects"][0]["name"]
    assert project == "pindou-fnos", "fnOS must not adopt the ordinary pindou Compose project"
    assert f"label=com.docker.compose.project={project} " in (ROOT / "cmd/main").read_text()
    initializer = load_initializer()
    with tempfile.TemporaryDirectory(prefix="pindou-fnos-check-") as temporary:
        base = Path(temporary)
        config, data = base / "etc", base / "var"
        run = lambda key="": initializer.initialize(config, data, key, owner=None)
        expect_error(run)
        assert not (config / "api.env").exists()
        run("offline-dummy-key")
        before = {name: (config / name).read_bytes() for name in ("postgres.env", "api.env")}
        run()
        assert before == {name: (config / name).read_bytes() for name in before}
        api = initializer.read_env(config / "api.env")
        first_secrets = {key: api[key] for key in ("KEY_ISSUER_API_KEY", "API_KEY_HASH_PEPPER")}
        run("offline-updated-key")
        updated = initializer.read_env(config / "api.env")
        assert updated["ARK_DOUBAO_API_KEY"] == "offline-updated-key"
        assert all(updated[key] == value for key, value in first_secrets.items())
        assert (config / "postgres.env").read_bytes() == before["postgres.env"]
        assert all(stat.S_IMODE((config / name).stat().st_mode) == 0o600 for name in before)
        # Recover empty placeholders left by an interrupted older package install.
        placeholder = base / "placeholder"
        placeholder_data = base / "placeholder-data"
        (placeholder / "api.env").parent.mkdir()
        (placeholder / "api.env").write_text("")
        (placeholder / "postgres.env").write_text("")
        initializer.initialize(placeholder, placeholder_data, "offline-placeholder-key", owner=None)
        assert initializer.read_env(placeholder / "api.env")["ARK_DOUBAO_API_KEY"] == "offline-placeholder-key"
        # Partial restores and a different PG major version must not generate new
        # credentials or alter either surviving configuration or database files.
        for case, version in (("partial", None), ("wrong-major", "16\n")):
            damaged_data, damaged_config = base / case, base / (case + "-etc")
            pgdata = damaged_data / "postgres"
            pgdata.mkdir(parents=True)
            marker = pgdata / "restore-marker"
            marker.write_bytes(b"keep restored data")
            if version:
                (pgdata / "PG_VERSION").write_text(version)
            for keep_postgres in (False, True):
                damaged_config.mkdir(exist_ok=True)
                if keep_postgres:
                    initializer.write_env(damaged_config / "postgres.env", {"POSTGRES_DB": "pindou", "POSTGRES_USER": "pindou", "POSTGRES_PASSWORD": "offline-surviving-password"})
                before_damage = {path.name: path.read_bytes() for path in damaged_config.iterdir()}
                expect_error(lambda: initializer.initialize(damaged_config, damaged_data, "offline-recovery-key", owner=None))
                assert {path.name: path.read_bytes() for path in damaged_config.iterdir()} == before_damage
                assert marker.read_bytes() == b"keep restored data"
                assert not (damaged_config / "api.env").exists()
        expect_error(lambda: run("contains\na-newline"))
        postgres = initializer.read_env(config / "postgres.env")
        # Reserved URL characters, Compose interpolation markers and quote escaping.
        postgres["POSTGRES_PASSWORD"] = "dummy$pa:ss/@%#'\\word"
        initializer.write_env(config / "postgres.env", postgres)
        updated["DATABASE_URL"] = initializer.database_url(postgres)
        initializer.write_env(config / "api.env", updated)
        assert initializer.read_env(config / "postgres.env") == postgres
        assert "%24" in updated["DATABASE_URL"] and "%40" in updated["DATABASE_URL"]
        run()
        assert initializer.read_env(config / "api.env") == updated
        # A surviving database must never get a freshly generated pepper.
        (data / "postgres" / "PG_VERSION").write_text("17\n")
        backup = (config / "api.env").read_bytes()
        (config / "api.env").unlink()
        expect_error(run)
        (config / "api.env").write_bytes(backup)
        # An existing API file with missing DB config must fail closed as well.
        pg_backup = (config / "postgres.env").read_bytes()
        (config / "postgres.env").unlink()
        expect_error(run)
        (config / "postgres.env").write_bytes(pg_backup)
        if shutil.which("docker"):
            environment = dict(os.environ, TRIM_APPDEST=str(base / "target"),
                               TRIM_PKGETC=str(config), TRIM_PKGVAR=str(data))
            rendered = subprocess.run(
                ["docker", "compose", "-f", str(ROOT / "app/docker/docker-compose.yaml"),
                 "config", "--format", "json"],
                env=environment, capture_output=True, text=True,
            )
            if rendered.returncode:
                # Never echo the rendered file or errors containing its env values.
                raise AssertionError("Docker Compose config validation failed")
            services = json.loads(rendered.stdout)["services"]
            assert set(services) == {"proxy", "web", "api", "postgres"}
            assert all(not service.get("ports") for service in services.values())
            # config output escapes $ a second time so its result is itself reusable Compose.
            assert services["postgres"]["environment"]["POSTGRES_PASSWORD"] == postgres["POSTGRES_PASSWORD"].replace("$", "$$")
            assert services["api"]["environment"]["DATABASE_URL"] == updated["DATABASE_URL"]
            assert "POSTGRES_PASSWORD" not in services["api"]["environment"]
            assert "ARK_DOUBAO_API_KEY" not in services["postgres"]["environment"]
            assert all("healthcheck" in service for service in services.values())
            assert "pg_isready -h 127.0.0.1" in services["postgres"]["healthcheck"]["test"][1]
            assert all(0 < float(service["cpus"]) <= 1 for service in services.values())
            assert all(0 < int(service["mem_limit"]) <= 1024 ** 3 for service in services.values())
            print("PASS: Docker Compose rendering, env quoting, four services, no host ports.")
        else:
            print("SKIP: Docker Compose rendering (docker not installed).")
        # Verify lifecycle ownership and 0/3 status contracts against a local fake CLI.
        fake = base / "bin"
        fake.mkdir()
        docker = fake / "docker"
        docker.write_text("#!/bin/sh\ncase \"$1\" in\nps) echo fixture;;\ninspect) printf '%s\\n' \"${FIXTURE_STATE:-running healthy}\";;\n*) exit 99;;\nesac\n")
        docker.chmod(0o755)
        env = dict(os.environ, PATH=str(fake) + os.pathsep + os.environ.get("PATH", ""))
        for operation in ("start", "stop", "status"):
            result = subprocess.run([str(ROOT / "cmd/main"), operation], env=env)
            assert result.returncode == 0
        env["FIXTURE_STATE"] = "running unhealthy"
        assert subprocess.run([str(ROOT / "cmd/main"), "status"], env=env).returncode == 3
    print("PASS: JSON, shell/Python syntax, PNG sizes, first/repeated config, stable secrets, restore guards, lifecycle status.")
    print("This check does not run image builds, nginx -t, fnpack build, live fnOS or provider calls.")


if __name__ == "__main__":
    main()
