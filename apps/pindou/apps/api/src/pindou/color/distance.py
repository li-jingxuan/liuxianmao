"""实现 sRGB、CIELAB 与 CIEDE2000 感知色差计算。"""

from __future__ import annotations

import math

from pindou.color.chart import LabColor


def srgb_to_lab(rgb: tuple[int, int, int]) -> LabColor:
    """把 8-bit sRGB 转换为以 D65 为白点的 CIELAB。

    sRGB 是非线性编码，不能直接拿三个通道做感知距离。转换步骤依次是：

    1. 将 0–255 归一化并反解 sRGB Gamma，得到线性 RGB；
    2. 通过标准 sRGB 矩阵转换为 CIE XYZ；
    3. 用 D65 参考白归一化 XYZ；
    4. 转换为 L*a*b*，供 CIEDE2000 使用。
    """

    def linearize(channel: int) -> float:
        """反解 sRGB 分段传递函数。"""
        value = channel / 255.0
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4

    red, green, blue = (linearize(channel) for channel in rgb)
    # 标准 sRGB(D65) 到 XYZ 的 3×3 变换矩阵；随后除以 D65 参考白。
    x = (0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / 0.95047
    y = 0.2126729 * red + 0.7151522 * green + 0.0721750 * blue
    z = (0.0193339 * red + 0.1191920 * green + 0.9503041 * blue) / 1.08883

    delta = 6 / 29

    def transform(value: float) -> float:
        # CIELAB 为接近黑色的数值使用线性分支，避免立方根处的不稳定。
        return value ** (1 / 3) if value > delta**3 else value / (3 * delta**2) + 4 / 29

    fx, fy, fz = transform(x), transform(y), transform(z)
    return LabColor(lightness=116 * fy - 16, a=500 * (fx - fy), b=200 * (fy - fz))


def ciede2000(first: LabColor, second: LabColor) -> float:
    """计算两个 Lab 颜色的 CIEDE2000 感知色差 ΔE00。

    数值越小表示人眼感知越接近。这里使用标准权重 kL=kC=kH=1，适合通用
    图像颜色匹配。实现保持为纯函数，便于用公开参考色对验证数学正确性。

    下方变量名遵循 CIEDE2000 公式：C 表示彩度、h 表示色相角、prime 表示
    经中性灰补偿后的量。注释按公式阶段分组，方便后续核对而非逐行解释算术。
    """

    l1, a1, b1 = first.lightness, first.a, first.b
    l2, a2, b2 = second.lightness, second.a, second.b

    # 1. 计算原始彩度，并对 a* 轴做 G 补偿，改善低彩度区域的感知一致性。
    c1 = math.hypot(a1, b1)
    c2 = math.hypot(a2, b2)
    mean_c = (c1 + c2) / 2
    g = 0.5 * (1 - math.sqrt(mean_c**7 / (mean_c**7 + 25**7)))
    a1_prime = (1 + g) * a1
    a2_prime = (1 + g) * a2
    c1_prime = math.hypot(a1_prime, b1)
    c2_prime = math.hypot(a2_prime, b2)

    def hue(a_value: float, b_value: float) -> float:
        """把 atan2 的结果规范到 [0, 360)；无彩色像素的色相定义为 0。"""
        if a_value == 0 and b_value == 0:
            return 0.0
        return math.degrees(math.atan2(b_value, a_value)) % 360

    h1_prime = hue(a1_prime, b1)
    h2_prime = hue(a2_prime, b2)

    # 2. 分别计算明度差、彩度差和跨越 0/360° 边界后的最短色相差。
    delta_l_prime = l2 - l1
    delta_c_prime = c2_prime - c1_prime
    hue_diff = h2_prime - h1_prime
    if c1_prime * c2_prime == 0:
        delta_h_prime = 0.0
    elif abs(hue_diff) <= 180:
        delta_h_prime = hue_diff
    elif hue_diff > 180:
        delta_h_prime = hue_diff - 360
    else:
        delta_h_prime = hue_diff + 360
    # 公式使用加权后的 ΔH'，而不是直接使用角度差。
    delta_h_term = 2 * math.sqrt(c1_prime * c2_prime) * math.sin(math.radians(delta_h_prime / 2))

    # 3. 求平均明度、平均彩度和环形平均色相。
    mean_l_prime = (l1 + l2) / 2
    mean_c_prime = (c1_prime + c2_prime) / 2
    if c1_prime * c2_prime == 0:
        mean_h_prime = h1_prime + h2_prime
    elif abs(h1_prime - h2_prime) <= 180:
        mean_h_prime = (h1_prime + h2_prime) / 2
    elif h1_prime + h2_prime < 360:
        mean_h_prime = (h1_prime + h2_prime + 360) / 2
    else:
        mean_h_prime = (h1_prime + h2_prime - 360) / 2

    # 4. T、SL、SC、SH 描述不同色相/明度区域的人眼敏感度。
    t = (
        1
        - 0.17 * math.cos(math.radians(mean_h_prime - 30))
        + 0.24 * math.cos(math.radians(2 * mean_h_prime))
        + 0.32 * math.cos(math.radians(3 * mean_h_prime + 6))
        - 0.20 * math.cos(math.radians(4 * mean_h_prime - 63))
    )
    delta_theta = 30 * math.exp(-(((mean_h_prime - 275) / 25) ** 2))
    r_c = 2 * math.sqrt(mean_c_prime**7 / (mean_c_prime**7 + 25**7))
    s_l = 1 + 0.015 * (mean_l_prime - 50) ** 2 / math.sqrt(20 + (mean_l_prime - 50) ** 2)
    s_c = 1 + 0.045 * mean_c_prime
    s_h = 1 + 0.015 * mean_c_prime * t
    # RT 是蓝紫区域特有的彩度—色相旋转修正项。
    r_t = -math.sin(math.radians(2 * delta_theta)) * r_c

    # 5. 合并三个标准化分量和旋转修正项，得到最终 ΔE00。
    l_term = delta_l_prime / s_l
    c_term = delta_c_prime / s_c
    h_term = delta_h_term / s_h
    return math.sqrt(l_term**2 + c_term**2 + h_term**2 + r_t * c_term * h_term)
