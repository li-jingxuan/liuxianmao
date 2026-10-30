import { describe, expect, it } from "vitest";
import {
  applyScoreCommand,
  buildLayout,
  EXAMPLE_MVP_6_DOCUMENT,
  hitTestMusicText,
  hitTestNumbered,
  layoutParagraphFocus,
  LXMScoreCommandEnum,
} from "../../src";

/** 歌词只能从真实简谱音符录入；简谱空白录入单独使用无事件声部。 */
const fixture = (kind: "lyric" | "numbered" = "lyric") => {
  const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
  const track = document.score.tracks[0]!;
  for (const m of track.measures) {
    m.lyrics = [];
    if (kind === "numbered") m.numberedVoice = { events: [], tuplets: [] };
  }
  const m = track.measures[0]!;
  const target: Omit<Parameters<typeof layoutParagraphFocus>[1], "kind"> = {
    trackId: track.id,
    measureId: m.id,
    ...(kind === "lyric"
      ? { eventId: m.numberedVoice.events[0]!.id }
      : { tick: 0, endTick: 480 }),
  };
  return {
    document,
    target,
  };
};

describe("无占位歌词和简谱编辑", () => {
  it("空歌词焦点围绕起音，点击范围变宽也不扩展显示框", () => {
    const { document, target } = fixture();
    const layout = buildLayout(document, {
      purpose: "editing",
      paragraphEditing: { ...target, kind: "lyric", verse: 1 },
    });
    const slot = layout.systems[0]!.measures[0]!.numberedSlots[0]!;
    const cell = layout.systems[0]!.musicTextCells!.find(
      (item) => item.eventId === target.eventId && item.kind === "lyric",
    )!;
    const focus = () =>
      layoutParagraphFocus(layout, { ...target, kind: "lyric", verse: 1 })!;

    // 点击范围与显示框分离，宽窄拍都以音符为中心显示默认框。
    cell.width = 8;
    expect(focus()).toMatchObject({
      x: slot.x - 12,
      width: 24,
      height: Math.max(18, cell.height),
    });
    cell.x = slot.x - 20;
    cell.width = 80;
    expect(focus()).toMatchObject({ x: slot.x - 12, width: 24 });
  });

  it.each(["lyric", "numbered"] as const)(
    "空 %s 区域可以命中、提交，且不影响正式导出布局",
    (kind) => {
      const { document, target } = fixture(kind);
      const before = structuredClone(document);
      const formal = buildLayout(document, { systemWidth: 180 });
      const editing = buildLayout(document, {
        systemWidth: 180,
        purpose: "editing",
        paragraphEditing: { ...target, kind, verse: 3 },
      });
      const cell =
        kind === "numbered"
          ? editing.hitIndex.numberedBounds!.find(
              (c) => c.target.kind === "numberedTime" && c.target.tick === 0,
            )!
          : editing.systems[0]!.musicTextCells!.find(
              (c) =>
                c.eventId === target.eventId &&
                c.kind === kind &&
                c.verse === 3,
            )!;
      expect(
        (kind === "numbered" ? hitTestNumbered : hitTestMusicText)(editing, {
          x: cell.x + cell.width / 2,
          y: cell.y + cell.height / 2,
        }),
      ).toMatchObject(
        kind === "numbered"
          ? { kind: "numberedTime" }
          : { eventId: target.eventId, kind },
      );
      expect(
        layoutParagraphFocus(editing, { ...target, kind, verse: 3 })!.y,
      ).toBeGreaterThanOrEqual(
        formal.systems[0]!.measures[0]!.strings.at(-1)!.y1,
      );
      expect(editing.systems[0]!.height).toBeGreaterThan(
        formal.systems[0]!.height,
      );
      expect(cell.y + cell.height).toBeLessThanOrEqual(
        editing.systems[0]!.y + editing.systems[0]!.height,
      );
      expect(editing.systems[1]!.y).toBeGreaterThan(
        editing.systems[0]!.y + editing.systems[0]!.height,
      );
      expect(formal.systems[0]!.musicTextCells).toEqual([]);
      expect(buildLayout(document, { systemWidth: 180 })).toEqual(formal);
      expect(document).toEqual(before);
      const result = applyScoreCommand(
        document,
        kind === "lyric"
          ? {
              type: LXMScoreCommandEnum.SetLyric,
              ...target,
              eventId: target.eventId!,
              verse: 3,
              text: "新词",
            }
          : {
              type: "numbered.range.replace",
              trackId: target.trackId,
              measureId: target.measureId,
              startTick: 0,
              endTick: 480,
              items: [{ kind: "set", tokens: ["3"] }],
              rhythms: [{ base: "eighth", dots: 0 }],
              allowOverwrite: false,
            },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const saved = buildLayout(result.document, { systemWidth: 180 });
      expect(
        kind === "numbered"
          ? saved.hitIndex.numberedBounds!.some(
              (b) => b.target.kind === "numberedEvent",
            )
          : saved.systems[0]!.musicTextCells!.some(
              (c) => c.kind === kind && !c.empty,
            ),
      ).toBe(true);
    },
  );
  it("已有文字优先于邻拍空格，其他空拍可以直接命中", () => {
    const { document, target } = fixture();
    const m = document.score.tracks[0]!.measures[0]!;
    m.lyrics = [
      {
        id: "long-lyric",
        eventId: target.eventId!,
        verse: 1,
        text: "这是一段较长的歌词",
      },
    ];
    const layout = buildLayout(document);
    const lyric = layout.systems[0]!.measures[0]!.lyrics![0]!;
    expect(
      hitTestMusicText(layout, {
        x: lyric.bounds.x + lyric.bounds.width - 1,
        y: lyric.bounds.y + 1,
      })!.id,
    ).toBe("long-lyric");
    for (const kind of ["lyric"] as const) {
      const cell = layout.systems[0]!.musicTextCells!.find(
        (c) =>
          c.eventId === m.numberedVoice.events.at(-1)!.id && c.kind === kind,
      )!;
      expect(
        hitTestMusicText(layout, { x: cell.x + cell.width / 2, y: cell.y + 1 }),
      ).toMatchObject({ kind, eventId: cell.eventId });
    }
    expect(collectLabels(layout)).not.toContain("1.");
  });
});
/** 检查正式歌词图元只包含实际歌词。 */
const collectLabels = (layout: ReturnType<typeof buildLayout>) =>
  layout.systems.flatMap((s) =>
    s.measures.flatMap((m) => m.lyrics?.map((l) => l.label.text) ?? []),
  );
