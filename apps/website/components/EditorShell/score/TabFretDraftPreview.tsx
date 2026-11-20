import {
  LXM_FRET_TEXT_BASELINE_OFFSET_Y,
  LXM_FRET_TEXT_FONT_SIZE,
  SCORE_TEXT_FONT,
  type ILXMLayout,
  type ILXMResolvedTabCellRange,
} from "@liuxianmao/lxm-editor";

/** 等待第二位数字期间，直接在当前弦格预览首位。 */
export const TabFretDraftPreview = ({ layout, range, fret }: {
  layout: ILXMLayout;
  range: ILXMResolvedTabCellRange;
  fret: string;
}) => {
  const beatIds = new Set(range.beats.map(({ beatId }) => beatId));
  return (
    <g data-fret-draft-preview aria-hidden="true" pointerEvents="none">
      {layout.systems.flatMap((system) => system.measures.flatMap((measure) => {
        const strings = measure.strings.filter(({ index }) => index >= range.startString && index <= range.endString);
        return measure.beats.filter(({ id }) => beatIds.has(id)).flatMap((beat) =>
          strings.map(({ index, y1 }) => (
            <g key={`${beat.id}/${index}`}>
              <rect x={beat.x - 5} y={y1 - 4.5} width={10} height={8} fill="#fff" />
              <text
                x={beat.x}
                y={y1 + LXM_FRET_TEXT_BASELINE_OFFSET_Y}
                textAnchor="middle"
                fontSize={LXM_FRET_TEXT_FONT_SIZE}
                fontFamily={SCORE_TEXT_FONT}
                fill="#2864e3"
              >{fret}</text>
            </g>
          )),
        );
      }))}
    </g>
  );
};
