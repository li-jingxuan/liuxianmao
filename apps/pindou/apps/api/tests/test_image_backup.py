from __future__ import annotations

import re
from pathlib import Path

from PIL import Image

from pindou.imaging.image_backup import backup_enhanced_images


def test_backup_enhanced_images_saves_timestamped_png_pair(tmp_path: Path) -> None:
    original = Image.new("RGBA", (4, 3), (255, 0, 0, 255))
    enhanced = Image.new("RGBA", (5, 2), (0, 0, 255, 255))
    try:
        original_path, enhanced_path = backup_enhanced_images(
            original,
            enhanced,
            directory=tmp_path / "assets" / "images",
        )
    finally:
        original.close()
        enhanced.close()

    original_match = re.fullmatch(r"(\d{13})-original\.png", original_path.name)
    enhanced_match = re.fullmatch(r"(\d{13})-enhanced\.png", enhanced_path.name)
    assert original_match is not None
    assert enhanced_match is not None
    assert original_match.group(1) == enhanced_match.group(1)

    with Image.open(original_path) as saved_original:
        assert saved_original.size == (4, 3)
        assert saved_original.getpixel((0, 0)) == (255, 0, 0, 255)
    with Image.open(enhanced_path) as saved_enhanced:
        assert saved_enhanced.size == (5, 2)
        assert saved_enhanced.getpixel((0, 0)) == (0, 0, 255, 255)
