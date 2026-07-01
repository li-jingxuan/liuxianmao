import { ILXMDocument, ILXMMeasure } from "../core/types";
import { ILXMLayoutOptions, ILXMLayout, ILXMMeasureLayout } from "./layout-types";
import {
  LXM_LAYOUT_DEFAULT_X,
  LXM_LAYOUT_DEFAULT_Y,
  LXM_MEASURE_GAP
} from "./layout-constants";
import { layoutMeasure } from "./measure-layout";

const getDefaultLayout = (options: ILXMLayoutOptions) => ({
  trackId: "",
  x: options.x || LXM_LAYOUT_DEFAULT_X,
  y: options.y || LXM_LAYOUT_DEFAULT_Y,
  width: 0,
  height: 0,
  measures: [],
} as ILXMLayout)

/**
 * 构建小节布局
 */
interface IBuildMeasures { width: number; height: number; laidOutMeasure: ILXMMeasureLayout[]; }
const buildMeasures = (
  measures: ILXMMeasure[],
  context: {
    x: number,
    y: number,
    gap: number,
    // TODO 当前版本不支持 和弦符号、歌词和简谱 需要的最小宽度
    // widthContributors?: ILXMColumnWidthContributors;
  }
): IBuildMeasures => {
  const { x, y, gap } = context;

  // 当前小节在 X 轴上的位置
  let cursorX = context.x;
  // TODO 当前小节在 Y 轴上的位置，后续多行 systems 的情况需要叠加
  // let cursorY = y;

  const laidOutMeasure = measures.map((measure, index) => {
    const laidOutMeasure = layoutMeasure(
      measure,
      { index, x: cursorX, y }
    )
    cursorX += laidOutMeasure.width + gap;

    return laidOutMeasure
  })

  return {
    laidOutMeasure,
    width: cursorX, //  - x - gap,
    // 小节是横向移动的，需要取当前行最高值的小节作为基准高度
    height: laidOutMeasure.reduce(
      (maxHeight, measure) => Math.max(maxHeight, measure.y + measure.height - y),
      0,
    )
  }
}

export const buildLayout = (
  document: ILXMDocument,
  options: ILXMLayoutOptions
): ILXMLayout => {
  const { id, title, meta, tracks, } = document.score
  const track = tracks[0];

  if(!track ) {
    return getDefaultLayout(options)
  }

  const startX = options.x ?? LXM_LAYOUT_DEFAULT_X;
  const startY = options.y ?? LXM_LAYOUT_DEFAULT_Y;
  const measureGap = options.measureGap ?? LXM_MEASURE_GAP;

  // 构建 小节宽度/高度/布局信息
  const { width, height, laidOutMeasure: measures } = buildMeasures(
    track.measures,
    {
      x: startX, y: startY, gap: measureGap
    }
  );

  return {
    trackId: document.score.tracks[0].id,
    x: startX,
    y: startY,
    width,
    height,
    measures
  }
}
