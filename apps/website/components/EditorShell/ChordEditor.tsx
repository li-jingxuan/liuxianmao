import { Alert, Button, Form, Input, InputNumber, Select } from "antd";
import {
  layoutChordDiagram,
  validateChordDiagram,
  getChordDiagramFretCount,
  type ILXMChordSymbol,
  type ILXMChordDiagram,
  type ILXMChordString,
} from "@liuxianmao/lxm-editor";
import { useMemo, useState, type RefCallback } from "react";
import { ChordDiagramView } from "./MusicTextLayer";
import {
  ChordPresetControls,
  type ChordEditorLibraryProps,
} from "./ChordPresetControls";
import viewStyles from "./ChordEditor.module.scss";

export interface ChordDraft {
  display: ILXMChordSymbol["display"];
  chord: ILXMChordSymbol["chord"];
}
/** Invalid form intermediates never reach layout; retain a readable valid graph. */
export const ChordDiagramPreview = ({
  diagram,
  width,
  height,
  emptyText = "尚未设置指法",
}: {
  diagram: ILXMChordDiagram | null;
  width: number;
  height: number;
  emptyText?: string;
}) => {
  const valid = useMemo(() => diagram && !validateChordDiagram(diagram) ? layoutChordDiagram(diagram) : null, [diagram]);
  const [lastValid, setLastValid] = useState(valid);
  if ((valid || !diagram) && valid !== lastValid) setLastValid(valid);
  const preview = diagram ? (valid ?? lastValid) : null;
  return preview ? (
    <div className={viewStyles.previewGraph}>
      <svg
        role="img"
        aria-label="指法图预览"
        width={width}
        height={height}
        viewBox={`${preview.bounds.x - 4} ${preview.bounds.y - 4} ${preview.bounds.width + 8} ${preview.bounds.height + 8}`}
      >
        <ChordDiagramView diagram={preview} />
      </svg>
      {!valid && <small>显示上次有效指法；当前修改尚未通过校验。</small>}
    </div>
  ) : (
    <span className={viewStyles.emptyDiagram}>{emptyText}</span>
  );
};
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
export interface ChordEditorProps extends ChordEditorLibraryProps {
  inputRef: RefCallback<HTMLInputElement>;
  draft: ChordDraft;
  onChange: (draft: ChordDraft) => void;
  presetsEnabled: boolean;
  disabled?: boolean;
  inputReadOnly?: boolean;
  allowEmptyName?: boolean;
  presetMenuOpen?: boolean;
  onPresetMenuOpenChange?: (open: boolean) => void;
}
/** 控件变化只更新本地值对象，所有字段一起应用成一条领域命令。 */
export const ChordEditor = ({
  inputRef,
  draft,
  onChange,
  presetsEnabled,
  disabled = false,
  presetMenuOpen,
  onPresetMenuOpenChange,
  inputReadOnly = disabled,
  allowEmptyName = false,
  document,
  tuning,
  onOpenLibrary,
  onOpenCustom,
  onOpenSettings,
  showChordDiagrams,
}: ChordEditorProps) => {
  // InputNumber 清空时以 NaN 保留非法草稿，统一校验阻止提交，不把空值转成 0。
  const diagram = draft.chord.diagram;
  const updateDiagram = (value: ILXMChordDiagram) =>
    onChange({ ...draft, chord: { ...draft.chord, diagram: value } });
  const issue = diagram ? validateChordDiagram(diagram) : null;
  // 非法中间值只显示校验信息，不交给图形布局生成误导性预览。
  const removing = allowEmptyName && draft.chord.name.trim() === "";
  return (
    <div className={viewStyles.editor}>
      <section className={viewStyles.preview} aria-label="和弦预览">
        <div className={viewStyles.previewCaption}>
          <strong>{draft.chord.name || "未命名"}</strong>
          <span>{presetsEnabled ? "标准调弦　E A D G B E" : "自定义调弦"}</span>
        </div>
        {issue && !removing && <p role="alert">{issue}</p>}
        <ChordDiagramPreview diagram={diagram} width={90} height={110} />
      </section>
      <section className={viewStyles.presets} aria-label="名称与常用指法">
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
            readOnly={inputReadOnly}
            onChange={(e) =>
              !inputReadOnly &&
              onChange({
                ...draft,
                chord: { ...draft.chord, name: e.target.value },
              })
            }
          />
        </Form.Item>
        {removing && (
          <p className={viewStyles.help}>
            应用后删除当前拍的和弦名称与指法，保留拍点。
          </p>
        )}
        <ChordPresetControls
          draft={draft}
          onChange={onChange}
          presetsEnabled={presetsEnabled}
          disabled={disabled}
          document={document}
          tuning={tuning}
          onOpenLibrary={onOpenLibrary}
          onOpenSettings={onOpenSettings}
          menuOpen={presetMenuOpen}
          onMenuOpenChange={onPresetMenuOpenChange}
        />
        {!presetsEnabled && (
          <Alert
            type="info"
            showIcon
            title="常用预设暂停，仍可自定义六弦与横按"
            description="预设基于标准调弦；已有指法不会自动转置，和弦名称由你确认。"
          />
        )}
        {onOpenCustom && (
          <Button disabled={disabled} onClick={() => onOpenCustom()}>
            {diagram ? "编辑指法" : "自定义指法"}
          </Button>
        )}
        {!diagram && !onOpenCustom && (
          <Button
            disabled={disabled}
            onClick={() => updateDiagram(emptyDiagram())}
          >
            创建指法图
          </Button>
        )}
      </section>
      {diagram && !onOpenCustom && (
        <>
          <details className={viewStyles.disclosure} open>
            <summary>
              六弦指法<span>禁奏 / 空弦 / 品位</span>
            </summary>
            <div className={viewStyles.disclosureContent}>
              <p className={viewStyles.help}>
                由粗弦到细弦：6 → 1，与指法图从左到右一致。
              </p>
              <div className={viewStyles.fingeringGrid}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">弦</th>
                      <th scope="col">品位</th>
                      <th scope="col">手指</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...diagram.strings]
                      .sort((a, b) => b.string - a.string)
                      .map((s) => (
                        <tr key={s.string}>
                          <th scope="row">第 {s.string} 弦</th>
                          <td>
                            <Select
                              disabled={disabled}
                              aria-label={`${s.string}弦品位`}
                              value={s.fret}
                              onChange={(value) => {
                                const fret =
                                  value === "x" ? "x" : Number(value);
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
                                  label: `${i + 1} 品`,
                                })),
                              ]}
                            />
                          </td>
                          <td>
                            <Select
                              aria-label={`${s.string}弦手指`}
                              disabled={
                                disabled || s.fret === "x" || s.fret === 0
                              }
                              aria-describedby={
                                s.fret === "x" || s.fret === 0
                                  ? `chord-finger-reason-${s.string}`
                                  : undefined
                              }
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
                                ...["食指", "中指", "无名指", "小指"].map(
                                  (label, i) => ({
                                    value: i + 1,
                                    label: `${i + 1} ${label}`,
                                  }),
                                ),
                              ]}
                            />
                            {(s.fret === "x" || s.fret === 0) && (
                              <small
                                id={`chord-finger-reason-${s.string}`}
                                className={viewStyles.fingerReason}
                              >
                                {s.fret === "x"
                                  ? "禁奏弦无需手指"
                                  : "空弦无需手指"}
                              </small>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
          <details className={viewStyles.disclosure}>
            <summary>
              横按与显示范围<span>{diagram.barres.length}/4 组横按</span>
            </summary>
            <div className={viewStyles.disclosureContent}>
              <p className={viewStyles.help}>
                横按最多 4
                组。起弦编号应小于止弦编号，显示范围只移动观察窗口，不会转调。
              </p>
              {diagram.barres.map((b, i) => (
                <fieldset key={i} className={viewStyles.barreFields}>
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
                          disabled={disabled}
                          id={"editor-field-" + `横按${i + 1}${field}`}
                          aria-label={`横按${i + 1}${field}`}
                          min={1}
                          max={
                            field === "fret" ? 24 : field === "finger" ? 4 : 6
                          }
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
                    disabled={disabled}
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
                disabled={disabled || diagram.barres.length >= 4}
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
              <Form.Item
                layout="vertical"
                label="起始品位"
                htmlFor={"editor-field-" + "起始品位"}
              >
                <InputNumber
                  disabled={disabled}
                  id={"editor-field-" + "起始品位"}
                  aria-label="起始品位"
                  min={1}
                  max={20}
                  value={
                    Number.isFinite(diagram?.startFret ?? 1)
                      ? (diagram?.startFret ?? 1)
                      : null
                  }
                  onChange={(value) =>
                    diagram &&
                    updateDiagram({
                      ...diagram,
                      startFret: value ?? Number.NaN,
                    })
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
          </details>
        </>
      )}
      <details className={viewStyles.disclosure}>
        <summary>
          和弦保存方式
          <span>{draft.display === "name" ? "仅名称" : "名称与指法图"}</span>
        </summary>
        <div className={viewStyles.disclosureContent}>
          <Form.Item
            layout="vertical"
            label="和弦保存方式"
            htmlFor="chord-display"
          >
            <Select
              disabled={disabled}
              id="chord-display"
              aria-label="和弦显示方式"
              value={draft.display}
              onChange={(display: ChordDraft["display"]) =>
                onChange({ ...draft, display })
              }
              options={[
                { value: "name", label: "仅名称" },
                {
                  value: "nameAndDiagram",
                  label: "名称与指法图",
                  disabled: !diagram,
                },
              ]}
            />
            {!diagram && <small>创建指法图后可在谱面显示指法。</small>}
            {diagram && draft.display === "name" && (
              <small>指法已保留，谱面当前保存为仅名称。</small>
            )}
            {diagram && showChordDiagrams === false && (
              <small>指法已保留；全局已隐藏指法图，编辑预览仍可见。</small>
            )}
            {diagram &&
              showChordDiagrams === true &&
              draft.display === "name" && (
                <small>保存为仅名称；全局已开启指法图。</small>
              )}
          </Form.Item>
        </div>
      </details>
      {diagram && (
        <details className={viewStyles.disclosure}>
          <summary>
            清除指法<span>保留和弦名称</span>
          </summary>
          <div className={viewStyles.disclosureContent}>
            <Button
              disabled={disabled}
              onClick={() =>
                onChange({
                  display: "name",
                  chord: { ...draft.chord, diagram: null },
                })
              }
            >
              仅清除指法图
            </Button>
            <p className={viewStyles.help}>
              应用后生效；应用前可恢复和弦修改。
            </p>
          </div>
        </details>
      )}
      {issue && !removing && (
        <Alert type="error" showIcon title="指法尚未应用" description={issue} />
      )}
    </div>
  );
};
