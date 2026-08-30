from PIL import Image
from io import BytesIO
from pathlib import Path

def prepare_seedream_transparent_input(input_path: str, output_path: str):
    img = Image.open(input_path).convert("RGBA")

    # 将左上角 1 个像素设置成完全透明
    r, g, b, _ = img.getpixel((0, 0))
    img.putpixel((0, 0), (r, g, b, 0))

  
    img.save(output_path, "PNG")


_output_path = (Path(__file__).parent / "images" / "seedream_input_transparent.png").resolve()
_path = (Path(__file__).parent / "images" / "xiaozhan.png").resolve()

print(_path)
print(_output_path)
prepare_seedream_transparent_input(
  _path, _output_path
)