import type {
  ChordDiagramLayout,
  MusicTextGlyph,
  ILXMLayout,
} from "@liuxianmao/lxm-editor";

/** 度量、baseline 和渲染参数完全相同；内部空格不被 SVG 折叠。 */
export const MusicGlyph = ({ glyph }: { glyph: MusicTextGlyph }) => (
  <text
    data-music-text="true"
    data-bounds={JSON.stringify(glyph.bounds)}
    data-metric-source={glyph.measured ? "measured" : "estimated"}
    x={glyph.x}
    y={glyph.y}
    fontFamily={glyph.fontFamily}
    fontSize={glyph.fontSize}
    fontWeight={glyph.fontWeight}
    textAnchor={glyph.textAnchor}
    dominantBaseline="alphabetic"
    fill={glyph.fill ?? "currentColor"}
    style={{ whiteSpace: "pre" }}
  >
    {glyph.text}
  </text>
);

/** 编辑器预览和正文直接消费同一核心指法图，不在 JSX 推导品格。 */
export const ChordDiagramView = ({
  diagram,
}: {
  diagram: ChordDiagramLayout;
}) => (
  <g>
    {diagram.lines.map((line, i) => (
      <line key={`l${i}`} {...line} stroke="currentColor" />
    ))}
    {diagram.roundedRects.map((rect, i) => (
      <rect key={`b${i}`} {...rect} fill="currentColor" />
    ))}
    {diagram.circles.map((circle, i) => (
      <circle key={`c${i}`} {...circle} fill="currentColor" />
    ))}
    {diagram.texts.map((glyph, i) => (
      <MusicGlyph key={`t${i}`} glyph={glyph} />
    ))}
  </g>
);

export const MusicTextLayer = ({ layout }: { layout: ILXMLayout }) => (
  <g data-layer="music-text">
    {layout.systems.map((system) => (
      <g key={system.index}>
        {system.lyricVerseLabels?.map((glyph) => (
          <MusicGlyph key={glyph.key} glyph={glyph} />
        ))}
        {system.measures.map((measure) => (
          <g key={measure.id}>
            {measure.lyrics?.map((lyric) => (
              <g key={lyric.id} data-lyric-id={lyric.id}>
                <MusicGlyph glyph={lyric.label} />
              </g>
            ))}
            {measure.chordSymbols?.map((chord) => (
              <g
                key={chord.id}
                data-chord-id={chord.id}
                role="img"
                aria-label={chord.description}
              >
                <title>{chord.description}</title>
                <MusicGlyph glyph={chord.label} />
                {chord.diagram && <ChordDiagramView diagram={chord.diagram} />}
              </g>
            ))}
          </g>
        ))}
      </g>
    ))}
  </g>
);
