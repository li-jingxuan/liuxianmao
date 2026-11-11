import {
  createNumberedRhythmContext,
  buildOrderedBeatIndex,
  createCollapsedTabCellSelection,
  getFirstTabCellReference,
  LXMScoreCommandEnum,
  resolveTabCellSelection,
  type ILXMDocument,
  type ILXMNumberedTarget,
  type ILXMScoreCommand,
  type ILXMTabCellReference,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";

/** 简谱焦点只验证本谱层身份，不向最近 TAB Beat 偷偷回退。 */
export const reconcileNumberedSelection = (
  document: ILXMDocument,
  target: ILXMNumberedTarget | null,
): ILXMNumberedTarget | null => {
  if (!target) return null;
  const measure = document.score.tracks
    .find((t) => t.id === target.trackId)
    ?.measures.find((m) => m.id === target.measureId);
  if (!measure) return null;
  if (target.kind === "numberedEvent")
    return measure.numberedVoice.events.some((e) => e.id === target.eventId)
      ? target
      : null;
  return target.tick >= 0 &&
    target.endTick > target.tick &&
    target.endTick <=
      (measure.timeSignature.numerator * 3840) /
        measure.timeSignature.denominator &&
    !measure.numberedVoice.events.some((event) => {
      const duration = createNumberedRhythmContext(
        measure.numberedVoice,
      ).getEventDurationTicks(event);
      return (
        !duration.ok ||
        (event.tick < target.endTick &&
          event.tick + duration.ticks > target.tick)
      );
    })
    ? target
    : null;
};

/**
 * 保留仍合法的临时选区；端点因节奏重建或历史切换消失时回退首个合法单元格。
 * 这个动作发生在 document 切换之后，因此无需把 selection 写入历史快照。
 */
export const reconcileSelection = (
  document: ILXMDocument,
  selection: ILXMTabCellSelection | null,
): ILXMTabCellSelection | null => {
  if (selection && resolveTabCellSelection(document, selection).ok)
    return selection;

  /*
   * undo/redo 可能在“旧尾部休止 ID”和“新尾部休止 ID”之间切换。虽然 Beat ID
   * 失效，measure ID 与弦号通常仍然有效；先把每个失效端点局部回退到原小节首拍，
   * 可以让拍号工具继续指向用户刚才编辑的小节，而不是跳到整首谱开头。
   *
   * 小节本身已被删除时这个局部候选不存在，最后才使用全谱首格兜底。正常的
   * measure.remove 命令仍会在进入此函数前提供相邻小节候选。
   */
  if (selection) {
    const reconcileEndpointInMeasure = (
      reference: ILXMTabCellReference,
    ): ILXMTabCellReference | null => {
      const track = document.score.tracks.find(
        (candidate) => candidate.id === reference.trackId,
      );
      const measure = track?.measures.find(
        (candidate) => candidate.id === reference.measureId,
      );
      const beat = measure
        ? [...measure.beats].sort((left, right) => left.tick - right.tick)[0]
        : undefined;
      return track && measure && beat
        ? { ...reference, measureId: measure.id, beatId: beat.id }
        : null;
    };
    const anchor = reconcileEndpointInMeasure(selection.anchor);
    const focus = reconcileEndpointInMeasure(selection.focus);
    const localCandidate = anchor && focus ? { anchor, focus } : null;
    if (localCandidate && resolveTabCellSelection(document, localCandidate).ok)
      return localCandidate;
  }

  const first = getFirstTabCellReference(document);
  return first ? createCollapsedTabCellSelection(first) : null;
};

/**
 * 删除小节前先计算相邻小节首拍，保留 v3 的稳定定位体验。
 *
 * 其他导致端点失效的命令统一由 reconcileSelection 回退首格；只有 measure.remove
 * 能在旧文档中无歧义地知道“被删目标的相邻小节”。
 */
export const getSelectionCandidateAfterCommand = (
  previousDocument: ILXMDocument,
  nextDocument: ILXMDocument,
  selection: ILXMTabCellSelection | null,
  command: ILXMScoreCommand,
): ILXMTabCellSelection | null => {
  if (!selection) return null;

  if (command.type === LXMScoreCommandEnum.SetTimeSignature) {
    const targetTrack = nextDocument.score.tracks.find(
      (candidate) => candidate.id === command.trackId,
    );
    const targetMeasure = targetTrack?.measures.find(
      (measure) => measure.id === command.measureId,
    );
    const firstTargetBeat = targetMeasure
      ? [...targetMeasure.beats].sort(
          (left, right) => left.tick - right.tick,
        )[0]
      : undefined;
    if (!targetTrack || !targetMeasure || !firstTargetBeat) return selection;

    /**
     * 拍号协调只会删除并重建尾部容量休止，真实内容 Beat ID 会保持稳定。因此逐个
     * 检查端点：仍存在的端点原样保留；只有落在被替换休止上的端点才回到命令目标
     * 小节首拍。多小节范围也统一回到用户最初操作的小节，避免突然跳到后续小节或
     * 整首谱第一格。弦号属于用户的垂直编辑位置，回退时继续保留。
     */
    const reconcileTimeSignatureEndpoint = (
      reference: ILXMTabCellReference,
    ): ILXMTabCellReference => {
      const beatStillExists = nextDocument.score.tracks
        .find((track) => track.id === reference.trackId)
        ?.measures.find((measure) => measure.id === reference.measureId)
        ?.beats.some((beat) => beat.id === reference.beatId);
      return beatStillExists
        ? reference
        : {
            ...reference,
            trackId: targetTrack.id,
            measureId: targetMeasure.id,
            beatId: firstTargetBeat.id,
          };
    };
    return {
      anchor: reconcileTimeSignatureEndpoint(selection.anchor),
      focus: reconcileTimeSignatureEndpoint(selection.focus),
    };
  }

  if (
    command.type !== LXMScoreCommandEnum.RemoveMeasure ||
    (selection.anchor.measureId !== command.measureId &&
      selection.focus.measureId !== command.measureId)
  )
    return selection;

  const track = previousDocument.score.tracks.find(
    (candidate) => candidate.id === command.trackId,
  );
  const removedIndex = track?.measures.findIndex(
    (measure) => measure.id === command.measureId,
  );
  if (!track || removedIndex === undefined || removedIndex < 0)
    return selection;
  const fallbackMeasure =
    track.measures[removedIndex + 1] ?? track.measures[removedIndex - 1];
  const fallbackBeat = fallbackMeasure
    ? buildOrderedBeatIndex({ ...track, measures: [fallbackMeasure] })[0]
    : undefined;
  if (!fallbackBeat) return selection;

  const replaceRemovedEndpoint = (
    reference: ILXMTabCellReference,
  ): ILXMTabCellReference =>
    reference.measureId === command.measureId
      ? {
          ...reference,
          measureId: fallbackBeat.measureId,
          beatId: fallbackBeat.beatId,
        }
      : reference;
  return {
    anchor: replaceRemovedEndpoint(selection.anchor),
    focus: replaceRemovedEndpoint(selection.focus),
  };
};
