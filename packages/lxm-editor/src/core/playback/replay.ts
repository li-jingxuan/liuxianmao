import type { ILXMMeasure, ILXMPlaybackReplay } from "../types";

type ResolvedPlaybackReplay =
  | { ok: true; afterIndex: number; fromIndex: number; throughIndex: number }
  | { ok: false; field: keyof ILXMPlaybackReplay; message: string };

/**
 * 文件校验与试听共用同一套引用规则。三个端点必须在当前轨道，重奏首尾可以
 * 是同一小节，但整段必须位于锚点之前，才能保证重奏的是已演奏过的内容。
 */
export function resolvePlaybackReplay(
  measures: readonly ILXMMeasure[],
  replay: ILXMPlaybackReplay,
): ResolvedPlaybackReplay {
  const indexOf = (id: string) =>
    measures.findIndex((measure) => measure.id === id);
  const afterIndex = indexOf(replay.afterMeasureId);
  const fromIndex = indexOf(replay.fromMeasureId);
  const throughIndex = indexOf(replay.throughMeasureId);
  if (afterIndex < 0)
    return { ok: false, field: "afterMeasureId", message: "重奏锚点不存在于当前轨道" };
  if (fromIndex < 0)
    return { ok: false, field: "fromMeasureId", message: "重奏起始小节不存在于当前轨道" };
  if (fromIndex >= afterIndex)
    return { ok: false, field: "fromMeasureId", message: "重奏起始小节必须在锚点之前" };
  if (throughIndex < 0)
    return { ok: false, field: "throughMeasureId", message: "重奏结束小节不存在于当前轨道" };
  if (fromIndex > throughIndex || throughIndex >= afterIndex)
    return {
      ok: false,
      field: "throughMeasureId",
      message: "重奏结束小节须在起始小节处或之后，且在锚点之前",
    };
  return { ok: true, afterIndex, fromIndex, throughIndex };
}
