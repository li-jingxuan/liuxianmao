/**
 * MVP v2 的纯领域命令。
 *
 * 命令层是修改 ILXMDocument 的唯一入口：它只接收数据并返回新数据，不读取 UI
 * 状态、DOM 或 layout 坐标，因此后续可直接接入撤销重做与服务端保存。
 */

import { GUITAR_STRING_COUNT, MAX_FRET } from "./constants";
import { LXMDocumentSchema } from "./schema";
import type { ILXMDocument, ILXMNote } from "./types";

/** 当前 v2 支持的乐谱编辑意图。 */
export type ILXMScoreCommand = ILXMSetNoteCommand | ILXMRemoveNoteCommand;

/** 在指定拍点和弦设置数值品位；同弦已有音符时执行覆盖。 */
export interface ILXMSetNoteCommand {
  type: "note.set";
  trackId: string;
  measureId: string;
  beatId: string;
  string: number;
  fret: number;
}

/** 删除指定拍点和弦的某一根弦音符。 */
export interface ILXMRemoveNoteCommand {
  type: "note.remove";
  trackId: string;
  measureId: string;
  beatId: string;
  string: number;
}

/** 命令失败原因，供页面层映射为明确的用户提示。 */
export type ILXMScoreCommandErrorCode =
  | "TRACK_NOT_FOUND"
  | "MEASURE_NOT_FOUND"
  | "BEAT_NOT_FOUND"
  | "INVALID_STRING"
  | "INVALID_FRET"
  | "DOCUMENT_INVALID";

/** 命令统一返回结构：成功携带新文档，失败保留原文档。 */
export type ILXMApplyScoreCommandResult =
  | { ok: true; document: ILXMDocument }
  | { ok: false; code: ILXMScoreCommandErrorCode; message: string };

/** 为新增音符生成稳定且可预测的 ID；同一 document 内不会与已有 ID 冲突。 */
const createNoteId = (document: ILXMDocument): string => {
  const existingIds = new Set(
    document.score.tracks.flatMap((track) =>
      track.measures.flatMap((measure) =>
        measure.beats.flatMap((beat) => beat.notes.map((note) => note.id)),
      ),
    ),
  );
  const prefix = `note-${document.documentRevision + 1}`;
  let suffix = 1;
  while (existingIds.has(`${prefix}-${suffix}`)) suffix += 1;
  return `${prefix}-${suffix}`;
};

/** 验证吉他弦号，避免命令绕过 schema 写入不存在的第 0 或第 7 弦。 */
const isValidString = (string: number): boolean =>
  Number.isInteger(string) && string >= 1 && string <= GUITAR_STRING_COUNT;

/** 验证当前 MVP 支持的数值品位范围。 */
const isValidFret = (fret: number): boolean =>
  Number.isInteger(fret) && fret >= 0 && fret <= MAX_FRET;

/** 将命令后的候选文档再次交由 schema 守卫，防止未来命令扩展破坏数据契约。 */
const validateDocument = (
  document: ILXMDocument,
): ILXMApplyScoreCommandResult => {
  const parsed = LXMDocumentSchema.safeParse(document);
  return parsed.success
    ? { ok: true, document: parsed.data }
    : {
        ok: false,
        code: "DOCUMENT_INVALID",
        message: "命令结果不符合乐谱文档格式",
      };
};

/**
 * 应用一条乐谱命令并返回不可变的新文档。
 *
 * 关键算法：仅复制 track → measure → beat 这条被修改的路径，其他分支保持原引用，
 * 从而既避免原地修改，也给后续局部缓存和撤销历史留下稳定边界。
 */
export const applyScoreCommand = (
  document: ILXMDocument,
  command: ILXMScoreCommand,
): ILXMApplyScoreCommandResult => {
  if (!isValidString(command.string)) {
    return {
      ok: false,
      code: "INVALID_STRING",
      message: "弦号必须在 1 到 6 之间",
    };
  }
  if (command.type === "note.set" && !isValidFret(command.fret)) {
    return {
      ok: false,
      code: "INVALID_FRET",
      message: `品位必须在 0 到 ${MAX_FRET} 之间`,
    };
  }

  const track = document.score.tracks.find(
    (item) => item.id === command.trackId,
  );
  if (!track)
    return { ok: false, code: "TRACK_NOT_FOUND", message: "目标轨道不存在" };
  const measure = track.measures.find((item) => item.id === command.measureId);
  if (!measure)
    return { ok: false, code: "MEASURE_NOT_FOUND", message: "目标小节不存在" };
  const beat = measure.beats.find((item) => item.id === command.beatId);
  if (!beat)
    return { ok: false, code: "BEAT_NOT_FOUND", message: "目标节拍不存在" };

  const updatedNotes: ILXMNote[] =
    command.type === "note.set"
      ? (() => {
          const existing = beat.notes.find(
            (note) => note.string === command.string,
          );
          if (existing) {
            return beat.notes.map((note) =>
              note.string === command.string
                ? { ...note, fret: command.fret }
                : note,
            );
          }
          return [
            ...beat.notes,
            {
              id: createNoteId(document),
              string: command.string,
              fret: command.fret,
            },
          ];
        })()
      : beat.notes.filter((note) => note.string !== command.string);

  const updatedDocument: ILXMDocument = {
    ...document,
    documentRevision: document.documentRevision + 1,
    score: {
      ...document.score,
      tracks: document.score.tracks.map((currentTrack) =>
        currentTrack.id !== track.id
          ? currentTrack
          : {
              ...currentTrack,
              measures: currentTrack.measures.map((currentMeasure) =>
                currentMeasure.id !== measure.id
                  ? currentMeasure
                  : {
                      ...currentMeasure,
                      beats: currentMeasure.beats.map((currentBeat) =>
                        currentBeat.id !== beat.id
                          ? currentBeat
                          : { ...currentBeat, notes: updatedNotes },
                      ),
                    },
              ),
            },
      ),
    },
  };

  return validateDocument(updatedDocument);
};
