import { afterEach, describe, expect, it, vi } from "vitest";
import { createScoreSettingsComposition } from "../components/EditorShell/score-settings-composition";

afterEach(() => vi.useRealTimers());

describe("歌曲设置共同切换的 IME 闸门", () => {
  it("同步阻断输入中及结束后的切换，保护状态同时供草稿协调器使用", () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const composition = createScoreSettingsComposition(changed);
    expect(composition.isComposing()).toBe(false);
    composition.start();
    expect(composition.isComposing()).toBe(true);
    expect(changed).toHaveBeenLastCalledWith(true);
    composition.end();
    vi.advanceTimersByTime(49);
    expect(composition.isComposing()).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(composition.isComposing()).toBe(false);
    expect(changed).toHaveBeenLastCalledWith(false);
  });

  it.each([
    { isComposing: true, keyCode: 13 },
    { isComposing: false, keyCode: 229 },
  ])("没有 composition 事件时仍识别原生按键 %o", (event) => {
    vi.useFakeTimers();
    const composition = createScoreSettingsComposition(vi.fn());
    composition.observeKey(event);
    expect(composition.isComposing()).toBe(true);
    vi.advanceTimersByTime(50);
    expect(composition.isComposing()).toBe(false);
    composition.observeKey({ isComposing: false, keyCode: 13 });
    expect(composition.isComposing()).toBe(false);
  });

  it("再次选词延长保护；新一轮组合输入不会被旧计时器释放", () => {
    vi.useFakeTimers();
    const composition = createScoreSettingsComposition(vi.fn());
    composition.start();
    composition.end();
    vi.advanceTimersByTime(40);
    composition.observeKey({ isComposing: false, keyCode: 229 });
    vi.advanceTimersByTime(40);
    expect(composition.isComposing()).toBe(true);
    composition.start();
    vi.advanceTimersByTime(100);
    expect(composition.isComposing()).toBe(true);
    composition.end();
    vi.advanceTimersByTime(50);
    expect(composition.isComposing()).toBe(false);
  });

  it("卸载时清理保护计时器，不再向旧 owner 推送状态", () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const composition = createScoreSettingsComposition(changed);
    composition.end();
    composition.dispose();
    vi.advanceTimersByTime(100);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(composition.isComposing()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
