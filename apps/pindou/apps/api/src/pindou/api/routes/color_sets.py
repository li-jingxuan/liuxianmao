"""向前端暴露 MARD 累计颜色组选择项。"""

from __future__ import annotations

from fastapi import APIRouter

from pindou.api.dependencies import ColorChartDep, SettingsDep
from pindou.schemas.conversion import ColorSetOption, ColorSetsResponse

router = APIRouter(prefix="/color-sets", tags=["color-sets"])


@router.get("")
def list_color_sets(chart: ColorChartDep, app_settings: SettingsDep) -> ColorSetsResponse:
    """返回色卡中真实存在的累计颜色组。

    前端必须消费此接口，不能自行维护 24、48……264 的列表。这样色卡升级、
    删除或新增颜色组时，前后端不会出现可选项不一致的问题。
    """
    if chart.get_set(app_settings.default_color_set_size) is None:
        # 默认组属于部署配置错误，不是用户输入错误，因此让服务明确失败。
        raise RuntimeError("DEFAULT_COLOR_SET_SIZE does not exist in the MARD color chart")
    return ColorSetsResponse(
        schema_version=chart.schema_version,
        default_size=app_settings.default_color_set_size,
        sets=[
            ColorSetOption(
                size=color_set.size,
                label=f"MARD {color_set.size}色",
                color_count=len(color_set.colors),
            )
            # `set_sizes` 已排序，接口会稳定地从小套装返回到大套装。
            for color_set in (chart.sets_by_size[size] for size in chart.set_sizes)
        ],
    )
