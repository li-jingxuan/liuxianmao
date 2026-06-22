import { create } from "zustand";

/** 当前可见系统范围，按 layout.systems 的下标表达。 */
export interface VisibleSystemRange {
  /** 第一个进入视口的系统下标。 */
  start: number;
  /** 最后一个进入视口的系统下标。 */
  end: number;
}

export interface ViewportStoreState {
  /** 视口宽度，单位 px。 */
  width: number;
  /** 视口高度，单位 px。 */
  height: number;
  /** 预览缩放倍率，1 表示 100%。 */
  zoom: number;
  /** 水平滚动偏移，单位 px。 */
  scrollX: number;
  /** 垂直滚动偏移，单位 px。 */
  scrollY: number;
  /** 当前可见系统区间，用于做懒计算或状态同步。 */
  visibleSystems: VisibleSystemRange;
  /** 更新视口尺寸。 */
  setSize: (width: number, height: number) => void;
  /** 更新缩放倍率，会被钳制在允许范围内。 */
  setZoom: (zoom: number) => void;
  /** 更新滚动偏移，会自动去掉负值。 */
  setScroll: (scrollX: number, scrollY: number) => void;
  /** 更新当前可见系统范围。 */
  setVisibleSystems: (range: VisibleSystemRange) => void;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

/** 视口状态只描述画布观察方式，不属于可撤销的乐谱内容。 */
export const useViewportStore = create<ViewportStoreState>((set) => ({
  width: 0,
  height: 0,
  zoom: 1,
  scrollX: 0,
  scrollY: 0,
  visibleSystems: { start: 0, end: 0 },
  setSize: (width, height) =>
    set({ width: Math.max(0, width), height: Math.max(0, height) }),
  setZoom: (zoom) =>
    set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) }),
  setScroll: (scrollX, scrollY) =>
    set({ scrollX: Math.max(0, scrollX), scrollY: Math.max(0, scrollY) }),
  setVisibleSystems: (visibleSystems) => set({ visibleSystems }),
}));
