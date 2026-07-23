/**
 * 整谱布局公开门面。
 *
 * 该模块负责解析默认配置、选择当前轨道、调用 system-layout 自动断行，并构建
 * 渲染与编辑共享的命中索引；不直接参与单小节内的坐标计算。
 */

import type { ILXMDocument } from "../core/types";
import {
  LXM_LAYOUT_DEFAULT_X,
  LXM_LAYOUT_DEFAULT_Y,
  LXM_SYSTEM_DEFAULT_WIDTH,
  LXM_SYSTEM_GAP_Y,
} from "./layout-constants";
import { buildHitIndex } from "./hit-test";
import type { ILXMLayout, ILXMLayoutOptions } from "./layout-types";
import { layoutSystems } from "./system-layout";

/** 没有可布局轨道时返回的空布局，保持调用方无需做 null 判断。 */
const getDefaultLayout = (options: ILXMLayoutOptions): ILXMLayout => {
  const x = options.x ?? LXM_LAYOUT_DEFAULT_X;
  const y = options.y ?? LXM_LAYOUT_DEFAULT_Y;

  return {
    trackId: "",
    x,
    y,
    width: 0,
    height: 0,
    systems: [],
    hitIndex: { measureBounds: [] },
  };
};

/**
 * 根据第一条轨道构建整谱布局。
 *
 * systemWidth 是明确传入的逻辑宽度，不读取浏览器视口，因此同一输入始终会得到
 * 相同的自动换行结果，方便服务端、测试和页面层共享。
 */
export const buildLayout = (
  document: ILXMDocument,
  options: ILXMLayoutOptions = {},
): ILXMLayout => {
  const track = document.score.tracks[0];
  if (!track) return getDefaultLayout(options);

  const x = options.x ?? LXM_LAYOUT_DEFAULT_X;
  const y = options.y ?? LXM_LAYOUT_DEFAULT_Y;
  const systems = layoutSystems(track.measures, {
    startX: x,
    startY: y,
    measureGap: options.measureGap ?? 0,
    systemWidth: options.systemWidth ?? LXM_SYSTEM_DEFAULT_WIDTH,
    systemGapY: options.systemGapY ?? LXM_SYSTEM_GAP_Y,
  });
  const lastSystem = systems[systems.length - 1];

  return {
    trackId: track.id,
    x,
    y,
    width: systems.reduce(
      (maxWidth, system) => Math.max(maxWidth, system.width),
      0,
    ),
    height: lastSystem ? lastSystem.y + lastSystem.height - y : 0,
    systems,
    hitIndex: buildHitIndex(track.id, systems),
  };
};

export { hitTestLayout } from "./hit-test";
export { layoutSystems } from "./system-layout";
