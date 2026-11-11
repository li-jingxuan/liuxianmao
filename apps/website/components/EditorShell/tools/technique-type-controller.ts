import type { ILXMTechniqueType } from "@liuxianmao/lxm-editor";
import { TECHNIQUE_OPTIONS } from "./technique-catalog";

export interface TechniqueTypeController {
  getSnapshot: () => ILXMTechniqueType;
  subscribe: (listener: () => void) => () => void;
  select: (type: ILXMTechniqueType) => void;
  reason: (type: ILXMTechniqueType) => string | null;
}
/** 选择暂存至下一步；取消时整次请求丢弃，不触碰原技巧参数。 */
export const createTechniqueTypeController = (
  initial: ILXMTechniqueType,
  reason: TechniqueTypeController["reason"],
): TechniqueTypeController => {
  let selected = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => selected,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reason,
    select: (type) => {
      if (
        reason(type) ||
        !TECHNIQUE_OPTIONS.some((item) => item.value === type) ||
        type === selected
      )
        return;
      selected = type;
      listeners.forEach((listener) => listener());
    },
  };
};
