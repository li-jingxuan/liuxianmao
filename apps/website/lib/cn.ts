import { clsx, type ClassValue } from "clsx";

/**
 * 统一组合 Tailwind 与 SCSS Modules 类名，避免组件手工拼接空格字符串。
 */
export const cn = (...values: ClassValue[]): string => clsx(values);
