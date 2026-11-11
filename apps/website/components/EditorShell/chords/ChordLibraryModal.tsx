import { Alert, Button, Checkbox, Input, Select, Tabs } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CHORD_QUALITIES,
  layoutChordDiagram,
  queryChordCatalog,
  readScoreTonality,
  STANDARD_GUITAR_TUNING,
  type ChordCatalog,
  type ChordCatalogMatch,
  type ChordQuality,
} from "@liuxianmao/lxm-editor";
import type { ChordDraft } from "./ChordEditor";
import { ChordDiagramView } from "../score/MusicTextLayer";
import { chordCatalogResource } from "./chord-catalog-resource";
import {
  chordPreferencesStore,
  useChordPreferences,
  CHORD_IMPORT_LIMIT,
  type ChordImportPreview,
  type ChordPreferencesValue,
  type ChordQuickReference,
} from "./chord-preferences";
import {
  chordReferenceLabel,
  chordTuningMatches,
  resolveChordReference,
  selectedCatalogChord,
  standardChordTuning,
  useChordCatalog,
  type ChordEditorLibraryProps,
  type ChordLibraryTab,
} from "./ChordPresetControls";
import styles from "./ChordLibraryModal.module.scss";
import { createScoreSettingsComposition } from "../settings/score-settings-composition";

export interface ChordLibraryModalProps extends Omit<ChordEditorLibraryProps, "onOpenCustom"> {
  draft: ChordDraft;
  presetsEnabled: boolean;
  initialTab?: ChordLibraryTab;
  onConfirm: (next: ChordDraft) => void;
  onCancel: () => void;
  onOpenCustom?: (seed: ChordDraft) => void;
}
const roots = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
type Selection = {
  name: string;
  chord: ChordDraft["chord"];
  reference: ChordQuickReference;
  system: boolean;
  reason: string | null;
  match?: ChordCatalogMatch;
  voicingId: string;
};
const download = (name: string, text: string) => {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const link = globalThis.document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
/** Content only. The Runtime owns the sole Modal, its transaction token and focus. */
export const ChordLibraryModal = ({
  draft,
  document,
  tuning,
  presetsEnabled,
  initialTab = "key",
  onConfirm,
  onCancel,
  onOpenCustom,
  onOpenSettings,
}: ChordLibraryModalProps) => {
  const resource = useChordCatalog(),
    preferencesState = useChordPreferences();
  // A valid catalog is pinned to this opening, including a first successful retry.
  const [pinnedCatalog, setCatalog] = useState<ChordCatalog | null>(resource.catalog);
  if (!pinnedCatalog && resource.catalog) setCatalog(resource.catalog);
  const catalog = pinnedCatalog ?? resource.catalog;
  const [tab, setTab] = useState<ChordLibraryTab>(initialTab),
    [text, setText] = useState("");
  const [browse, setBrowse] = useState<{
    tonicPc: number;
    tonicSpelling: string;
    mode: "major" | "minor";
  } | null>(null);
  const [rootPc, setRootPc] = useState<number | undefined>(),
    [quality, setQuality] = useState<ChordQuality | undefined>();
  const [selected, setSelected] = useState<Selection | null>(null);
  const [configDraft, setConfig] = useState<ChordPreferencesValue>(() =>
    structuredClone(preferencesState.preferences),
  );
  const [draftBaseRevision, setBaseRevision] = useState(
      preferencesState.preferences.revision,
    ),
    [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null),
    [importPreview, setImportPreview] = useState<ChordImportPreview | null>(
      null,
    );
  const [discardQuarantine, setDiscardQuarantine] = useState(false),
    [composing, setComposing] = useState(false);
  const composition = useMemo(() => createScoreSettingsComposition(setComposing), []);
  const mounted = useRef(true),
    fileRequest = useRef(0),
    configList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const config = dirty ? configDraft : preferencesState.preferences;
  const baseRevision = dirty ? draftBaseRevision : preferencesState.preferences.revision;
  const [selectionDocument, setSelectionDocument] = useState(document);
  if (selectionDocument !== document) {
    setSelectionDocument(document);
    setSelected(null);
  }
  useEffect(() => () => composition.dispose(), [composition]);
  useEffect(() => {
    if (tab === "config" && message?.startsWith("我的常用最多"))
      configList.current?.focus();
  }, [tab, message]);
  const tonality = document
    ? readScoreTonality(document)
    : ({ kind: "unset", title: "曲谱调性未设置" } as const);
  const key =
    browse ?? (tonality.kind === "confirmed" ? tonality.key : undefined);
  const systemEnabled = presetsEnabled && standardChordTuning(tuning);
  const busy = composition.isComposing;
  const conflict =
    dirty && baseRevision !== preferencesState.preferences.revision;
  const query = catalog
    ? queryChordCatalog(catalog, {
        text,
        key: tab === "key" ? key : undefined,
        rootPc: tab === "all" ? rootPc : undefined,
        quality: tab === "all" ? quality : undefined,
      })
    : null;
  const matches =
    tab === "key" && !text.trim() && !key ? [] : (query?.items ?? []);
  const editConfig = (next: ChordPreferencesValue) => {
    if (!dirty) setBaseRevision(preferencesState.preferences.revision);
    setConfig(next);
    setDirty(true);
    setMessage(null);
  };
  const selectMatch = (
    match: ChordCatalogMatch,
    voicingId = match.item.defaultVoicingId,
  ) => {
    if (!catalog || busy()) return;
    const result = selectedCatalogChord(catalog, match, voicingId);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setSelected({
      name: match.name,
      chord: result.chord,
      reference: { identityId: match.item.id, defaultVoicingId: voicingId },
      system: true,
      reason: systemEnabled
        ? null
        : "系统指法仅供标准调弦；可查看示例或另存自定义",
      match,
      voicingId,
    });
  };
  const addQuick = () => {
    if (!selected || busy()) return;
    const index = config.quickItems.findIndex(
      (ref) => ref.identityId === selected.reference.identityId,
    );
    if (index < 0 && config.quickItems.length >= 6) {
      setMessage("我的常用最多 6 项，请先移除一项。");
      setTab("config");
      configList.current?.focus();
      return;
    }
    editConfig({
      ...config,
      quickItems:
        index < 0
          ? [...config.quickItems, selected.reference]
          : config.quickItems.map((ref, i) =>
              i === index ? selected.reference : ref,
            ),
    });
    setMessage("已加入配置草稿，保存常用配置后两处同步。");
  };
  const saveConfig = () => {
    if (busy()) return;
    const result = chordPreferencesStore.save(config, baseRevision, {
      discardQuarantine,
    });
    if (result.ok) {
      setDirty(false);
      setBaseRevision(chordPreferencesStore.getSnapshot().preferences.revision);
      setMessage(
        result.persistence === "browser"
          ? "已保存到此浏览器"
          : "本次会话可用，未保存到浏览器",
      );
    } else setMessage(result.error);
  };
  const selectCustom = (id: string) => {
    const custom = preferencesState.preferences.customVoicings.find(
      (c) => c.id === id,
    );
    if (!custom || busy()) return;
    const reference = {
      identityId: custom.id,
      defaultVoicingId: custom.voicingId,
    };
    const applicable = chordTuningMatches(
      custom.tuning,
      tuning ?? STANDARD_GUITAR_TUNING,
    );
    setSelected({
      name: custom.name,
      chord: { name: custom.name, diagram: structuredClone(custom.diagram) },
      reference,
      system: false,
      reason: applicable ? null : "此收藏的调弦与当前轨道不同",
      voicingId: custom.voicingId,
    });
  };
  const preview = selected?.chord.diagram
    ? layoutChordDiagram(selected.chord.diagram)
    : null;
  const matchButtons = (items: ChordCatalogMatch[]) =>
    items.map((match) => (
      <Button
        key={`${match.item.id}/${match.group ?? "all"}`}
        aria-pressed={
          selected?.reference.identityId === match.item.id &&
          selected.name === match.name
        }
        onClick={() => selectMatch(match)}
      >
        {match.name}
        {match.degree && <small>{match.degree}</small>}
      </Button>
    ));
  const resultList = (
    <div aria-label="和弦候选">
      {tab === "key" && !text.trim() && key && query?.groups.length ? (
        query.groups.map((group) => (
          <section key={group.id}>
            <h4>{group.label}</h4>
            <div className={styles.candidates}>{matchButtons(group.items)}</div>
          </section>
        ))
      ) : (
        <div className={styles.candidates}>{matchButtons(matches)}</div>
      )}
      {catalog && !matches.length && (
        <p>暂无候选。可搜索全部和弦、浏览其他调或查看我的指法。</p>
      )}
    </div>
  );
  const resourceStatus =
    !catalog || resource.status === "error" ? (
      <Alert
        type={resource.status === "error" ? "warning" : "info"}
        showIcon
        title={
          catalog
            ? "更新失败，继续使用已加载的和弦库"
            : resource.status === "error"
              ? "和弦库暂不可用"
              : "和弦库加载中…"
        }
        description={resource.error}
        action={
          resource.status === "error" && (
            <Button
              onClick={() => {
                void chordCatalogResource.retry();
              }}
            >
              重试
            </Button>
          )
        }
      />
    ) : null;
  const browser = (
    <>
      <div className={styles.filters}>
        <Input
          aria-label="库内搜索全部和弦"
          value={text}
          placeholder="搜索全部和弦名称或别名"
          allowClear
          onChange={(e) => {
            setText(e.target.value);
            setSelected(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
        />
        {tab === "all" ? (
          <>
            <Select
              aria-label="筛选根音"
              allowClear
              placeholder="全部根音"
              value={rootPc}
              options={roots.map((name, value) => ({ value, label: name }))}
              onChange={(value) => {
                setRootPc(value);
                setSelected(null);
              }}
            />
            <Select
              aria-label="筛选和弦类型"
              allowClear
              placeholder="全部类型"
              value={quality}
              options={CHORD_QUALITIES.map((value) => ({
                value,
                label: value === "major" ? "大三和弦" : value,
              }))}
              onChange={(value) => {
                setQuality(value);
                setSelected(null);
              }}
            />
          </>
        ) : (
          <>
            <Select
              aria-label="临时浏览主音"
              placeholder="浏览其他调"
              value={browse?.tonicSpelling}
              options={roots.map((name, value) => ({
                value: name,
                label: name,
                pc: value,
              }))}
              onChange={(name, option) => {
                const entry = option as { pc: number };
                setBrowse({
                  tonicPc: entry.pc,
                  tonicSpelling: name,
                  mode: browse?.mode ?? key?.mode ?? "major",
                });
                setSelected(null);
              }}
            />
            <Select
              aria-label="临时浏览大小调"
              disabled={!browse && !key}
              value={browse?.mode ?? key?.mode}
              placeholder="大小调"
              options={[
                { value: "major", label: "大调" },
                { value: "minor", label: "小调" },
              ]}
              onChange={(mode) => {
                if (key) {
                  setBrowse({ ...key, mode });
                  setSelected(null);
                }
              }}
            />
          </>
        )}
      </div>
      {tab === "key" &&
        (browse ? (
          <p className={styles.banner}>
            临时浏览 {browse.tonicSpelling}
            {browse.mode === "major" ? "大调" : "小调"} · {tonality.title}
            <Button
              type="link"
              onClick={() => {
                setBrowse(null);
                setSelected(null);
              }}
            >
              返回本曲谱
            </Button>
          </p>
        ) : (
          <p className={styles.banner}>
            跟随曲谱 · {tonality.title}
            {tonality.kind !== "confirmed" && " · 暂停本调推荐"}
          </p>
        ))}
      <h4>
        {text.trim()
          ? "全部和弦搜索结果"
          : tab === "key"
            ? "本调推荐"
            : "全部和弦"}
      </h4>
      {resourceStatus}
      {!systemEnabled && (
        <p className={styles.help}>
          当前为非标准调弦，系统指法仅供查看；已有指法与自定义编辑仍可使用。
        </p>
      )}
      {resultList}
    </>
  );
  const configContent = (
    <div>
      <p>
        最多六项，可添加、移除与排序。保存后快捷弹窗和侧栏同步，不改变曲谱。
      </p>
      {conflict && (
        <Alert
          type="warning"
          title="其他标签已更新，当前输入已保留"
          description={
            <>
              <details>
                <summary>核对两份常用与收藏</summary>
                {[["当前输入", config], ["其他标签", preferencesState.preferences]].map(([label, raw]) => {
                  const value = raw as ChordPreferencesValue;
                  return <div key={String(label)}><strong>{String(label)}</strong><p>我的常用：{value.quickItems.map((ref) => {
                    const shape = catalog?.items.find((item) => item.id === ref.identityId)?.voicings.find((v) => v.id === ref.defaultVoicingId)?.label;
                    return `${chordReferenceLabel(ref, catalog, value.customVoicings)}${shape ? `（${shape}）` : ""}`;
                  }).join("、") || "无"}</p><p>我的指法：{value.customVoicings.map((v, i) => `${v.name} #${i + 1}`).join("、") || "无"}</p></div>;
                })}
              </details>
              <div className={styles.actions}>
              <Button
                onClick={() => {
                  setConfig(structuredClone(preferencesState.preferences));
                  setBaseRevision(preferencesState.preferences.revision);
                  setDirty(false);
                  setImportPreview(null);
                }}
              >
                加载外部配置
              </Button>
              <Button
                onClick={() => {
                  setBaseRevision(preferencesState.preferences.revision);
                  setImportPreview(null);
                  setMessage("已核对外部更新；点击保存以保留本地输入。");
                }}
              >
                核对并保留本地输入
              </Button>
              </div>
            </>
          }
        />
      )}
      {preferencesState.issues.length > 0 && (
        <Alert
          type="warning"
          title={preferencesState.issues.join("；")}
          description={
            preferencesState.rawBackup ? (
              <>
                <Button
                  onClick={() =>
                    download(
                      "chord-preferences-original.json",
                      preferencesState.rawBackup!,
                    )
                  }
                >
                  导出原始记录
                </Button>
                {preferencesState.status !== "unsupported" && (
                  <Checkbox
                    checked={discardQuarantine}
                    onChange={(event) =>
                      setDiscardQuarantine(event.target.checked)
                    }
                  >
                    已处理隔离项，允许替换
                  </Checkbox>
                )}
              </>
            ) : (
              "可导出当前配置备份。"
            )
          }
        />
      )}
      <div
        ref={configList}
        tabIndex={-1}
        aria-label="常用配置列表"
        className={styles.configList}
      >
        {config.quickItems.map((ref, index) => {
          const resolved = resolveChordReference(
            ref,
            catalog,
            config.customVoicings,
            tuning,
            presetsEnabled,
          );
          return (
            <div key={ref.identityId} className={styles.configRow}>
              <span>
                {index + 1}.{" "}
                {chordReferenceLabel(ref, catalog, config.customVoicings)}
                <small>{resolved.reason}</small>
              </span>
              <Button
                aria-label={`上移第${index + 1}项`}
                disabled={index === 0}
                onClick={() => {
                  const quickItems = [...config.quickItems];
                  [quickItems[index - 1], quickItems[index]] = [
                    quickItems[index]!,
                    quickItems[index - 1]!,
                  ];
                  editConfig({ ...config, quickItems });
                }}
              >
                ↑
              </Button>
              <Button
                aria-label={`下移第${index + 1}项`}
                disabled={index === config.quickItems.length - 1}
                onClick={() => {
                  const quickItems = [...config.quickItems];
                  [quickItems[index + 1], quickItems[index]] = [
                    quickItems[index]!,
                    quickItems[index + 1]!,
                  ];
                  editConfig({ ...config, quickItems });
                }}
              >
                ↓
              </Button>
              <Button
                aria-label={`移除常用${index + 1}`}
                onClick={() =>
                  editConfig({
                    ...config,
                    quickItems: config.quickItems.filter((_, i) => i !== index),
                  })
                }
              >
                移除
              </Button>
            </div>
          );
        })}
        {!config.quickItems.length && (
          <p>暂无常用项；可在“全部”或“我的指法”选择后加入。</p>
        )}
      </div>
      <Button onClick={() => setTab("all")}>从和弦库添加</Button>
      <h4>我的指法 · {config.customVoicings.length}/200</h4>
      {config.customVoicings.map((custom) => (
        <div className={styles.configRow} key={custom.id}>
          <span>
            {custom.name}
            <small>{custom.id}</small>
          </span>
          <Button
            onClick={() =>
              editConfig({
                customVoicings: config.customVoicings.filter(
                  (c) => c.id !== custom.id,
                ),
                quickItems: config.quickItems.filter(
                  (ref) => ref.identityId !== custom.id,
                ),
              })
            }
          >
            移除收藏及常用引用
          </Button>
        </div>
      ))}
      <div className={styles.actions}>
        <Button
          onClick={() =>
            download("chord-preferences.json", chordPreferencesStore.export())
          }
        >
          导出已保存配置
        </Button>
        <label className={styles.file}>
          导入 JSON 预览
          <input
            type="file"
            accept="application/json,.json"
            aria-label="导入和弦配置"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const request = ++fileRequest.current;
              if (file.size > CHORD_IMPORT_LIMIT) {
                setMessage("导入文件不能超过 1 MiB");
                return;
              }
              try {
                const raw = await file.text();
                if (mounted.current && request === fileRequest.current)
                  setImportPreview(chordPreferencesStore.parseImport(raw));
              } catch {
                if (mounted.current && request === fileRequest.current)
                  setMessage("文件读取失败，请重试");
              }
            }}
          />
        </label>
      </div>
      {importPreview && (
        <section className={styles.importPreview} aria-label="导入替换预览">
          <h4>替换本地配置预览</h4>
          <p>
            常用 {importPreview.before.quick} → {importPreview.after.quick}{" "}
            项；我的指法 {importPreview.before.custom} →{" "}
            {importPreview.after.custom} 项。
          </p>
          <p>导入只替换常用和收藏；不会改变曲谱调性。</p>
          {importPreview.issues.map((issue, i) => (
            <p role="alert" key={i}>
              {issue}
            </p>
          ))}
          {importPreview.unresolvedReferences.map((ref) => (
            <p key={ref.identityId}>
              {chordReferenceLabel(ref, catalog, [])}：
              {!catalog
                ? "等待和弦库解析，引用将保留"
                : catalog.items.some(
                      (item) =>
                        item.id === ref.identityId &&
                        item.voicings.some(
                          (v) => v.id === ref.defaultVoicingId,
                        ),
                    )
                  ? "系统引用有效"
                  : "该预置已移除，引用将保留"}
            </p>
          ))}
          <div className={styles.actions}>
            <Button
              disabled={
                !importPreview.ok ||
                composing ||
                importPreview.expectedRevision !==
                  preferencesState.preferences.revision
              }
              onClick={() => {
                if (busy()) return;
                const result = chordPreferencesStore.replaceImport(
                  importPreview,
                  { discardQuarantine },
                );
                if (result.ok) {
                  setImportPreview(null);
                  setDirty(false);
                  setConfig(
                    structuredClone(
                      chordPreferencesStore.getSnapshot().preferences,
                    ),
                  );
                  setBaseRevision(
                    chordPreferencesStore.getSnapshot().preferences.revision,
                  );
                  setMessage(
                    result.persistence === "browser"
                      ? "已替换并保存到此浏览器"
                      : "本次会话可用，未保存到浏览器",
                  );
                } else setMessage(result.error);
              }}
            >
              确认替换本地配置
            </Button>
            <Button onClick={() => setImportPreview(null)}>取消导入</Button>
            <Button
              onClick={() =>
                download(
                  "chord-import-report.json",
                  JSON.stringify(
                    {
                      issues: importPreview.issues,
                      unresolvedReferences: importPreview.unresolvedReferences,
                    },
                    null,
                    2,
                  ),
                )
              }
            >
              导出问题报告
            </Button>
          </div>
          {importPreview.expectedRevision !==
            preferencesState.preferences.revision && (
            <p role="alert">其他标签已更新，请重新导入并核对预览。</p>
          )}
        </section>
      )}
    </div>
  );
  return (
    <div
      className={styles.library}
      onCompositionStart={composition.start}
      onCompositionEnd={composition.end}
      onKeyDown={(event) => {
        composition.observeKey(event.nativeEvent);
        if (event.key !== "Tab" && event.key !== "Escape") event.stopPropagation();
        if (event.repeat && ["Enter", " ", "Escape"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation(); return;
        }
        if (
          (event.key === "Enter" || event.key === "Escape") &&
          (busy() ||
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229)
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <div className={styles.source}>
        <strong>{tonality.title}</strong>
        <span>
          {document?.score.keySignature
            ? `1=${document.score.keySignature}`
            : "简谱基准未设置"}
        </span>
        <Button
          type="link"
          disabled={!onOpenSettings || composing}
          onClick={() => {
            if (!busy()) onOpenSettings?.();
          }}
        >
          设置曲谱调性
        </Button>
      </div>
      <Tabs
        activeKey={tab}
        onChange={(value) => setTab(value as ChordLibraryTab)}
        items={[
          { key: "key", label: "按调性" },
          { key: "all", label: "全部" },
          { key: "mine", label: "我的指法" },
          { key: "config", label: "常用配置" },
        ]}
      />
      <div className={styles.scroll}>
        {message && (
          <p role="status" className={styles.banner}>
            {message}
          </p>
        )}
        {tab === "config" ? (
          configContent
        ) : (
          <div className={styles.workspace}>
            <div className={styles.browse}>
              {tab === "mine" ? (
                <>
                  <p>收藏保存完整指法；同名收藏可分别选用。</p>
                  <div className={styles.candidates}>
                    {preferencesState.preferences.customVoicings.map(
                      (custom, i) => (
                        <Button
                          key={custom.id}
                          aria-pressed={
                            selected?.reference.identityId === custom.id
                          }
                          onClick={() => selectCustom(custom.id)}
                        >
                          {custom.name}
                          <small>#{i + 1}</small>
                        </Button>
                      ),
                    )}
                  </div>
                  {!preferencesState.preferences.customVoicings.length && (
                    <p>还没有收藏，可从自定义编辑中存入我的指法。</p>
                  )}
                </>
              ) : (
                browser
              )}
            </div>
            <aside className={styles.detail} aria-label="当前选择详情">
              {selected ? (
                <>
                  <h3>{selected.name}</h3>
                  {selected.match && (
                    <Select
                      aria-label="选择指法版本"
                      value={selected.voicingId}
                      options={selected.match.item.voicings.map((v) => ({
                        value: v.id,
                        label: v.label,
                      }))}
                      onChange={(id) => selectMatch(selected.match!, id)}
                    />
                  )}
                  {preview && (
                    <svg
                      role="img"
                      aria-label={`${selected.name}指法预览`}
                      width={150}
                      height={180}
                      viewBox={`${preview.bounds.x - 5} ${preview.bounds.y - 5} ${preview.bounds.width + 10} ${preview.bounds.height + 10}`}
                    >
                      <ChordDiagramView diagram={preview} />
                    </svg>
                  )}
                  <p className={styles.help}>
                    起始 {selected.chord.diagram?.startFret} 品 · × 禁奏 · ○
                    空弦
                  </p>
                  {selected.reason && <p role="status">{selected.reason}</p>}
                  <div className={styles.actions}>
                    <Button onClick={addQuick} disabled={composing}>
                      加入我的常用
                    </Button>
                    <Button
                      disabled={!onOpenCustom || composing}
                      onClick={() => {
                        if (!busy())
                          onOpenCustom?.({
                            ...draft,
                            chord: structuredClone(selected.chord),
                          });
                      }}
                    >
                      基于此指法自定义
                    </Button>
                  </div>
                  <p className={styles.help}>
                    当前仅选择预览，选用后回填草稿。
                    {draft.display === "name" &&
                      "指法将保留，谱面当前仅显示名称。"}
                  </p>
                </>
              ) : (
                <p>选择一个和弦查看指法；尚未改变当前草稿。</p>
              )}
            </aside>
          </div>
        )}
      </div>
      <footer className={styles.footer}>
        <span className={styles.help}>
          {tab === "config"
            ? dirty
              ? "配置尚未保存"
              : "配置与和弦草稿独立保存"
            : "选用只回填草稿，应用和弦后才写入谱面。"}
        </span>
        <Button
          disabled={composing}
          onClick={() => {
            if (!busy()) onCancel();
          }}
        >
          取消
        </Button>
        {tab === "config" ? (
          <Button
            type="primary"
            disabled={!dirty || conflict || composing}
            onClick={saveConfig}
          >
            保存常用配置
          </Button>
        ) : (
          <Button
            type="primary"
            disabled={!selected || !!selected.reason || composing}
            onClick={() => {
              if (selected && !selected.reason && !busy())
                onConfirm({ ...draft, chord: structuredClone(selected.chord) });
            }}
          >
            选用此指法
          </Button>
        )}
      </footer>
    </div>
  );
};
