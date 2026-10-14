import styles from "./index.module.scss";
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

export const MusicTextLayer = ({
  layout,
  lyricFocus,
}: {
  layout: ILXMLayout;
  lyricFocus?: ReturnType<
    typeof import("./music-text-focus").resolveLyricFocus
  >;
}) => (
  <g data-layer="music-text">
    {layout.systems.map((system) => (
      <g key={system.index}>
        {system.leftEdge?.map((line, i) => (
          <line
            key={`edge-${i}`}
            data-system-left-edge={system.index}
            {...line}
            stroke="currentColor"
            pointerEvents="none"
          />
        ))}
        {system.numberedMarks?.map((mark) => (
          <g key={mark.markId} data-numbered-mark={mark.markId}>
            {mark.path && (
              <path
                d={mark.path.d}
                fill="none"
                stroke="currentColor"
                strokeWidth={mark.path.strokeWidth}
              />
            )}
            {mark.dots.map((d, i) => (
              <circle key={i} {...d} fill="currentColor" />
            ))}
            {mark.labels.map((g, i) => (
              <MusicGlyph key={i} glyph={g} />
            ))}
          </g>
        ))}
        {system.measures.map((measure) => (
          <g key={measure.id}>
            {measure.numberedNotation?.map((n) => (
              <g key={n.eventId} data-numbered-event={n.eventId}>
                {n.labels.map((g, i) => (
                  <MusicGlyph key={i} glyph={g} />
                ))}
                {n.lines
                  ?.filter((l) => l.thickness > 0)
                  .map((l, i) => (
                    <line
                      key={`line-${i}`}
                      x1={l.x1}
                      x2={l.x2}
                      y1={l.y}
                      y2={l.y}
                      stroke="currentColor"
                      strokeWidth={l.thickness}
                      pointerEvents="none"
                    />
                  ))}
                {n.rhythmDots?.map((d, i) => (
                  <circle key={`rhythm-dot-${i}`} {...d} fill="currentColor" />
                ))}
                {n.dots.map((d, i) => (
                  <circle key={i} {...d} fill="currentColor" />
                ))}
              </g>
            ))}
            {measure.lyrics?.map((lyric) => (
              <g key={lyric.id} data-lyric-id={lyric.id}>
                {lyricFocus?.id === lyric.id && (
                  <rect
                    className={styles.lyricFocus}
                    pointerEvents="none"
                    x={lyric.bounds.x - 4}
                    y={lyric.bounds.y - 2}
                    width={lyric.bounds.width + 8}
                    height={lyric.bounds.height + 4}
                    rx={3}
                  />
                )}
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
