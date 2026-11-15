import { Alert, Button, Input, Select } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CHORD_QUALITIES, queryChordCatalog, readScoreTonality, STANDARD_GUITAR_TUNING,
  type ChordCatalog, type ChordCatalogKey, type ChordCatalogMatch, type ChordQuality,
} from "@liuxianmao/lxm-editor";
import { ChordDiagramPreview, type ChordDraft } from "./ChordEditor";
import { chordCatalogResource } from "./chord-catalog-resource";
import { useChordPreferences } from "./chord-preferences";
import {
  chordTuningMatches, selectedCatalogChord, standardChordTuning, useChordCatalog,
  type ChordEditorLibraryProps, type ChordLibraryTab,
} from "./ChordPresetControls";
import { createScoreSettingsComposition } from "../settings/score-settings-composition";
import { recommendedVoicing } from "./chord-recommendations";
import styles from "./ChordLibraryModal.module.scss";

export interface ChordLibraryModalProps extends Omit<ChordEditorLibraryProps, "onOpenCustom"> {
  draft: ChordDraft;
  presetsEnabled: boolean;
  initialTab?: ChordLibraryTab;
  onConfirm: (next: ChordDraft) => void;
  onCancel: () => void;
  onOpenCustom?: (seed: ChordDraft) => void;
}
const roots = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const qualityLabels: Partial<Record<ChordQuality, string>> = {
  major: "大三和弦", m: "小三和弦", "7": "属七和弦", maj7: "大七和弦", m7: "小七和弦",
  dim: "减三和弦", dim7: "减七和弦", m7b5: "半减七和弦", aug: "增三和弦",
  sus2: "挂二和弦", sus4: "挂四和弦", add9: "加九和弦",
};
const diagramKey = (diagram: ChordDraft["chord"]["diagram"]) => diagram && JSON.stringify({
  startFret: diagram.startFret, fretCount: diagram.fretCount,
  strings: [...diagram.strings].sort((a, b) => a.string - b.string).map(s => [s.string, s.fret, s.finger ?? null]),
  barres: [...(diagram.barres ?? [])].map(b => [b.fret, b.minString, b.maxString, b.finger ?? null]).sort(),
});
const fretCaption = (diagram: NonNullable<ChordDraft["chord"]["diagram"]>) => [...diagram.strings]
  .sort((a, b) => b.string - a.string).map(s => s.fret === "x" ? "×" : s.fret).join(" · ");
type Selection = {
  name: string;
  chord: ChordDraft["chord"];
  identityId: string;
  voicingId: string;
  reason: string | null;
  match?: ChordCatalogMatch;
};

/** The Runtime owns the transaction and Modal; selection here only stages a draft. */
export const ChordLibraryModal = ({
  draft, document, tuning, presetsEnabled, initialTab = "all", onConfirm, onCancel, onOpenCustom, onOpenSettings,
}: ChordLibraryModalProps) => {
  const resource = useChordCatalog();
  const { preferences } = useChordPreferences();
  const [pinnedCatalog, setCatalog] = useState<ChordCatalog | null>(resource.catalog);
  if (!pinnedCatalog && resource.catalog) setCatalog(resource.catalog);
  const catalog = pinnedCatalog ?? resource.catalog;
  const [tab, setTab] = useState<ChordLibraryTab>(initialTab);
  const [text, setText] = useState("");
  const [browse, setBrowse] = useState<ChordCatalogKey | null>(null);
  const [rootPc, setRootPc] = useState<number | undefined>();
  const [quality, setQuality] = useState<ChordQuality | undefined>();
  const [selected, setSelected] = useState<Selection | null>(null);
  const [seededCatalog, setSeededCatalog] = useState<ChordCatalog | null>(null);
  const [selectionDocument, setSelectionDocument] = useState(document);
  const [composing, setComposing] = useState(false);
  const composition = useMemo(() => createScoreSettingsComposition(setComposing), []);
  useEffect(() => () => composition.dispose(), [composition]);
  if (selectionDocument !== document) {
    setSelectionDocument(document);
    setSelected(null);
  }
  const busy = composition.isComposing;
  const tonality = document ? readScoreTonality(document) : ({ kind: "unset", title: "曲谱调性未设置" } as const);
  const key = browse ?? (tonality.kind === "confirmed" ? tonality.key : undefined);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { if (list.current) list.current.scrollTop = 0; }, [tab, text, rootPc, quality, key?.tonicSpelling, key?.mode]);
  const systemEnabled = presetsEnabled && standardChordTuning(tuning);
  const systemReason = systemEnabled ? null : "系统指法仅供标准调弦；可查看示例或另存自定义";
  // Preserve an exact non-default voicing. Catalog retries cannot replace later choices.
  if (catalog && !seededCatalog) {
    setSeededCatalog(catalog);
    const custom = preferences.customVoicings.find(c => c.name === draft.chord.name && diagramKey(c.diagram) === diagramKey(draft.chord.diagram));
    if (custom) setSelected({
      name: custom.name, chord: structuredClone(draft.chord), identityId: custom.id, voicingId: custom.voicingId,
      reason: chordTuningMatches(custom.tuning, tuning ?? STANDARD_GUITAR_TUNING) ? null : "此收藏的调弦与当前轨道不同",
    });
    else if (draft.chord.diagram) {
      const match = queryChordCatalog(catalog, { text: draft.chord.name }).items.find(m =>
        m.name === draft.chord.name && m.item.voicings.some(v => diagramKey(v.diagram) === diagramKey(draft.chord.diagram)));
      const voicing = match?.item.voicings.find(v => diagramKey(v.diagram) === diagramKey(draft.chord.diagram));
      if (match && voicing) setSelected({ name: match.name, chord: structuredClone(draft.chord), identityId: match.item.id, voicingId: voicing.id, match, reason: systemReason });
    }
  }
  const selectMatch = (match: ChordCatalogMatch, voicingId = recommendedVoicing(match).id) => {
    if (!catalog || busy()) return;
    const result = selectedCatalogChord(catalog, match, voicingId);
    if (result.ok) setSelected({ name: match.name, chord: result.chord, identityId: match.item.id, voicingId, match, reason: systemReason });
  };
  const query = catalog ? queryChordCatalog(catalog, { text, rootPc, quality }) : null;
  const tonal = catalog && key ? queryChordCatalog(catalog, { key }) : null;
  const classified = !text.trim() && rootPc === undefined && quality === undefined;
  const tonalGroups = tonal?.groups.flatMap(group => group.id === "natural" ? [
    { id: "triads", label: `${key?.tonicSpelling} ${key?.mode === "major" ? "大调" : "小调"} · 自然三和弦`, items: group.items.filter(m => ["major", "m", "dim"].includes(m.item.quality)) },
    { id: "sevenths", label: "七和弦", items: group.items.filter(m => !["major", "m", "dim"].includes(m.item.quality)) },
  ] : [group]) ?? [];
  const classifiedIds = new Set(tonal?.items.map(m => m.item.id));
  const groups = classified ? [
    ...tonalGroups,
    { id: "other", label: key ? "其他和弦" : "全部和弦", items: (query?.items ?? []).filter(m => !classifiedIds.has(m.item.id)) },
  ] : [{ id: "search", label: "全部和弦搜索结果", items: query?.items ?? [] }];
  const customs = preferences.customVoicings.filter(c => !text.trim() || c.name.toLowerCase().includes(text.trim().toLowerCase()));
  const cards = (items: ChordCatalogMatch[]) => items.map(match => <Button
    key={`${match.item.id}/${match.group ?? "all"}`} className={styles.chordCard}
    aria-pressed={selected?.identityId === match.item.id && selected.name === match.name}
    disabled={composing} onClick={() => selectMatch(match)}
  >
    <ChordDiagramPreview diagram={recommendedVoicing(match).diagram} width={62} height={74} />
    <b>{match.name}</b><span className={styles.degree}>{match.degree ?? "标准调弦"}</span>
  </Button>);
  const setBrowseKey = (value: ChordCatalogKey) => { if (!busy()) { setBrowse(value); } };
  return <div className={styles.library}
    onCompositionStart={composition.start} onCompositionEnd={composition.end}
    onKeyDown={event => {
      composition.observeKey(event.nativeEvent);
      if (event.key !== "Tab" && event.key !== "Escape") event.stopPropagation();
      if ((event.repeat && ["Enter", " ", "Escape"].includes(event.key)) ||
        (["Enter", "Escape"].includes(event.key) && (busy() || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229))) {
        event.preventDefault(); event.stopPropagation();
      }
    }}>
    <div className={styles.scroll}>
      <div className={styles.segmented} role="tablist" aria-label="和弦库分类">
        {([["all", "全部和弦"], ["mine", "我的指法"]] as const).map(([value, label]) => <Button
          key={value} role="tab" id={`chord-library-tab-${value}`} aria-controls="chord-library-panel"
          aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} disabled={composing}
          onClick={() => { if (!busy()) { setTab(value); setText(""); } }}
          onKeyDown={event => {
            if (busy() || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? "all" : event.key === "End" ? "mine" : tab === "all" ? "mine" : "all";
            setTab(next); setText("");
            globalThis.document.getElementById(`chord-library-tab-${next}`)?.focus();
          }}
        >{label}</Button>)}
      </div>
      <div className={styles.filters}>
        <Input aria-label={tab === "mine" ? "搜索我的指法" : "库内搜索全部和弦"} placeholder="搜索和弦名称，如 F#m7"
          value={text} allowClear onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} />
        {tab === "all" && <>
          <Select aria-label="筛选根音" allowClear placeholder="全部根音" value={rootPc}
            options={roots.map((name, value) => ({ value, label: name }))} onChange={setRootPc} />
          <Select aria-label="筛选和弦类型" allowClear placeholder="全部类型" value={quality}
            options={CHORD_QUALITIES.map(value => ({ value, label: qualityLabels[value] ?? value }))} onChange={setQuality} />
        </>}
      </div>
      {tab === "all" && <div className={styles.tonalityBrowser}>
        <span>按调性浏览</span>
        <Select aria-label="临时浏览主音" placeholder="主音" value={key?.tonicSpelling}
          options={roots.map((name, pc) => ({ value: name, label: name, pc }))}
          onChange={(name, option) => setBrowseKey({ tonicPc: (option as { pc: number }).pc, tonicSpelling: name, mode: key?.mode ?? "major" })} />
        <Select aria-label="临时浏览大小调" value={key?.mode} placeholder="大小调" disabled={!key}
          options={[{ value: "major", label: "大调" }, { value: "minor", label: "小调" }]}
          onChange={mode => { if (key) setBrowseKey({ ...key, mode }); }} />
        <span className={styles.help}>{tonality.title}</span>
        {browse && <Button type="link" disabled={composing} onClick={() => { if (!busy()) setBrowse(null); }}>跟随曲谱</Button>}
        {tonality.kind !== "confirmed" && <Button type="link" disabled={composing || !onOpenSettings} onClick={() => { if (!busy()) onOpenSettings?.(); }}>设置曲谱调性</Button>}
      </div>}
      <div id="chord-library-panel" className={styles.workspace} role="tabpanel" aria-labelledby={`chord-library-tab-${tab}`}>
        <div ref={list} className={styles.browse} data-testid="chord-library-scroll">
          {(!catalog || resource.status === "error") && <Alert type={resource.status === "error" ? "warning" : "info"}
            title={catalog ? "更新失败，继续使用已加载的和弦库" : resource.status === "error" ? "和弦库暂不可用" : "和弦库加载中…"}
            description={resource.error} action={resource.status === "error" && <Button disabled={composing} onClick={() => { void chordCatalogResource.retry(); }}>重试</Button>} />}
          {tab === "all" ? <div aria-label="和弦候选">
            {tonality.kind !== "confirmed" && !browse && <p className={styles.help}>大小调未确认，暂停本调推荐；可浏览全部和弦或临时选择调性。</p>}
            {!systemEnabled && <p className={styles.help}>当前为非标准调弦，系统指法仅供查看。</p>}
            {groups.filter(group => group.items.length).map(group => <section className={styles.resultSection} key={group.id}>
              <div className={styles.sectionHeading}><h4>{group.label}</h4><span className={styles.help}>{group.items.length} 项</span></div>
              <div className={styles.candidates}>{cards(group.items)}</div>
            </section>)}
            {catalog && !query?.items.length && <p className={styles.empty}>没有匹配的和弦，请更换搜索条件。</p>}
          </div> : <>
            <div className={styles.sectionHeading}><h4>我的指法</h4><span className={styles.help}>{customs.length} 项</span></div>
            <div className={styles.candidates}>{customs.map(custom => <Button key={custom.id} className={styles.chordCard}
              aria-pressed={selected?.identityId === custom.id} disabled={composing} onClick={() => {
                if (!busy()) setSelected({ name: custom.name, chord: { name: custom.name, diagram: structuredClone(custom.diagram) },
                  identityId: custom.id, voicingId: custom.voicingId,
                  reason: chordTuningMatches(custom.tuning, tuning ?? STANDARD_GUITAR_TUNING) ? null : "此收藏的调弦与当前轨道不同" });
              }}>
              <ChordDiagramPreview diagram={custom.diagram} width={62} height={74} /><b>{custom.name}</b><span className={styles.degree}>我的指法</span>
            </Button>)}</div>
            {!customs.length && <p className={styles.empty}>{text.trim() ? "没有匹配的指法。" : "还没有保存的指法。可在“自定义指法”中另存。"}</p>}
          </>}
        </div>
        <aside className={styles.detail} aria-label="当前选择详情" data-testid="chord-library-detail">
          {selected ? <>
            <div className={styles.detailHeading}><h3>{selected.name}</h3><span className={styles.tag}>{selected.match ? "标准调弦" : "我的指法"}</span></div>
            <ChordDiagramPreview diagram={selected.chord.diagram} width={104} height={126} />
            <h4>指法版本</h4>
            <div className={styles.variations} aria-label="选择指法版本">
              {selected.match ? selected.match.item.voicings.map(voicing => <Button key={voicing.id} className={styles.variation}
                aria-pressed={selected.voicingId === voicing.id} disabled={composing} onClick={() => selectMatch(selected.match!, voicing.id)}>
                <b>{voicing.label}</b><span>{fretCaption(voicing.diagram)} ／ 6 → 1 弦</span>
              </Button>) : selected.chord.diagram && <div className={styles.variation} aria-current="true"><b>我的指法</b><span>{fretCaption(selected.chord.diagram)} ／ 6 → 1 弦</span></div>}
            </div>
            {selected.reason && <p role="status">{selected.reason}</p>}
            <Button type="link" disabled={!onOpenCustom || composing} onClick={() => { if (!busy()) onOpenCustom?.({ ...draft, chord: structuredClone(selected.chord) }); }}>基于此指法自定义</Button>
          </> : <p>选择一个和弦查看指法；尚未改变当前草稿。</p>}
        </aside>
      </div>
    </div>
    <footer className={styles.footer}>
      <span className={styles.help}>选用只回填草稿，应用和弦后才写入谱面。</span>
      <Button disabled={composing} onClick={() => { if (!busy()) onCancel(); }}>取消</Button>
      <Button type="primary" disabled={!selected || !!selected.reason || composing} onClick={() => {
        if (selected && !selected.reason && !busy()) onConfirm({ ...draft, chord: structuredClone(selected.chord) });
      }}>选用此指法</Button>
    </footer>
  </div>;
};
