from __future__ import annotations

import re
from pathlib import Path

import pytest
from PIL import Image

from pindou.imaging import image_backup
from pindou.imaging.image_backup import backup_ai_processing_images


def test_backup_ai_processing_images_saves_three_stage_pngs(tmp_path: Path) -> None:
    original = Image.new("RGBA", (4, 3), (255, 0, 0, 255))
    seedream = Image.new("RGBA", (5, 2), (0, 0, 255, 255))
    onnx = Image.new("RGBA", (5, 2), (0, 255, 0, 96))
    try:
        original_path, seedream_path, final_path, metrics_path = backup_ai_processing_images(
            original,
            seedream,
            foreground_final=onnx,
            metrics={"background_processing": "local_matte"},
            directory=tmp_path / "assets" / "images",
        )
    finally:
        original.close()
        seedream.close()
        onnx.close()

    original_match = re.fullmatch(r"(\d{13})-original\.png", original_path.name)
    seedream_match = re.fullmatch(r"(\d{13})-seedream-enhanced\.png", seedream_path.name)
    final_match = re.fullmatch(r"(\d{13})-foreground-final\.png", final_path.name)
    metrics_match = re.fullmatch(r"(\d{13})-foreground-metrics\.json", metrics_path.name)
    assert original_match is not None
    assert seedream_match is not None
    assert final_match is not None
    assert metrics_match is not None
    assert {
        original_match.group(1),
        seedream_match.group(1),
        final_match.group(1),
        metrics_match.group(1),
    } == {original_match.group(1)}

    with Image.open(original_path) as saved_original:
        assert saved_original.size == (4, 3)
        assert saved_original.getpixel((0, 0)) == (255, 0, 0, 255)
    with Image.open(seedream_path) as saved_seedream:
        assert saved_seedream.size == (5, 2)
        assert saved_seedream.getpixel((0, 0)) == (0, 0, 255, 255)
    with Image.open(final_path) as saved_onnx:
        assert saved_onnx.size == (5, 2)
        assert saved_onnx.getpixel((0, 0)) == (0, 255, 0, 96)
    assert metrics_path.read_text(encoding="utf-8") == '{"background_processing":"local_matte"}'


def test_backup_without_onnx_saves_only_original_and_seedream(tmp_path: Path) -> None:
    original = Image.new("RGBA", (2, 2), (255, 0, 0, 255))
    seedream = Image.new("RGBA", (2, 2), (0, 0, 255, 255))
    try:
        paths = backup_ai_processing_images(
            original,
            seedream,
            foreground_final=None,
            metrics={},
            directory=tmp_path,
        )
    finally:
        original.close()
        seedream.close()

    assert paths[0].name.endswith("-original.png")
    assert paths[1].name.endswith("-seedream-enhanced.png")
    assert paths[0].stem.removesuffix("-original") == paths[1].stem.removesuffix(
        "-seedream-enhanced"
    )
    assert paths[2].name.endswith("-foreground-metrics.json")
    assert not list(tmp_path.glob("*-foreground-final.png"))


def test_backup_timestamp_conflict_retries_without_overwriting(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(image_backup.time, "time_ns", lambda: 1_700_000_000_000_000_000)
    existing = tmp_path / "1700000000000-seedream-enhanced.png"
    existing.write_bytes(b"existing")
    original = Image.new("RGBA", (1, 1), (1, 2, 3, 255))
    seedream = Image.new("RGBA", (1, 1), (4, 5, 6, 255))
    try:
        paths = backup_ai_processing_images(
            original,
            seedream,
            foreground_final=None,
            metrics={},
            directory=tmp_path,
        )
    finally:
        original.close()
        seedream.close()

    assert existing.read_bytes() == b"existing"
    assert {path.name for path in paths} == {
        "1700000000001-original.png",
        "1700000000001-seedream-enhanced.png",
        "1700000000001-foreground-metrics.json",
    }
    assert not (tmp_path / "1700000000000-original.png").exists()


def test_backup_write_failure_removes_partial_group(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    backup_dir = tmp_path / "backups"
    original = Image.new("RGBA", (1, 1), (1, 2, 3, 255))
    seedream = Image.new("RGBA", (1, 1), (4, 5, 6, 255))
    original_save = Image.Image.save
    save_calls = 0

    def fail_on_second_save(self: Image.Image, *args: object, **kwargs: object) -> None:
        nonlocal save_calls
        save_calls += 1
        if save_calls == 2:
            raise OSError("simulated write failure")
        original_save(self, *args, **kwargs)

    monkeypatch.setattr(Image.Image, "save", fail_on_second_save)
    try:
        with pytest.raises(OSError, match="simulated write failure"):
            backup_ai_processing_images(
                original,
                seedream,
                foreground_final=None,
                metrics={},
                directory=backup_dir,
            )
    finally:
        original.close()
        seedream.close()

    assert list(backup_dir.iterdir()) == []
