#!/usr/bin/env python3
"""Offline storage staging/lifecycle tests; uses only the Python standard library."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("fnos_stage", ROOT / "scripts/stage.py")
stage = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(stage)
IMAGES = {name + "_IMAGE": "registry.test/pindou/" + name.lower() + ":storage-test"
          for name in ("API", "WEB", "PROXY")}


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "source"
        self.source.mkdir()
        # Exercise actual package inputs, including the production Compose file.
        for name in ("app", "cmd", "config", "wizard"):
            shutil.copytree(ROOT / name, self.source / name)
        for name in ("manifest", "ICON.PNG", "ICON_256.PNG"):
            shutil.copy2(ROOT / name, self.source / name)
        shutil.copy2(ROOT.parent / "configure.py", self.source.parent / "configure.py")
        self.staged = self.source / "dist/pindou"

    def stage_package(self, data_dir=None):
        environment = dict(IMAGES)
        if data_dir is not None:
            environment["FNOS_DATA_DIR"] = data_dir
        with patch.dict(os.environ, environment, clear=True), patch.object(stage, "ROOT", self.source):
            with contextlib.redirect_stdout(io.StringIO()):
                stage.main()

    def configure(self, fallback=None):
        commands = self.root / "bin"
        commands.mkdir(exist_ok=True)
        docker = commands / "docker"
        # Capture arguments without needing Docker, networking or host Python in
        # the lifecycle script. This executable belongs only to the test fixture.
        docker.write_text("#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$DOCKER_CAPTURE\"\n", encoding="utf-8")
        docker.chmod(0o755)
        capture = self.root / "docker-arguments"
        environment = {
            "PATH": str(commands) + os.pathsep + os.environ["PATH"],
            "TRIM_APPDEST": str(self.root / "not-installed-yet"),
            "TRIM_PKGETC": str(self.root / "config"),
            "DOCKER_CAPTURE": str(capture),
        }
        if fallback is not None:
            environment["TRIM_PKGVAR"] = str(fallback)
        result = subprocess.run(["sh", str(self.staged / "cmd/configure")],
                                env=environment, text=True, capture_output=True)
        arguments = capture.read_text().splitlines() if capture.exists() else []
        return result, arguments

    def test_custom_path_renders_all_mounts_and_preinstall_metadata(self):
        data = str(self.root / "custom/data")
        self.stage_package(data)
        compose = (self.staged / "app/docker/docker-compose.yaml").read_text()
        self.assertNotIn("${TRIM_PKGVAR:?}", compose)
        for name in ("postgres", "api-images", "api-logs", "image-deliveries"):
            self.assertIn('"' + data + "/" + name + ":", compose)
        self.assertIn("${TRIM_PKGETC:?}", compose)
        self.assertIn("${TRIM_APPDEST:?}", compose)
        for location in ("app/docker/data-dir", "cmd/bootstrap/data-dir"):
            self.assertEqual((self.staged / location).read_text(), data + "\n")
        # Installation must work before app/ has been extracted; bootstrap wins
        # over both TRIM_PKGVAR and conflicting app payload metadata.
        (self.staged / "app/docker/data-dir").write_text("/other/data\n")
        shutil.rmtree(self.staged / "app")
        fallback = self.root / "unused-fnos-var"
        result, arguments = self.configure(fallback)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("type=bind,src=" + data + ",dst=/data", arguments)
        self.assertTrue(Path(data).is_dir())
        self.assertFalse(fallback.exists())

    def test_default_package_keeps_original_storage_and_helper_fallback(self):
        self.stage_package()
        original = (self.source / "app/docker/docker-compose.yaml").read_text()
        compose = (self.staged / "app/docker/docker-compose.yaml").read_text()
        self.assertEqual(compose.count("${TRIM_PKGVAR:?}"), original.count("${TRIM_PKGVAR:?}"))
        for location in ("app/docker/data-dir", "cmd/bootstrap/data-dir"):
            self.assertFalse((self.staged / location).exists())
        fallback = self.root / "default fnos data"
        result, arguments = self.configure(fallback)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("type=bind,src=" + str(fallback) + ",dst=/data", arguments)
        self.assertTrue(fallback.is_dir())

    def test_custom_metadata_does_not_require_trim_pkgvar(self):
        data = str(self.root / "custom/data")
        self.stage_package(data)
        result, arguments = self.configure()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("type=bind,src=" + data + ",dst=/data", arguments)

    def test_restage_without_override_removes_previous_metadata(self):
        self.stage_package(str(self.root / "custom/data"))
        self.stage_package()
        self.assertFalse((self.staged / "app/docker/data-dir").exists())
        self.assertFalse((self.staged / "cmd/bootstrap/data-dir").exists())
        self.assertIn("${TRIM_PKGVAR:?}", (self.staged / "app/docker/docker-compose.yaml").read_text())

    def test_rejects_unsafe_paths_before_touching_staging(self):
        self.stage_package()
        sentinel = self.staged / "untouched"
        sentinel.write_text("keep")
        paths = ("", "/", "relative/data", "/vol2", "/etc/pindou", "/proc/storage",
                 "/var/lib/docker/data", "/var/lib", "/tmp/data/../etc", "/tmp/./data",
                 "/tmp//data", "//tmp/data", "/tmp/data/", "/tmp/data\n", "/tmp/data\r",
                 "/tmp/data\t", "/tmp/data\x7f", "/tmp/a:b", "/tmp/a,b",
                 '/tmp/a"b', "/tmp/$DATA", "/tmp/a\\b", "/tmp/with space")
        for data in paths:
            with self.subTest(path=repr(data)):
                with self.assertRaises(SystemExit):
                    self.stage_package(data)
                self.assertEqual(sentinel.read_text(), "keep")
        # OS environments cannot contain NUL, but the validator rejects it too.
        with patch.object(stage.os, "environ", {"FNOS_DATA_DIR": "/tmp/data\x00"}):
            with self.assertRaises(SystemExit):
                stage.data_directory()

    def test_bootstrap_rejects_malformed_metadata_without_running_helper(self):
        self.stage_package()
        metadata = self.staged / "cmd/bootstrap/data-dir"
        for value in ("", "relative/data", "/tmp/data\n/injected", "/tmp/a,b", "/tmp/a/../b"):
            with self.subTest(path=repr(value)):
                metadata.write_text(value + "\n")
                result, arguments = self.configure(self.root / "fallback")
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(arguments, [])

    def test_master_metadata_contains_path_and_renderer_but_no_secrets(self):
        master = self.root / "private.env"
        master.write_text('SECRET="not-part-of-the-package"\n')
        environment = dict(IMAGES, FNOS_MASTER_ENV=str(master))
        with patch.dict(os.environ, environment, clear=True), patch.object(stage, "ROOT", self.source):
            with contextlib.redirect_stdout(io.StringIO()):
                stage.main()
        bootstrap = self.staged / "cmd/bootstrap"
        self.assertEqual((bootstrap / "master-env").read_text(), str(master) + "\n")
        self.assertEqual((bootstrap / "render-config.py").read_bytes(), (ROOT.parent / "configure.py").read_bytes())
        for name in ("install", "config"):
            for page in json.loads((self.staged / "wizard" / name).read_text()):
                self.assertTrue(all(item.get("field") != "wizard_ark_api_key" for item in page["items"]))
        for path in self.staged.rglob('*'):
            if path.is_file():
                self.assertNotIn(b'not-part-of-the-package', path.read_bytes())


if __name__ == "__main__":
    unittest.main()
