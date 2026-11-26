import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

// 服务端只输出静态画面。按钮等到 React 能响应操作后再显示，避免无脚本时出现失效控件。
export function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
