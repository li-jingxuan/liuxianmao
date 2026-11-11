/** 歌曲设置的同步 IME 闸门；结束后的选词按键不能立即触发导航或提交。 */
export const createScoreSettingsComposition = (
  onProtectedChange: (protectedInput: boolean) => void,
) => {
  let composing = false;
  let protectedInput = false;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  const notify = () => {
    const next = composing || releaseTimer !== undefined;
    if (next === protectedInput) return;
    protectedInput = next;
    onProtectedChange(next);
  };
  const clearRelease = () => {
    clearTimeout(releaseTimer);
    releaseTimer = undefined;
  };
  const protectEndingKey = () => {
    clearRelease();
    releaseTimer = setTimeout(() => {
      releaseTimer = undefined;
      notify();
    }, 50);
    notify();
  };
  return {
    isComposing: () => composing || releaseTimer !== undefined,
    start: () => {
      clearRelease();
      composing = true;
      notify();
    },
    end: () => {
      composing = false;
      protectEndingKey();
    },
    observeKey: (event: { isComposing: boolean; keyCode: number }) => {
      // 某些浏览器只提供原生按键标志；不能依赖 composition 事件必然先到。
      if (event.isComposing || event.keyCode === 229) protectEndingKey();
    },
    dispose: () => {
      clearRelease();
      composing = false;
    },
  };
};
