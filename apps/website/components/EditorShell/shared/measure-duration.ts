import { TICKS_PER_QUARTER } from "@liuxianmao/lxm-editor";

/** 面板与编辑标记都以四分音符为一拍；导入的非整拍值按 tick 约分，避免显示循环小数。 */
export function formatMeasureDuration(ticks: number): string {
  const whole = Math.floor(ticks / TICKS_PER_QUARTER);
  const remainder = ticks % TICKS_PER_QUARTER;
  if (remainder === 0) return `${whole} 拍`;
  let divisor: number = TICKS_PER_QUARTER;
  let next = remainder;
  while (next > 0) [divisor, next] = [next, divisor % next];
  const fraction = `${remainder / divisor}/${TICKS_PER_QUARTER / divisor}`;
  return `${whole ? `${whole} ` : ""}${fraction} 拍`;
}
