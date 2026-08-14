"""编排方形采样和颜色量化，提供稳定的图像领域入口。"""

from __future__ import annotations

from PIL import Image

from pindou.color.chart import MardColorChart
from pindou.imaging.preprocess import fit_to_square_grid
from pindou.imaging.quantize import QuantizedGrid, quantize_to_mard_grid
from pindou.schemas.conversion import BackgroundMode


def build_bead_grid(
    image: Image.Image,
    *,
    chart: MardColorChart,
    grid_size: int,
    effective_max_colors: int,
    color_set_size: int,
    background_mode: BackgroundMode,
) -> QuantizedGrid:
    """串联“方形采样”和“MARD 量化”，构造最终网格。

    这个函数是图像领域层的稳定入口。未来即使替换代表色算法或增加 Seedream，
    HTTP 路由仍只需调用这一入口。临时工作图在 `finally` 中关闭，调用方只得到
    与 Pillow 生命周期无关的不可变网格数据。
    """
    fitted = fit_to_square_grid(
        image,
        grid_size=grid_size,
        background_mode=background_mode,
    )
    try:
        return quantize_to_mard_grid(
            fitted,
            chart=chart,
            color_set_size=color_set_size,
            effective_max_colors=effective_max_colors,
        )
    finally:
        fitted.close()
