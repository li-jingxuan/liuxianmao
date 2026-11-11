import { Button, Dropdown, Input } from "antd";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import {
  copyCatalogVoicing,
  queryChordCatalog,
  readScoreTonality,
  STANDARD_GUITAR_TUNING,
  type ChordCatalog,
  type ChordCatalogMatch,
  type ILXMDocument,
} from "@liuxianmao/lxm-editor";
import type { ChordDraft } from "./ChordEditor";
import { chordCatalogResource } from "./chord-catalog-resource";
import {
  useChordPreferences,
  type ChordQuickReference,
  type CustomChordVoicing,
} from "./chord-preferences";
import styles from "./ChordPresetControls.module.scss";
import { createScoreSettingsComposition } from "../settings/score-settings-composition";

export type ChordLibraryTab = "key" | "all" | "mine" | "config";
export interface ChordEditorLibraryProps {
  /** The committed Runtime document, never the score-settings draft. */
  document?: ILXMDocument;
  tuning?: readonly { pitch: string; midi: number; index?: number }[];
  onOpenLibrary?: (tab?: ChordLibraryTab, seed?: ChordDraft) => void;
  onOpenCustom?: (seed?: ChordDraft) => void;
  onOpenSettings?: () => void;
  showChordDiagrams?: boolean;
  /** Only the compact entry shows tuning instead of the configuration shortcut. */
  presentation?: "quick" | "sidebar";
}
export const chordTuningMatches = (
  left: readonly { pitch: string; midi: number }[],
  right: readonly { pitch: string; midi: number }[],
) =>
  left.length === 6 &&
  right.length === 6 &&
  left.every(
    (s, i) => s.pitch === right[i]?.pitch && s.midi === right[i]?.midi,
  );
export const standardChordTuning = (
  tuning?: ChordEditorLibraryProps["tuning"],
) =>
  !tuning ||
  (chordTuningMatches(tuning, STANDARD_GUITAR_TUNING) &&
    tuning.every((s, i) => s.index === undefined || s.index === i + 1));
export const chordReferenceLabel = (
  ref: ChordQuickReference,
  catalog: ChordCatalog | null,
  customs: CustomChordVoicing[],
) => {
  if (ref.identityId.startsWith("user:"))
    return customs.find((c) => c.id === ref.identityId)?.name ?? "收藏已移除";
  const item = catalog?.items.find((item) => item.id === ref.identityId);
  if (item) return item.name;
  const match = /^pc:(\d+)\/(.+)$/.exec(ref.identityId);
  return match
    ? `${["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][Number(match[1])]}${match[2] === "major" ? "" : match[2]}`
    : ref.identityId;
};
export const resolveChordReference = (
  ref: ChordQuickReference,
  catalog: ChordCatalog | null,
  customs: CustomChordVoicing[],
  tuning: ChordEditorLibraryProps["tuning"],
  presetsEnabled: boolean,
): { chord: ChordDraft["chord"] | null; reason: string | null } => {
  if (ref.identityId.startsWith("user:")) {
    const custom = customs.find(
      (c) => c.id === ref.identityId && c.voicingId === ref.defaultVoicingId,
    );
    if (!custom) return { chord: null, reason: "该收藏引用已移除" };
    if (!chordTuningMatches(custom.tuning, tuning ?? STANDARD_GUITAR_TUNING))
      return { chord: null, reason: "此收藏的调弦与当前轨道不同" };
    return {
      chord: { name: custom.name, diagram: structuredClone(custom.diagram) },
      reason: null,
    };
  }
  if (!catalog) return { chord: null, reason: "等待和弦库，暂不可用" };
  const result = copyCatalogVoicing(
    catalog,
    ref.identityId,
    ref.defaultVoicingId,
  );
  if (!result.ok) return { chord: null, reason: "该预置已移除" };
  if (!presetsEnabled || !standardChordTuning(tuning))
    return { chord: null, reason: "系统指法仅供标准调弦，可查看详情" };
  return { chord: result.chord, reason: null };
};
export const selectedCatalogChord = (
  catalog: ChordCatalog,
  match: ChordCatalogMatch,
  voicingId = match.item.defaultVoicingId,
) => {
  const spelling = /^([A-G](?:#+|b+)?)/.exec(match.name)?.[1];
  return copyCatalogVoicing(catalog, match.item.id, voicingId, spelling);
};
export const useChordCatalog = () => {
  const snapshot = useSyncExternalStore(
    chordCatalogResource.subscribe,
    chordCatalogResource.getSnapshot,
    chordCatalogResource.getSnapshot,
  );
  useEffect(() => {
    void chordCatalogResource.ensureLoaded();
  }, []);
  return snapshot;
};
export interface ChordPresetControlsProps extends ChordEditorLibraryProps {
  draft: ChordDraft;
  onChange: (draft: ChordDraft) => void;
  presetsEnabled: boolean;
  disabled?: boolean;
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
}
export const ChordPresetControls = ({
  draft,
  onChange,
  document,
  tuning,
  presetsEnabled,
  disabled = false,
  menuOpen,
  onMenuOpenChange,
  onOpenLibrary,
  onOpenSettings,
  presentation = "sidebar",
}: ChordPresetControlsProps) => {
  const resource = useChordCatalog(),
    { preferences } = useChordPreferences();
  const [open, setOpen] = useState(false),
    [text, setText] = useState(""),
    [protectedInput, setProtectedInput] = useState(false);
  const [popupHeight, setPopupHeight] = useState(560);
  const [placement, setPlacement] = useState<"bottomRight" | "topRight">("bottomRight");
  const search = useRef<import("antd").InputRef>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const composition = useMemo(
    () => createScoreSettingsComposition(setProtectedInput),
    [],
  );
  useEffect(() => () => composition.dispose(), [composition]);
  const protectActivation = (event: KeyboardEvent<HTMLElement>) => {
    composition.observeKey(event.nativeEvent);
    if (
      (event.key === "Enter" || event.key === " " || event.key === "Escape") &&
      (event.repeat || composition.isComposing())
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const active = menuOpen ?? open;
  const changeOpen = (value: boolean) => {
    if (value && trigger.current) {
      const rect = trigger.current.getBoundingClientRect();
      const below = globalThis.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const downward = below >= 300 || below >= above;
      setPlacement(downward ? "bottomRight" : "topRight");
      setPopupHeight(Math.max(160, Math.min(560, downward ? below : above)));
    }
    setOpen(value);
    onMenuOpenChange?.(value);
    if (!value) setText("");
  };
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => search.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [active]);
  const tonality = document
    ? readScoreTonality(document)
    : ({ kind: "unset", title: "曲谱调性未设置" } as const);
  const catalog = resource.catalog;
  const unavailable = preferences.quickItems.flatMap((ref) => {
    const result = resolveChordReference(
      ref,
      catalog,
      preferences.customVoicings,
      tuning,
      presetsEnabled,
    );
    return result.reason && !result.reason.startsWith("等待")
      ? [
          `${chordReferenceLabel(ref, catalog, preferences.customVoicings)}：${result.reason}`,
        ]
      : [];
  });
  const results =
    catalog && (text.trim() || tonality.kind === "confirmed")
      ? queryChordCatalog(catalog, {
          text,
          key: tonality.kind === "confirmed" ? tonality.key : undefined,
        })
      : null;
  const choose = (chord: ChordDraft["chord"]) => {
    if (disabled || composition.isComposing()) return;
    onChange({ ...draft, chord });
    changeOpen(false);
  };
  const openLibrary = (tab: ChordLibraryTab, seed?: ChordDraft) => {
    if (disabled || composition.isComposing()) return;
    changeOpen(false);
    if (seed) onOpenLibrary?.(tab, seed);
    else onOpenLibrary?.(tab);
  };
  const rows = (items: ChordCatalogMatch[]) =>
    items.map((match) => (
      <div
        className={styles.candidate}
        key={`${match.item.id}/${match.group ?? "all"}`}
      >
        <Button
          disabled={
            disabled ||
            protectedInput ||
            !presetsEnabled ||
            !standardChordTuning(tuning)
          }
          title={
            !presetsEnabled || !standardChordTuning(tuning)
              ? "系统指法仅供标准调弦"
              : undefined
          }
          onClick={() => {
            const result = selectedCatalogChord(catalog!, match);
            if (result.ok) choose(result.chord);
          }}
        >
          {match.name}
          {match.degree && <small>{match.degree}</small>}
        </Button>
        {(!presetsEnabled || !standardChordTuning(tuning)) && (
          <Button
            type="link"
            disabled={!onOpenLibrary}
            onClick={() => {
              const result = selectedCatalogChord(catalog!, match);
              if (result.ok) openLibrary("all", { ...draft, chord: result.chord });
            }}
          >
            查看详情
          </Button>
        )}
      </div>
    ));
  return (
    <section
      className={styles.controls}
      aria-label="我的常用"
      onKeyDownCapture={protectActivation}
    >
      <div className={styles.heading}>
        <h3>常用和弦</h3>
        {presentation === "quick" ? <span>{presetsEnabled ? "标准调弦" : "自定义调弦"}</span> : (
          <Button type="link" disabled={disabled || protectedInput || !onOpenLibrary} onClick={() => openLibrary("config")}>配置</Button>
        )}
      </div>
      <div className={styles.row} role="group" aria-label="我的常用和弦">
        <div className={styles.quick}>
          {preferences.quickItems.map((ref) => {
            const resolved = resolveChordReference(
              ref,
              catalog,
              preferences.customVoicings,
              tuning,
              presetsEnabled,
            );
            const selected =
              resolved.chord &&
              JSON.stringify(resolved.chord) === JSON.stringify(draft.chord);
            return (
              <Button
                key={ref.identityId}
                disabled={disabled || protectedInput || !resolved.chord}
                title={resolved.reason ?? undefined}
                aria-pressed={!!selected}
                onClick={() => {
                  if (resolved.chord) choose(resolved.chord);
                }}
              >
                {chordReferenceLabel(ref, catalog, preferences.customVoicings)}
              </Button>
            );
          })}
        </div>
        <Dropdown
          autoFocus
          destroyOnHidden
          placement={placement}
          open={active}
          onOpenChange={changeOpen}
          disabled={disabled}
          trigger={["click"]}
          popupRender={() => (
            <div
               className={styles.popup}
               style={{ maxHeight: popupHeight }}
              onKeyDownCapture={protectActivation}
              onCompositionStart={composition.start}
              onCompositionEnd={composition.end}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (composition.isComposing()) {
                  if (event.key === "Enter" || event.key === "Escape")
                    event.preventDefault();
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  changeOpen(false);
                  trigger.current?.focus();
                }
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const controls = [
                    ...event.currentTarget.querySelectorAll<HTMLElement>(
                      "input,button:not(:disabled)",
                    ),
                  ];
                  const index = controls.indexOf(
                      globalThis.document.activeElement as HTMLElement,
                    ),
                    delta = event.key === "ArrowDown" ? 1 : -1;
                  controls[
                    (index + delta + controls.length) % controls.length
                  ]?.focus();
                }
              }}
            >
               <Input
                 autoFocus
                 ref={search}
                 className={styles.search}
                 aria-label="搜索全部和弦"
                 placeholder="搜索全部和弦，如 Bm、G7"
                 value={text}
                 allowClear
                 onChange={(event) => setText(event.target.value)}
                 onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
               />
               <div className={styles.keySource}>
               <strong>{tonality.title}</strong>
               <Button type="link" disabled={!onOpenSettings || disabled || protectedInput} onClick={() => {
                 if (disabled || composition.isComposing()) return;
                 changeOpen(false); onOpenSettings?.();
               }}>设置调性</Button>
               </div>
              {document && (
                <p className={styles.help}>
                   {text.trim() ? "曲谱基准 · " : "本调推荐 · "}
                  {document.score.keySignature
                    ? `1=${document.score.keySignature}`
                    : "未设置"}
                  {tonality.kind === "confirmed" &&
                  tonality.tonality.mode === "minor" &&
                  tonality.tonality.minorTonicDegree === 6
                    ? ` · 6=${tonality.tonality.tonic}`
                    : ""}
                </p>
              )}
              <div className={styles.results}>
                 {resource.status === "error" && <p className={styles.loadError} role="status">
                   {catalog ? "更新失败，继续使用已加载的和弦库。" : "和弦库暂不可用，可重试或使用收藏。"}
                   <Button type="link" disabled={disabled || protectedInput} onClick={() => { void chordCatalogResource.retry(); }}>重试</Button>
                 </p>}
                 {text.trim() && <p className={styles.groupTitle}>搜索结果 · 全部和弦</p>}
                {!catalog ? (
                  <p>
                    {resource.status === "error"
                      ? "和弦库暂不可用"
                      : "和弦库加载中…"}
                  </p>
                ) : !text.trim() && tonality.kind !== "confirmed" ? (
                   <p>确认曲谱调性后显示本调推荐。可先搜索全部和弦，或使用我的常用。</p>
                ) : results?.groups.length ? (
                  results.groups.map((group) => (
                     <section key={group.id}>
                       <p className={styles.groupTitle}>{group.id === "natural" ? "调内三和弦与七和弦" : group.label}</p>
                      <div className={styles.candidates}>
                        {rows(group.items)}
                      </div>
                    </section>
                  ))
                ) : (
                  <div className={styles.candidates}>
                    {rows(results?.items ?? [])}
                    {!results?.items.length && (
                      <p>没有匹配项，可清空搜索或浏览完整库。</p>
                    )}
                  </div>
                )}
                {(!presetsEnabled || !standardChordTuning(tuning)) && (
                  <p className={styles.help}>
                    系统指法仅供标准调弦，选用已暂停。
                  </p>
                )}
              </div>
              <div className={styles.actions}>
                 <Button
                   type="link"
                  disabled={!onOpenLibrary || disabled || protectedInput}
                  onClick={() => openLibrary("key")}
                >
                   浏览完整和弦库 →
                </Button>
                 <Button
                   type="link"
                  disabled={!onOpenLibrary || disabled || protectedInput}
                  onClick={() => openLibrary("config")}
                >
                   配置常用
                </Button>
              </div>
            </div>
          )}
        >
          <Button
            ref={trigger}
            className={styles.more}
            disabled={disabled}
            aria-label="更多和弦"
            aria-expanded={active}
          >
            更多 ⌄
          </Button>
        </Dropdown>
      </div>
      {unavailable.length > 0 && (
        <p className={styles.help}>{unavailable.join("；")}</p>
      )}
      {resource.status !== "ready" && (
        <div className={styles.help} role="status">
          {catalog
            ? (resource.error ?? "正在检查和弦库更新…")
            : resource.status === "error"
              ? "和弦库暂不可用；收藏与自定义仍可使用"
              : "和弦库加载中…"}
          {resource.status === "error" && (
            <Button
              type="link"
              disabled={disabled}
              onClick={() => {
                if (disabled || composition.isComposing()) return;
                void chordCatalogResource.retry();
              }}
            >
              重试
            </Button>
          )}
        </div>
      )}
    </section>
  );
};
