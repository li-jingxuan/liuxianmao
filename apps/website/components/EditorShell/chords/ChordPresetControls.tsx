import { RightOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useEffect, useSyncExternalStore } from "react";
import {
  copyCatalogVoicing,
  parseSpelledTonic,
  readScoreTonality,
  semanticJsonEqual,
  STANDARD_GUITAR_TUNING,
  type ChordCatalog,
  type ChordCatalogMatch,
  type ILXMDocument,
  type ScoreTonalityContext,
} from "@liuxianmao/lxm-editor";
import type { ChordDraft } from "./ChordEditor";
import { chordCatalogResource } from "./chord-catalog-resource";
import type { ChordQuickReference, CustomChordVoicing } from "./chord-preferences";
import styles from "./ChordPresetControls.module.scss";
import { ChordRecommendationTile } from "./ChordRecommendationTile";
import { quickChordMatches, recommendedVoicing } from "./chord-recommendations";

export type ChordLibraryTab = "all" | "mine";
export interface ChordEditorLibraryProps {
  /** The committed Runtime document, never the score-settings draft. */
  document?: ILXMDocument;
  tuning?: readonly { pitch: string; midi: number; index?: number }[];
  onOpenLibrary?: (opener: HTMLElement) => void;
  onOpenCustom?: (seed?: ChordDraft) => void;
  onOpenSettings?: () => void;
  showChordDiagrams?: boolean;
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
  voicingId = recommendedVoicing(match).id,
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

const recommendationKey = (document?: ILXMDocument): ScoreTonalityContext | null => {
  if (!document) return null;
  const tonality = readScoreTonality(document);
  if (tonality.kind === "confirmed") return tonality.key;
  if (tonality.kind !== "unconfirmed") return null;
  const tonic = parseSpelledTonic(document.score.keySignature);
  return tonic ? { ...tonic, mode: "major" } : null;
};

export interface ChordPresetControlsProps extends Pick<ChordEditorLibraryProps, "document" | "tuning" | "onOpenLibrary"> {
  draft: ChordDraft;
  onChange: (draft: ChordDraft) => void;
  presetsEnabled: boolean;
  disabled?: boolean;
}
export const ChordPresetControls = ({
  draft,
  onChange,
  document,
  tuning,
  presetsEnabled,
  disabled = false,
  onOpenLibrary,
}: ChordPresetControlsProps) => {
  const { catalog, status, error } = useChordCatalog();
  const key = recommendationKey(document);
  const signature = document?.score.keySignature;
  const recommendations = catalog && key ? quickChordMatches(catalog, key).slice(0, 8) : [];
  const canUsePresets = presetsEnabled && standardChordTuning(tuning);

  return (
    <section className={styles.controls} aria-label="常用和弦">
      <div className={styles.heading}>
        <h3>常用和弦</h3>
        {key && signature && <span>1={signature}</span>}
        <Button type="link" aria-label="和弦库" disabled={disabled || !onOpenLibrary} onClick={(event) => onOpenLibrary?.(event.currentTarget)}>
          和弦库 <RightOutlined aria-hidden="true" />
        </Button>
      </div>
      {catalog && recommendations.length > 0 && (
        <div className={styles.candidates} role="group" aria-label="本调常用和弦">
          {recommendations.map((match) => {
            const result = selectedCatalogChord(catalog, match);
            if (!result.ok) return null;
            return (
              <ChordRecommendationTile
                key={match.item.id}
                name={match.name}
                diagram={result.chord.diagram}
                selected={semanticJsonEqual(result.chord, draft.chord)}
                disabled={disabled || !canUsePresets}
                unavailableReason={canUsePresets ? undefined : "系统指法仅供标准调弦"}
                onClick={() => onChange({ ...draft, chord: result.chord })}
              />
            );
          })}
        </div>
      )}
      {!key && <p className={styles.help}>可在和弦库选择调性浏览。</p>}
      {status !== "ready" && (
        <div className={styles.help} role="status">
          {catalog
            ? (error ?? "正在检查和弦库更新…")
            : status === "error"
              ? "和弦库暂不可用，仍可使用收藏与自定义指法。"
              : "和弦库加载中…"}
          {status === "error" && (
            <Button type="link" disabled={disabled} onClick={() => { void chordCatalogResource.retry(); }}>重试</Button>
          )}
        </div>
      )}
    </section>
  );
};
