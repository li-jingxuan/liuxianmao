"""把原始 MARD JSON 色卡解析为经过严格校验的内存模型。"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class LabColor:
    """CIELAB 颜色。

    lightness 是明度 L*，a 是绿—红轴，b 是蓝—黄轴。色卡中的 Lab 值以
    D65 白点计算，与本项目的 sRGB → Lab 转换保持一致。
    """

    lightness: float
    a: float
    b: float


@dataclass(frozen=True, slots=True)
class MardColor:
    """单个可采购的 MARD 拼豆颜色。"""

    code: str
    hex: str
    rgb: tuple[int, int, int]
    lab: LabColor


@dataclass(frozen=True, slots=True)
class MardColorSet:
    """用户可选择的累计套装，例如 24 色组或 264 色组。

    `colors` 的成员顺序来自源色卡；量化时它也是唯一允许使用的颜色白名单。
    """

    size: int
    colors: tuple[MardColor, ...]


@dataclass(frozen=True, slots=True)
class MardColorChart:
    """完成结构校验后的内存色卡索引。"""

    schema_version: str
    # 通过色号 O(1) 查找完整颜色数据，便于把 sets[].colors 引用解析为对象。
    colors_by_code: dict[str, MardColor]
    # 通过用户提交的 color_set_size 直接获得合法颜色白名单。
    sets_by_size: dict[int, MardColorSet]

    @property
    def set_sizes(self) -> tuple[int, ...]:
        """按从小到大顺序返回全部可选累计套装。"""
        return tuple(sorted(self.sets_by_size))

    def get_set(self, size: int) -> MardColorSet | None:
        """查找指定颜色组；不存在时返回 None 交由 HTTP 层映射业务错误。"""
        return self.sets_by_size.get(size)


class InvalidColorChartError(ValueError):
    """色卡文件缺失、JSON 非法或内部引用不一致。"""


def _required_dict(value: Any, field: str) -> dict[str, Any]:
    """在解析动态 JSON 时收紧类型，并在错误中保留字段位置。"""
    if not isinstance(value, dict):
        raise InvalidColorChartError(f"{field} must be an object")
    return value


def _required_list(value: Any, field: str) -> list[Any]:
    """验证字段为 JSON 数组。"""
    if not isinstance(value, list):
        raise InvalidColorChartError(f"{field} must be an array")
    return value


def load_mard_color_chart(path: Path) -> MardColorChart:
    """读取并验证 MARD 色卡，返回便于量化使用的不可变领域对象。

    校验不仅确认 JSON 能解析，还会确认：

    - schema 版本存在；
    - 色号唯一，RGB 落在 0–255，Lab 字段可转为浮点数；
    - 每个累计颜色组的成员数量与 size 完全一致；
    - 颜色组内没有重复或不存在的色号。

    服务启动时执行这些检查，可以保证后续量化器无需反复防御损坏数据。
    """
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise InvalidColorChartError(f"cannot load color chart: {path}") from exc

    root = _required_dict(payload, "root")
    meta = _required_dict(root.get("meta"), "meta")
    schema_version = str(meta.get("schema_version", ""))
    if not schema_version:
        raise InvalidColorChartError("meta.schema_version is required")

    # 第一遍解析完整颜色表，建立 code -> MardColor 的唯一索引。
    colors_by_code: dict[str, MardColor] = {}
    for index, item_value in enumerate(_required_list(root.get("colors"), "colors")):
        item = _required_dict(item_value, f"colors[{index}]")
        code = str(item.get("code", "")).strip()
        hex_value = str(item.get("hex", "")).upper()
        rgb_value = _required_dict(item.get("rgb"), f"colors[{index}].rgb")
        lab_value = _required_dict(item.get("lab"), f"colors[{index}].lab")
        if not code or code in colors_by_code:
            raise InvalidColorChartError(f"invalid or duplicate color code: {code!r}")
        if len(hex_value) != 7 or not hex_value.startswith("#"):
            raise InvalidColorChartError(f"invalid HEX value for color {code}")
        try:
            color = MardColor(
                code=code,
                hex=hex_value,
                rgb=(int(rgb_value["r"]), int(rgb_value["g"]), int(rgb_value["b"])),
                lab=LabColor(
                    lightness=float(lab_value["l"]),
                    a=float(lab_value["a"]),
                    b=float(lab_value["b"]),
                ),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise InvalidColorChartError(f"invalid color fields for {code}") from exc
        if any(channel < 0 or channel > 255 for channel in color.rgb):
            raise InvalidColorChartError(f"invalid RGB value for color {code}")
        colors_by_code[code] = color

    # 第二遍解析套装。此时所有色号已知，可以验证每个成员引用。
    sets_by_size: dict[int, MardColorSet] = {}
    for index, item_value in enumerate(_required_list(root.get("sets"), "sets")):
        item = _required_dict(item_value, f"sets[{index}]")
        try:
            size = int(item["size"])
            codes = tuple(str(code) for code in _required_list(item["colors"], "sets.colors"))
        except (KeyError, TypeError, ValueError) as exc:
            raise InvalidColorChartError(f"invalid color set at index {index}") from exc
        if size in sets_by_size or size <= 0:
            raise InvalidColorChartError(f"invalid or duplicate color set size: {size}")
        if len(codes) != size or len(set(codes)) != size:
            # 累计套装声明为 N 色时，必须恰好有 N 个互不重复的色号。
            raise InvalidColorChartError(f"set {size} must contain {size} unique colors")
        unknown = [code for code in codes if code not in colors_by_code]
        if unknown:
            raise InvalidColorChartError(f"set {size} contains unknown colors: {unknown[:3]}")
        # 把字符串色号预解析成颜色对象，量化热路径无需再次查字典。
        sets_by_size[size] = MardColorSet(
            size=size,
            colors=tuple(colors_by_code[code] for code in codes),
        )

    if not colors_by_code or not sets_by_size:
        raise InvalidColorChartError("color chart must contain colors and sets")
    return MardColorChart(
        schema_version=schema_version,
        colors_by_code=colors_by_code,
        sets_by_size=sets_by_size,
    )
