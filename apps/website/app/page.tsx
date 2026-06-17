import type React from "react";

type ToolOption = {
  readonly icon: string;
  readonly label: string;
  readonly active?: boolean;
};

const BRAVURA_SYMBOLS = {
  noteWhole: "\uE1D3",
  noteHalf: "\uE1D4",
  noteQuarter: "\uE1D5",
  noteEighth: "\uE1D7",
  noteSixteenth: "\uE1D9",
  noteThirtySecond: "\uE1DB",
  restQuarter: "\uE4E5",
  timeSigCommon: "\uE08A",
  barlineSingle: "\uE030",
  accidentalSharp: "\uE262",
  repeatDots: "\uE044",
  gClef: "\uE050",
} as const;

const TOOLBAR_SECTIONS: readonly (readonly ToolOption[])[] = [
  [
    { icon: BRAVURA_SYMBOLS.noteQuarter, label: "音符", active: true },
    { icon: BRAVURA_SYMBOLS.restQuarter, label: "休止符" },
    { icon: BRAVURA_SYMBOLS.timeSigCommon, label: "节拍" },
    { icon: BRAVURA_SYMBOLS.barlineSingle, label: "小节线" },
    { icon: BRAVURA_SYMBOLS.accidentalSharp, label: "和弦" },
    { icon: "T", label: "文本" },
  ],
  [
    { icon: BRAVURA_SYMBOLS.repeatDots, label: "重复" },
    { icon: BRAVURA_SYMBOLS.gClef, label: "调号" },
    { icon: BRAVURA_SYMBOLS.noteQuarter, label: "速度" },
  ],
] as const;

const NOTE_OPTIONS: readonly ToolOption[] = [
  { icon: BRAVURA_SYMBOLS.noteWhole, label: "全音符" },
  { icon: BRAVURA_SYMBOLS.noteHalf, label: "二分音符" },
  { icon: BRAVURA_SYMBOLS.noteQuarter, label: "四分音符", active: true },
  { icon: BRAVURA_SYMBOLS.noteEighth, label: "八分音符" },
  { icon: BRAVURA_SYMBOLS.noteSixteenth, label: "十六分音符" },
  { icon: BRAVURA_SYMBOLS.noteThirtySecond, label: "三十二分音符" },
] as const;

const TECHNIQUE_OPTIONS = [
  { icon: "⌒", label: "击弦 (H)" },
  { icon: "⌒", label: "勾弦 (P)" },
  { icon: "↗", label: "上滑音 (/)" },
  { icon: "↘", label: "下滑音 (\\)" },
  { icon: "↕", label: "推弦 (B)" },
  { icon: "~", label: "颤音 (V)" },
  { icon: "⌂", label: "泛音 (AH)" },
  { icon: "∗", label: "闷音 (x)" },
] as const;

const PLAYBACK_ACTIONS = ["⏮", "▶", "⏭", "↻"] as const;

type NotePosition = {
  readonly fret: string;
  readonly beat: number;
  readonly string: number;
  readonly tied?: boolean;
};

type Measure = {
  readonly number: number;
  readonly chord?: string;
  readonly notes: readonly NotePosition[];
};

const SCORE_ROWS: readonly (readonly Measure[])[] = [
  [
    {
      number: 1,
      chord: "Am",
      notes: [
        { fret: "0", beat: 0.23, string: 4 },
        { fret: "0", beat: 0.47, string: 4, tied: true },
        { fret: "1", beat: 0.78, string: 3 },
      ],
    },
    {
      number: 2,
      notes: [
        { fret: "3", beat: 0.16, string: 4 },
        { fret: "2", beat: 0.41, string: 2 },
        { fret: "3", beat: 0.59, string: 3 },
        { fret: "2", beat: 0.78, string: 1 },
      ],
    },
    {
      number: 3,
      notes: [
        { fret: "3", beat: 0.16, string: 4 },
        { fret: "2", beat: 0.39, string: 3 },
        { fret: "2", beat: 0.57, string: 4 },
        { fret: "0", beat: 0.77, string: 1 },
        { fret: "3", beat: 0.92, string: 2 },
      ],
    },
    {
      number: 4,
      notes: [
        { fret: "2", beat: 0.18, string: 4 },
        { fret: "1", beat: 0.39, string: 2 },
        { fret: "1", beat: 0.39, string: 3 },
        { fret: "2", beat: 0.61, string: 4 },
        { fret: "0", beat: 0.82, string: 1 },
      ],
    },
  ],
  [
    {
      number: 5,
      chord: "F",
      notes: [
        { fret: "2", beat: 0.22, string: 4 },
        { fret: "1", beat: 0.43, string: 3 },
        { fret: "3", beat: 0.55, string: 4 },
        { fret: "?", beat: 0.82, string: 2 },
      ],
    },
    {
      number: 6,
      notes: [
        { fret: "1", beat: 0.12, string: 3 },
        { fret: "3", beat: 0.34, string: 5 },
        { fret: "2", beat: 0.57, string: 2 },
        { fret: "2", beat: 0.69, string: 5 },
        { fret: "3", beat: 0.88, string: 3 },
      ],
    },
    {
      number: 7,
      notes: [
        { fret: "2", beat: 0.18, string: 3 },
        { fret: "2", beat: 0.43, string: 4 },
        { fret: "2", beat: 0.64, string: 1 },
        { fret: "3", beat: 0.88, string: 3 },
      ],
    },
    {
      number: 8,
      notes: [
        { fret: "1", beat: 0.12, string: 4 },
        { fret: "2", beat: 0.2, string: 5 },
        { fret: "2", beat: 0.42, string: 2 },
        { fret: "2", beat: 0.67, string: 4 },
        { fret: "3", beat: 0.84, string: 3 },
      ],
    },
  ],
  [
    {
      number: 9,
      chord: "C",
      notes: [
        { fret: "3", beat: 0.13, string: 5 },
        { fret: "0", beat: 0.37, string: 3 },
        { fret: "0", beat: 0.62, string: 1 },
        { fret: "3", beat: 0.84, string: 3 },
      ],
    },
    {
      number: 10,
      notes: [
        { fret: "3", beat: 0.12, string: 4 },
        { fret: "1", beat: 0.33, string: 3 },
        { fret: "3", beat: 0.49, string: 2 },
        { fret: "3", beat: 0.61, string: 4 },
        { fret: "1", beat: 0.83, string: 3 },
      ],
    },
    {
      number: 11,
      chord: "G",
      notes: [
        { fret: "3", beat: 0.12, string: 5 },
        { fret: "2", beat: 0.35, string: 3 },
        { fret: "0", beat: 0.62, string: 1 },
        { fret: "3", beat: 0.86, string: 3 },
      ],
    },
    {
      number: 12,
      notes: [
        { fret: "3", beat: 0.11, string: 5 },
        { fret: "2", beat: 0.34, string: 2 },
        { fret: "3", beat: 0.55, string: 4 },
        { fret: "3", beat: 0.75, string: 1 },
        { fret: "3", beat: 0.92, string: 3 },
      ],
    },
  ],
  [
    {
      number: 13,
      chord: "Am",
      notes: [
        { fret: "3", beat: 0.13, string: 5 },
        { fret: "3", beat: 0.36, string: 4 },
        { fret: "0", beat: 0.62, string: 1 },
        { fret: "2", beat: 0.83, string: 1 },
      ],
    },
    {
      number: 14,
      notes: [
        { fret: "2", beat: 0.13, string: 5 },
        { fret: "3", beat: 0.35, string: 3 },
        { fret: "0", beat: 0.55, string: 5 },
        { fret: "0", beat: 0.62, string: 2 },
        { fret: "1", beat: 0.86, string: 4 },
      ],
    },
    {
      number: 15,
      notes: [
        { fret: "3", beat: 0.12, string: 5 },
        { fret: "2", beat: 0.41, string: 1 },
        { fret: "3", beat: 0.55, string: 4 },
        { fret: "2", beat: 0.76, string: 2 },
      ],
    },
    {
      number: 16,
      notes: [
        { fret: "3", beat: 0.12, string: 5 },
        { fret: "2", beat: 0.44, string: 3 },
        { fret: "2", beat: 0.57, string: 4 },
        { fret: "2", beat: 0.74, string: 1 },
        { fret: "1", beat: 0.91, string: 3 },
      ],
    },
  ],
] as const;

const STAFF_STRINGS = [1, 2, 3, 4, 5, 6] as const;

const getStringTop = (stringIndex: number): string => {
  return `${(stringIndex - 1) * 20}%`;
};

const HeaderBar: React.FC = () => {
  return (
    <header className="app-header">
      <div className="brand-block" aria-label="六线猫">
        <span className="cat-mark" aria-hidden="true">
          ᓚᘏᗢ
        </span>
        <strong>六线猫</strong>
        <span className="save-state">自动保存成功⌄</span>
      </div>

      <div className="score-title" aria-label="乐谱名称">
        <strong>未命名乐谱 1</strong>
        <span aria-hidden="true">⌁</span>
      </div>

      <div className="header-actions" aria-label="文件操作">
        <button className="icon-button" type="button" aria-label="撤销">
          ↶
        </button>
        <button className="icon-button" type="button" aria-label="重做">
          ↷
        </button>
        <span className="divider" aria-hidden="true" />
        <button className="ghost-button" type="button">
          保存
        </button>
        <button className="dark-button" type="button">
          ⇩ 导出
        </button>
        <button className="icon-button" type="button" aria-label="更多">
          ⋯
        </button>
      </div>
    </header>
  );
};

const Toolbar: React.FC = () => {
  return (
    <nav className="score-toolbar" aria-label="乐谱工具栏">
      <div className="history-actions" aria-label="编辑历史">
        <button className="icon-button disabled" type="button" aria-label="撤销">
          ↶
        </button>
        <button className="icon-button" type="button" aria-label="重做">
          ↷
        </button>
      </div>

      {TOOLBAR_SECTIONS.map((section, index) => (
        <div className="tool-section" key={`tool-section-${index}`}>
          {section.map((tool) => (
            <button
              className={`tool-button ${tool.active ? "active" : ""}`}
              key={tool.label}
              type="button"
              title={tool.label}
            >
              <span className="music-icon" aria-hidden="true">
                {tool.icon}
              </span>
              <span>{tool.label}</span>
            </button>
          ))}
        </div>
      ))}

      <div className="score-settings" aria-label="谱面设置">
        <button className="select-button" type="button">
          4/4⌄
        </button>
        <button className="select-button" type="button">
          <span className="music-icon">{BRAVURA_SYMBOLS.noteQuarter}</span> 120⌄
        </button>
        <button className="ghost-button compact" type="button">
          ☷ 显示设置
        </button>
      </div>
    </nav>
  );
};

const Sidebar: React.FC = () => {
  return (
    <aside className="left-panel" aria-label="音符与技巧">
      <section>
        <h2>添加音符</h2>
        <div className="option-list">
          {NOTE_OPTIONS.map((option) => (
            <button
              className={`option-button ${option.active ? "active" : ""}`}
              key={option.label}
              type="button"
            >
              <span className="music-icon" aria-hidden="true">
                {option.icon}
              </span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="technique-section">
        <h2>技巧</h2>
        <div className="option-list">
          {TECHNIQUE_OPTIONS.map((option) => (
            <button className="option-button" key={option.label} type="button">
              <span aria-hidden="true">{option.icon}</span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
};

interface MeasureViewProps {
  measure: Measure;
}

const MeasureView: React.FC<MeasureViewProps> = ({ measure }) => {
  return (
    <article className="measure" aria-label={`第 ${measure.number} 小节`}>
      <span className="measure-number">{measure.number}</span>
      {measure.chord ? <strong className="chord-label">{measure.chord}</strong> : null}
      <div className="tab-staff" aria-hidden="true">
        {STAFF_STRINGS.map((stringIndex) => (
          <span
            className="staff-line"
            key={stringIndex}
            style={{ top: getStringTop(stringIndex) }}
          />
        ))}
        {measure.notes.map((note, index) => (
          <span
            className={`fret-note ${note.tied ? "tied" : ""}`}
            key={`${measure.number}-${note.beat}-${note.string}-${index}`}
            style={{ left: `${note.beat * 100}%`, top: getStringTop(note.string) }}
          >
            {note.fret}
          </span>
        ))}
        <span className="note-beam short" />
        <span className="note-beam long" />
      </div>
    </article>
  );
};

const ScoreCanvas: React.FC = () => {
  return (
    <main className="canvas-panel" aria-label="乐谱编辑区域">
      <div className="tempo-row">
        <span className="tempo-note music-icon">{BRAVURA_SYMBOLS.noteQuarter}</span>
        <span>= 120</span>
      </div>

      <div className="score-sheet">
        <div className="tab-prefix" aria-hidden="true">
          <span>T</span>
          <span>A</span>
          <span>B</span>
        </div>
        <div className="time-signature" aria-hidden="true">
          <strong>4</strong>
          <strong>4</strong>
        </div>
        <span className="playhead" aria-hidden="true" />
        <span className="selected-note" aria-hidden="true">
          3
        </span>

        {SCORE_ROWS.map((row, rowIndex) => (
          <section className="score-row" key={`score-row-${rowIndex}`}>
            {row.map((measure) => (
              <MeasureView measure={measure} key={measure.number} />
            ))}
          </section>
        ))}
      </div>

      <button className="add-measure-button" type="button">
        ＋ 添加小节
      </button>
    </main>
  );
};

const PlaybackBar: React.FC = () => {
  return (
    <footer className="playback-bar" aria-label="播放控制">
      <div className="transport-controls">
        {PLAYBACK_ACTIONS.map((action, index) => (
          <button
            className={`transport-button ${index === 1 ? "primary" : ""}`}
            key={action}
            type="button"
          >
            {action}
          </button>
        ))}
      </div>

      <div className="playback-meta">
        <strong>Am</strong>
        <span>1/16</span>
        <span>00:00 / 01:30</span>
      </div>

      <div className="timeline" aria-hidden="true">
        <span />
      </div>

      <div className="volume-control" aria-label="音量">
        <span className="music-icon">{BRAVURA_SYMBOLS.noteSixteenth}</span>
        <div className="volume-track">
          <span />
        </div>
      </div>

      <div className="bottom-actions">
        <button className="ghost-button compact" type="button">
          <span className="music-icon">{BRAVURA_SYMBOLS.noteQuarter}</span> 节拍器
        </button>
        <button className="ghost-button compact" type="button">
          ↻ 循环
        </button>
        <button className="icon-button" type="button" aria-label="设置">
          ⚙
        </button>
      </div>
    </footer>
  );
};

// 首页展示静态编辑器壳层，后续可在这些区域替换为真实制谱状态和交互。
const HomePage: React.FC = () => {
  return (
    <div className="music-editor">
      <HeaderBar />
      <section className="workspace-shell" aria-label="六线谱编辑器">
        <Toolbar />
        <div className="editor-body">
          <Sidebar />
          <ScoreCanvas />
        </div>
      </section>
      <PlaybackBar />
    </div>
  );
};

export default HomePage;
