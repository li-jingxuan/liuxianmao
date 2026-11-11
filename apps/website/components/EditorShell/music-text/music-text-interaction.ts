/** 候选字确认所用的 Enter 与真正提交分开；支持浏览器组合状态和旧 keyCode。 */
export const shouldIgnoreMusicTextKey = (
  event: { isComposing: boolean; keyCode: number; timeStamp: number },
  composing: boolean,
  compositionEndedAt: number,
): boolean =>
  composing ||
  event.isComposing ||
  event.keyCode === 229 ||
  (event.timeStamp >= compositionEndedAt &&
    event.timeStamp - compositionEndedAt < 50);
