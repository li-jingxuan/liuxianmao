import type { ILXMLayout, ILXMSystemLayout } from "./layout-types";
import { unionMusicBounds, type MusicTextRect } from "./music-text-metrics";

/** 固定物理尺寸，不使用设备 DPR 或浏览器缩放。 */
export const A4_UNITS_PER_MM = 96 / 25.4;
export const A4_CONTENT_WIDTH = 194 * A4_UNITS_PER_MM;
export const A4_IMAGE_WIDTH = 2480;
export const A4_IMAGE_HEIGHT = 3508;
export interface ILXMPageOptions {
  pageWidth: number;
  pageHeight: number;
  margins: { top: number; right: number; bottom: number; left: number };
  footerHeight: number;
  systemGap: number;
}
export const A4_PAGE_OPTIONS: ILXMPageOptions = {
  pageWidth: 210 * A4_UNITS_PER_MM,
  pageHeight: 297 * A4_UNITS_PER_MM,
  margins: {
    top: 8 * A4_UNITS_PER_MM,
    right: 8 * A4_UNITS_PER_MM,
    bottom: 8 * A4_UNITS_PER_MM,
    left: 8 * A4_UNITS_PER_MM,
  },
  footerHeight: 8 * A4_UNITS_PER_MM,
  systemGap: 12,
};
export interface ILXMPageLayout {
  index: number;
  width: number;
  height: number;
  systems: { systemIndex: number; translateX: number; translateY: number }[];
  scoreHeaderTranslation?: { x: number; y: number };
  footer: { text: string; x: number; y: number; fontSize: number };
}
export interface ILXMPageDiagnostic {
  code:
    | "empty-score"
    | "invalid-geometry"
    | "header-overflow"
    | "system-too-wide"
    | "system-too-tall"
    | "first-page-overflow";
  systemIndex?: number;
  measureIds: string[];
}
export type ILXMPaginationResult =
  | { ok: true; pages: ILXMPageLayout[]; diagnostics: [] }
  | { ok: false; pages: []; diagnostics: ILXMPageDiagnostic[] };
const validRect = (r: MusicTextRect) =>
  Object.values(r).every(Number.isFinite) && r.width >= 0 && r.height >= 0;
const systemBounds = (s: ILXMSystemLayout) =>
  unionMusicBounds([
    { x: s.x, y: s.y, width: s.width, height: s.height },
    ...(s.visualBounds ? [s.visualBounds] : []),
  ]);

/** 完整行贪心分页；页面只平移原几何，音乐 ID 和内容不变。 */
export const paginateLayout = (
  layout: ILXMLayout,
  options: ILXMPageOptions = A4_PAGE_OPTIONS,
): ILXMPaginationResult => {
  const { pageWidth, pageHeight, margins, footerHeight, systemGap } = options;
  const width = pageWidth - margins.left - margins.right;
  const capacity = pageHeight - margins.top - margins.bottom - footerHeight;
  if (
    ![
      pageWidth,
      pageHeight,
      footerHeight,
      systemGap,
      ...Object.values(margins),
    ].every(Number.isFinite) ||
    Object.values(margins).some((v) => v < 0) ||
    footerHeight < 0 ||
    systemGap < 0 ||
    width <= 0 ||
    capacity <= 0
  )
    throw new RangeError("分页配置必须为有限正纸张尺寸和非负边距");
  const fail = (
    code: ILXMPageDiagnostic["code"],
    system?: ILXMSystemLayout,
  ): ILXMPaginationResult => ({
    ok: false,
    pages: [],
    diagnostics: [
      {
        code,
        systemIndex: system?.index,
        measureIds: system?.measures.map((m) => m.id) ?? [],
      },
    ],
  });
  if (!layout.systems.length) return fail("empty-score");
  if (![layout.x, layout.y, layout.width, layout.height].every(Number.isFinite))
    return fail("invalid-geometry");
  const header = layout.scoreHeaderHeight ?? 0;
  const headerBounds = layout.scoreHeaderBounds;
  if (
    !Number.isFinite(header) ||
    header < 0 ||
    (headerBounds && !validRect(headerBounds))
  )
    return fail("invalid-geometry");
  const epsilon = 1e-6;
  if (
    header > capacity ||
    (headerBounds &&
      (headerBounds.x < layout.x - epsilon ||
        headerBounds.x + headerBounds.width > layout.x + width + epsilon ||
        headerBounds.y < layout.y - epsilon ||
        headerBounds.y + headerBounds.height > layout.y + header + epsilon))
  )
    return fail("header-overflow");
  const seen = new Set<number>();
  for (const system of layout.systems) {
    if (
      seen.has(system.index) ||
      !validRect({
        x: system.x,
        y: system.y,
        width: system.width,
        height: system.height,
      }) ||
      (system.visualBounds && !validRect(system.visualBounds))
    )
      return fail("invalid-geometry", system);
    seen.add(system.index);
    const bounds = systemBounds(system);
    if (bounds.width > width + epsilon) return fail("system-too-wide", system);
    if (bounds.height > capacity + epsilon)
      return fail("system-too-tall", system);
  }
  const pages: ILXMPageLayout[] = [];
  const newPage = (): ILXMPageLayout => {
    const page: ILXMPageLayout = {
      index: pages.length,
      width: pageWidth,
      height: pageHeight,
      systems: [],
      footer: {
        text: "",
        x: pageWidth / 2,
        y: pageHeight - margins.bottom - footerHeight / 2 + 4,
        fontSize: 10,
      },
    };
    pages.push(page);
    return page;
  };
  let page = newPage(),
    used = header;
  page.scoreHeaderTranslation = {
    x: margins.left - layout.x,
    y: margins.top - layout.y,
  };
  for (const system of layout.systems) {
    const bounds = systemBounds(system);
    let gap = page.systems.length ? systemGap : 0;
    if (used + gap + bounds.height > capacity + epsilon) {
      if (!page.systems.length) return fail("first-page-overflow", system);
      page = newPage();
      used = 0;
      gap = 0;
    }
    page.systems.push({
      systemIndex: system.index,
      translateX: margins.left - bounds.x,
      translateY: margins.top + used + gap - bounds.y,
    });
    used += gap + bounds.height;
  }
  pages.forEach((p) => {
    p.footer.text = `${p.index + 1} / ${pages.length}`;
  });
  return { ok: true, pages, diagnostics: [] };
};
