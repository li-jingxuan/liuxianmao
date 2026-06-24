import type { PointerEventHandler, RefObject } from "react";
import type {
  LaidOutMeasure,
  LaidOutTieSegment,
  ScoreLayout,
} from "@liuxianmao/lxm-tabeditor";

export interface ScorePreviewSelectionState {
  activeBeatId?: string;
  activeMeasureId?: string;
  activeSlotId?: string;
  activeString?: number;
  activeNoteId?: string;
}

export interface ScorePreviewSvgProps {
  layout: ScoreLayout;
  title: string;
  selection: ScorePreviewSelectionState;
  svgRef: RefObject<SVGSVGElement | null>;
  onPointerDown: PointerEventHandler<SVGSVGElement>;
}

export interface ScoreSystemLayerProps {
  systemIndex: number;
  ties: LaidOutTieSegment[];
  measures: LaidOutMeasure[];
  selection: ScorePreviewSelectionState;
}

export interface ScoreMeasureLayerProps {
  measure: LaidOutMeasure;
  selection: ScorePreviewSelectionState;
}
