import type {
  LaidOutTieSegment,
  LaidOutDurationMark,
  LaidOutTuplet,
} from "@liuxianmao/lxm-tabeditor";

/**
 * tie 的视觉弧线只消费 layout 层给出的端点坐标。
 * helper 保持纯函数，避免渲染组件里混入几何细节。
 */
export const getTiePath = (
  segment: Pick<LaidOutTieSegment, "x1" | "y1" | "x2" | "y2">,
) => {
  const startX = segment.x1 + 8;
  const endX = segment.x2 - 8;
  const baselineY = segment.y1 - 11;
  const controlOffsetX = Math.max(12, (endX - startX) / 3);
  const controlY = baselineY - 10;

  return `
    M ${startX} ${baselineY}
    C ${startX + controlOffsetX} ${controlY}
      ${endX - controlOffsetX} ${controlY}
      ${endX} ${baselineY}
  `;
};

/**
 * flag 使用连续二次贝塞尔曲线向上拱起。
 * 这里把 stemX 和当前层级的 flagY 作为唯一输入，避免 JSX 中出现大段硬编码 path。
 */
export const getDurationFlagPath = (
  stemX: LaidOutDurationMark["stemX"],
  flagY: number,
) => `
  M ${stemX} ${flagY}
  Q ${stemX + 4} ${flagY - 2} ${stemX + 8} ${flagY - 6}
  Q ${stemX + 8.5} ${flagY - 8} ${stemX + 8} ${flagY - 10}
`;

/** 连音括号使用折线路径，方便后续统一调整 bracket 的视觉高度。 */
export const getTupletBracketPath = (
  tuplet: Pick<LaidOutTuplet, "x1" | "x2" | "y">,
) => `
  M ${tuplet.x1} ${tuplet.y}
  L ${tuplet.x1} ${tuplet.y + 4}
  L ${tuplet.x2} ${tuplet.y + 4}
  L ${tuplet.x2} ${tuplet.y}
`;

