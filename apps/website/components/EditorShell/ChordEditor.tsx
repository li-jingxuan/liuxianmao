import { Button, Form, Input, InputNumber, Select } from "antd";
import {
  CHORD_PRESETS,
  copyChordPreset,
  layoutChordDiagram,
  validateChordDiagram,
  getChordDiagramFretCount,
  type ILXMChordSymbol,
  type ILXMChordDiagram,
  type ILXMChordString,
} from "@liuxianmao/lxm-editor";
import type { RefCallback } from "react";
import { ChordDiagramView } from "./MusicTextLayer";
import styles from "./index.module.scss";

export interface ChordDraft {
  display: ILXMChordSymbol["display"];
  chord: ILXMChordSymbol["chord"];
}
const emptyDiagram = (): ILXMChordDiagram => ({
  startFret: 1,
  fretCount: 5,
  barres: [],
  strings: Array.from({ length: 6 }, (_, i) => ({
    string: (i + 1) as ILXMChordString["string"],
    fret: 0,
    finger: null,
  })),
});
/** 控件变化只更新本地值对象，所有字段一起应用成一条领域命令。 */
export const ChordEditor = ({
  inputRef,
  draft,
  onChange,
  presetsEnabled,
}: {
  inputRef: RefCallback<HTMLInputElement>;
  draft: ChordDraft;
  onChange: (draft: ChordDraft) => void;
  presetsEnabled: boolean;
}) => {
  // InputNumber 清空时以 NaN 保留非法草稿，统一校验阻止提交，不把空值转成 0。
  const diagram = draft.chord.diagram;
  const updateDiagram = (value: ILXMChordDiagram) =>
    onChange({ ...draft, chord: { ...draft.chord, diagram: value } });
  const issue = diagram ? validateChordDiagram(diagram) : null;
  // 非法中间值只显示校验信息，不交给图形布局生成误导性预览。
  const preview = diagram && !issue ? layoutChordDiagram(diagram) : null;
  const preset = CHORD_PRESETS.find(
    (p) =>
      p.name === draft.chord.name &&
      JSON.stringify(p.diagram) === JSON.stringify(diagram),
  );
  return (
    <>
      <section className={styles.sidebarSection}>
        <h3>基本设置</h3>
        <div className={styles.propertyGrid}>
          <Form.Item
            layout="vertical"
            label="和弦名称"
            htmlFor={"editor-field-" + "和弦名称"}
          >
            <Input
              id={"editor-field-" + "和弦名称"}
              ref={(control) => {
                inputRef(control?.input ?? null);
              }}
              aria-label="和弦名称"
              value={draft.chord.name}
              onChange={(e) =>
                onChange({
                  ...draft,
                  chord: { ...draft.chord, name: e.target.value },
                })
              }
            />
          </Form.Item>
          <Form.Item
            layout="vertical"
            label="常用预设"
            htmlFor={"editor-field-" + "常用和弦预设"}
          >
            <Select
              id={"editor-field-" + "常用和弦预设"}
              aria-label="常用和弦预设"
              disabled={!presetsEnabled}
              value={preset?.name ?? ""}
              onChange={(value) => {
                const chord = copyChordPreset(value);
                if (chord) onChange({ display: "nameAndDiagram", chord });
              }}
              style={{ width: "100%" }}
              options={[
                { value: "", label: "自定义" },
                ...CHORD_PRESETS.map((p) => ({ value: p.name, label: p.name })),
              ]}
            />
          </Form.Item>
          <Form.Item
            layout="vertical"
            label="起始品位"
            htmlFor={"editor-field-" + "起始品位"}
          >
            <InputNumber
              id={"editor-field-" + "起始品位"}
              aria-label="起始品位"
              min={1}
              max={20}
              disabled={!diagram}
              value={
                Number.isFinite(diagram?.startFret ?? 1)
                  ? (diagram?.startFret ?? 1)
                  : null
              }
              onChange={(value) =>
                diagram &&
                updateDiagram({ ...diagram, startFret: value ?? Number.NaN })
              }
              changeOnBlur={false}
              style={{ width: "100%" }}
            />
            <small>
              按指法显示 3–5 个品格
              {diagram && !issue
                ? `，当前 ${getChordDiagramFretCount(diagram)} 格`
                : ""}
              ；起始品位不改变实际按弦品位。
            </small>
          </Form.Item>
        </div>
        <small>
          名称与指法由你确认。{!presetsEnabled && "当前调弦仅支持自定义指法。"}
        </small>
        {!diagram && (
          <Button onClick={() => updateDiagram(emptyDiagram())}>
            创建指法图
          </Button>
        )}
      </section>
      {diagram && (
        <section className={styles.sidebarSection}>
          <div className={styles.sectionHeading}>
            <h3>指法设置</h3>
            <Button
              type="link"
              onClick={() =>
                onChange({ ...draft, chord: { ...draft.chord, diagram: null } })
              }
            >
              清除指法图
            </Button>
          </div>
          <div className={styles.fingeringGrid}>
            <table>
              <thead>
                <tr>
                  <th>弦</th>
                  <th>品位</th>
                  <th>手指</th>
                </tr>
              </thead>
              <tbody>
                {diagram.strings.map((s) => (
                  <tr key={s.string}>
                    <td>{s.string}</td>
                    <td>
                      <Select
                        aria-label={`${s.string}弦品位`}
                        value={s.fret}
                        onChange={(value) => {
                          const fret = value === "x" ? "x" : Number(value);
                          updateDiagram({
                            ...diagram,
                            strings: diagram.strings.map((item) =>
                              item.string === s.string
                                ? {
                                    ...s,
                                    fret,
                                    finger:
                                      fret === "x" || fret === 0
                                        ? null
                                        : s.finger,
                                  }
                                : item,
                            ),
                          });
                        }}
                        style={{ width: "100%" }}
                        options={[
                          { value: "x", label: "× 禁奏" },
                          { value: 0, label: "○ 空弦" },
                          ...Array.from({ length: 24 }, (_, i) => ({
                            value: i + 1,
                            label: i + 1,
                          })),
                        ]}
                      />
                    </td>
                    <td>
                      <Select
                        aria-label={`${s.string}弦手指`}
                        disabled={s.fret === "x" || s.fret === 0}
                        value={s.finger ?? ""}
                        onChange={(value) =>
                          updateDiagram({
                            ...diagram,
                            strings: diagram.strings.map((item) =>
                              item.string === s.string
                                ? {
                                    ...s,
                                    finger: value
                                      ? (Number(
                                          value,
                                        ) as ILXMChordString["finger"])
                                      : null,
                                  }
                                : item,
                            ),
                          })
                        }
                        style={{ width: "100%" }}
                        options={[
                          { value: "", label: "未指定" },
                          ...[1, 2, 3, 4].map((i) => ({ value: i, label: i })),
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={styles.chordPreview} aria-label="和弦预览">
              <h4>和弦预览</h4>
              <strong>{draft.chord.name || "未命名"}</strong>
              {issue ? (
                <p role="alert">{issue}</p>
              ) : (
                preview && (
                  <svg
                    aria-label="指法图预览"
                    width={150}
                    height={180}
                    viewBox={`${preview.bounds.x - 4} ${preview.bounds.y - 4} ${preview.bounds.width + 8} ${preview.bounds.height + 8}`}
                  >
                    <ChordDiagramView diagram={preview} />
                  </svg>
                )
              )}
            </div>
          </div>
          <details className={styles.barreSettings} open>
            <summary>横按设置（{diagram.barres.length}/4）</summary>
            {diagram.barres.map((b, i) => (
              <fieldset key={i}>
                <legend>横按 {i + 1}</legend>
                {(["fret", "minString", "maxString", "finger"] as const).map(
                  (field) => (
                    <Form.Item
                      key={field}
                      layout="vertical"
                      label={
                        <>
                          {
                            {
                              fret: "品位",
                              minString: "起弦",
                              maxString: "止弦",
                              finger: "手指",
                            }[field]
                          }{" "}
                        </>
                      }
                      htmlFor={"editor-field-" + `横按${i + 1}${field}`}
                    >
                      <InputNumber
                        id={"editor-field-" + `横按${i + 1}${field}`}
                        aria-label={`横按${i + 1}${field}`}
                        min={1}
                        max={field === "fret" ? 24 : field === "finger" ? 4 : 6}
                        value={Number.isFinite(b[field]) ? b[field] : null}
                        onChange={(value) =>
                          updateDiagram({
                            ...diagram,
                            barres: diagram.barres.map((item, j) =>
                              j === i
                                ? { ...b, [field]: value ?? Number.NaN }
                                : item,
                            ),
                          })
                        }
                        changeOnBlur={false}
                        style={{ width: "100%" }}
                      />
                    </Form.Item>
                  ),
                )}
                <Button
                  onClick={() =>
                    updateDiagram({
                      ...diagram,
                      barres: diagram.barres.filter((_, j) => j !== i),
                    })
                  }
                >
                  删除横按 {i + 1}
                </Button>
              </fieldset>
            ))}
            <Button
              disabled={diagram.barres.length >= 4}
              onClick={() =>
                updateDiagram({
                  ...diagram,
                  barres: [
                    ...diagram.barres,
                    {
                      fret: diagram.startFret,
                      minString: 1,
                      maxString: 6,
                      finger: 1,
                    },
                  ],
                })
              }
            >
              新增横按
            </Button>
          </details>
          <div className={styles.sidebarTip}>
            通过表格选择品位和手指，横按设置可折叠。
            <br />
            起始品位只调整观察窗口，不会自动转调。
          </div>
        </section>
      )}
    </>
  );
};
