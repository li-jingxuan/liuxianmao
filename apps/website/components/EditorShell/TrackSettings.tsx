import { shouldIgnoreMusicTextKey } from "./music-text-interaction";
import { useState, useRef, type FormEvent } from "react";
import {
  createTuningPreset,
  parsePitchMidi,
  LXMScoreCommandEnum,
  type ILXMTrack,
  type ILXMScoreCommand,
} from "@liuxianmao/lxm-editor";
import { useEditorStore } from "../../stores/editor-store";
import styles from "./index.module.scss";

/** 设置以显式应用提交，输入草稿不进入领域文档和历史。 */
export const TrackSettings = ({
  track,
  measureId,
  disabled,
}: {
  track: ILXMTrack;
  measureId?: string;
  disabled: boolean;
}) => {
  const composing = useRef(false);
  const compositionEndedAt = useRef(-Infinity);
  const execute = useEditorStore((s) => s.execute);
  const measure = track.measures.find((m) => m.id === measureId);
  const [pitches, setPitches] = useState(
    track.tuning.strings.map((s) => s.pitch),
  );
  const [capo, setCapo] = useState(String(track.capo));
  const [label, setLabel] = useState(measure?.sectionLabel ?? "");
  const [start, setStart] = useState(track.measures[0]!.id);
  const [end, setEnd] = useState(track.measures[0]!.id);
  const [after, setAfter] = useState("");
  const submit = (event: FormEvent, command: ILXMScoreCommand) => {
    event.preventDefault();
    if (composing.current || event.timeStamp - compositionEndedAt.current < 50)
      return;
    execute(command);
  };
  return (
    <fieldset
      disabled={disabled}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(e) => {
        composing.current = false;
        compositionEndedAt.current = e.timeStamp;
      }}
      onKeyDown={(e) => {
        if (
          e.key === "Enter" &&
          shouldIgnoreMusicTextKey(
            e.nativeEvent,
            composing.current,
            compositionEndedAt.current,
          )
        )
          e.preventDefault();
      }}
      className={`${styles.sidebarSection} ${styles.trackSettings}`}
    >
      <legend>单轨设置与小节复用</legend>
      <p>调弦和 capo 保留所有品位、闷音及和弦图。数字品位相对于 capo。</p>
      <form
        onSubmit={(e) =>
          submit(e, {
            type: LXMScoreCommandEnum.SetTuning,
            trackId: track.id,
            tuning: {
              strings: pitches.map((pitch, i) => ({
                index: i + 1,
                pitch,
                midi: parsePitchMidi(pitch) ?? -1,
              })),
            },
          })
        }
      >
        <label>
          调弦预设
          <select
            aria-label="调弦预设"
            defaultValue="custom"
            onChange={(e) => {
              if (e.target.value !== "custom")
                setPitches(
                  createTuningPreset(
                    e.target.value as "standard" | "dropD",
                  ).strings.map((s) => s.pitch),
                );
            }}
          >
            <option value="custom">自定义</option>
            <option value="standard">标准调弦</option>
            <option value="dropD">Drop D</option>
          </select>
        </label>
        {pitches.map((pitch, i) => (
          <label key={i}>
            第 {i + 1} 弦
            <input
              aria-label={`第 ${i + 1} 弦调弦`}
              value={pitch}
              onChange={(e) =>
                setPitches(
                  pitches.map((p, j) => (i === j ? e.target.value : p)),
                )
              }
            />
          </label>
        ))}
        <button type="submit">应用调弦</button>
      </form>
      <form
        onSubmit={(e) =>
          submit(e, {
            type: LXMScoreCommandEnum.SetCapo,
            trackId: track.id,
            capo: capo === "" ? NaN : Number(capo),
          })
        }
      >
        <label>
          变调夹
          <input
            aria-label="变调夹"
            type="number"
            min="0"
            max="12"
            step="1"
            required
            value={capo}
            onChange={(e) => setCapo(e.target.value)}
          />
        </label>
        <button type="submit">应用变调夹</button>
      </form>
      {measure && (
        <form
          onSubmit={(e) =>
            submit(e, {
              type: LXMScoreCommandEnum.SetSectionLabel,
              trackId: track.id,
              measureId: measure.id,
              label,
            })
          }
        >
          <label>
            段落标记
            <input
              aria-label="段落标记"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <button type="submit">应用段落标记</button>
        </form>
      )}
      <form
        onSubmit={(e) =>
          submit(e, {
            type: LXMScoreCommandEnum.CopyMeasureRange,
            trackId: track.id,
            sourceStartMeasureId: start,
            sourceEndMeasureId: end,
            afterMeasureId: after || undefined,
          })
        }
      >
        {(
          [
            ["复制起始小节", start, setStart],
            ["复制结束小节", end, setEnd],
            ["插入位置", after, setAfter],
          ] as const
        ).map(([name, value, setValue]) => (
          <label key={name}>
            {name}
            <select
              aria-label={name}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            >
              {name === "插入位置" && <option value="">谱首</option>}
              {track.measures.map((m, i) => (
                <option key={m.id} value={m.id}>
                  {name === "插入位置"
                    ? `第 ${i + 1} 小节后`
                    : `第 ${i + 1} 小节`}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button type="submit">复制小节范围</button>
      </form>
      {disabled && <small>先应用或结束音乐文本草稿，再修改设置。</small>}
    </fieldset>
  );
};
