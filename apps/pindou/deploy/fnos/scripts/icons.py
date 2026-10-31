#!/usr/bin/env python3
"""Copy the approved Web artwork into the fnOS package at its original sizes."""
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT.parents[1] / "apps/web/src/assets"


def main():
    images = {}
    for size in (64, 256):
        source = ASSETS / f"app_icon_{size}_{size}.png"
        image = source.read_bytes()
        if (not image.startswith(b"\x89PNG\r\n\x1a\n")
                or struct.unpack(">II", image[16:24]) != (size, size)
                or len(image) >= 1024 * 1024):
            raise SystemExit(f"Expected a {size}px PNG smaller than 1 MiB: {source}")
        images[size] = image
    for size, filename in ((64, "ICON.PNG"), (256, "ICON_256.PNG")):
        (ROOT / filename).write_bytes(images[size])
        destination = ROOT / "app/ui/images" / f"icon_{size}.png"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(images[size])
    print("Copied the approved 64px and 256px app icons from Web assets.")


if __name__ == "__main__":
    main()
