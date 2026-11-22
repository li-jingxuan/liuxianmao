"use client";

import { useState, type CSSProperties, type KeyboardEvent } from "react";
import styles from "./page.module.scss";

const measures = [
  {
    chord: "C",
    notes: [[5, 3], [4, 0], [4, 2], [3, 0]],
    melody: [1, 2, 3, 5],
    lyrics: ["风", "吹", "过", "山"],
    fingering: [null, 3, 2, 0, 1, 0],
    fingeringLabel: "C 大和弦，六弦不弹，五弦三品，四弦二品，三弦空弦，二弦一品，一弦空弦",
  },
  {
    chord: "G",
    notes: [[3, 2], [3, 0], [4, 2], [4, 0]],
    melody: [6, 5, 3, 2],
    lyrics: ["谷", "轻", "轻", "响"],
    fingering: [3, 2, 0, 0, 0, 3],
    fingeringLabel: "G 大和弦，六弦三品，五弦二品，四弦三弦二弦为空弦，一弦三品",
  },
];

function Tablature() {
  return (
    <div className={styles.tablature} role="img" aria-label="两小节六线谱，从 C 和弦到 G 和弦">
      {measures.map(({ chord, notes }) => (
        <div className={styles.measure} key={chord}>
          <span className={styles.measureChord}>{chord}</span>
          {notes.map(([string, fret], beat) => (
            <span className={styles.fret} style={{ "--beat": beat + 1, "--string": string } as CSSProperties} key={beat}>
              {fret}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function NumberedScore() {
  return (
    <div className={styles.numberedScore}>
      {measures.map(({ chord, melody, lyrics }) => (
        <div className={styles.numberedMeasure} key={chord}>
          {melody.map((note, beat) => <span key={beat}><b>{note}</b> {lyrics[beat]}</span>)}
        </div>
      ))}
    </div>
  );
}

function ChordScore() {
  return (
    <div className={styles.chordScore}>
      {measures.map(({ chord, fingering, fingeringLabel }) => (
        <div className={styles.chord} role="img" aria-label={fingeringLabel} key={chord}>
          <strong>{chord}</strong>
          <span className={styles.openStrings} aria-hidden="true">
            {fingering.map((fret, column) => <span key={column}>{fret === null ? "×" : fret === 0 ? "○" : ""}</span>)}
          </span>
          <span className={styles.chordGrid} aria-hidden="true">
            {fingering.map((fret, column) => fret ? (
              <i className={styles.chordDot} style={{ "--column": column + 1, "--fret": fret } as CSSProperties} key={column} />
            ) : null)}
          </span>
        </div>
      ))}
    </div>
  );
}

const layers = [
  { id: "tablature", label: "六线谱", description: "用弦和品位记录每个音，写出节奏与指法。", Score: Tablature },
  { id: "lyrics", label: "简谱与歌词", description: "把数字简谱和唱词对到同一拍。", Score: NumberedScore },
  { id: "chords", label: "和弦指法", description: "在小节上方标出和弦，查看每根弦怎么按。", Score: ChordScore },
];

export function HomeScorePreview() {
  const [activeLayer, setActiveLayer] = useState(0);

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex;
    switch (event.key) {
      case "ArrowUp":
        nextIndex = (index + layers.length - 1) % layers.length;
        break;
      case "ArrowDown":
        nextIndex = (index + 1) % layers.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = layers.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    setActiveLayer(nextIndex);
    document.getElementById(`score-tab-${layers[nextIndex].id}`)?.focus();
  }

  return (
    <div className={styles.demoLayout}>
      <div className={styles.layerTabs} role="tablist" aria-label="曲谱示例" aria-orientation="vertical">
        {layers.map(({ id, label, description }, index) => (
          <button
            key={id}
            id={`score-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={index === activeLayer}
            aria-controls={`score-panel-${id}`}
            aria-labelledby={`score-tab-label-${id}`}
            aria-describedby={`score-tab-description-${id}`}
            tabIndex={index === activeLayer ? 0 : -1}
            onClick={() => setActiveLayer(index)}
            onKeyDown={(event) => handleTabKey(event, index)}
          >
            <strong id={`score-tab-label-${id}`}>{label}</strong>
            <span id={`score-tab-description-${id}`}>{description}</span>
          </button>
        ))}
      </div>
      <div className={styles.scorePaper}>
        <div className={styles.scoreHeading}>
          <h3>风吹过山谷</h3>
          <p>1=C <span aria-hidden="true">·</span> 4/4</p>
        </div>
        {layers.map(({ id, Score }, index) => (
          <div
            key={id}
            id={`score-panel-${id}`}
            className={styles.scorePanel}
            role="tabpanel"
            aria-labelledby={`score-tab-${id}`}
            tabIndex={0}
            hidden={activeLayer !== index}
          >
            <Score />
          </div>
        ))}
      </div>
    </div>
  );
}
