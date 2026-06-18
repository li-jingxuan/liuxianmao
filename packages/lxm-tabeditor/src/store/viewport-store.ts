import { create } from "zustand";

export interface VisibleSystemRange {
  start: number;
  end: number;
}

export interface ViewportStoreState {
  width: number;
  height: number;
  zoom: number;
  scrollX: number;
  scrollY: number;
  visibleSystems: VisibleSystemRange;
  setSize: (width: number, height: number) => void;
  setZoom: (zoom: number) => void;
  setScroll: (scrollX: number, scrollY: number) => void;
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
