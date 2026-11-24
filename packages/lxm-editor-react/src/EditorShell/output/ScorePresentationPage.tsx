import type { ILXMPageLayout } from "@liuxianmao/lxm-editor";
import { memo } from "react";
import type { PreparedScoreImages } from "./image-export-controller";
import { SceneItems } from "../score/ScoreMusicLayer";
import { textPrimitive } from "@liuxianmao/lxm-editor";
import {
  getScoreWatermarkLayout,
  type ScoreWatermark,
} from "./score-watermark";

const PageWatermark = ({
  page,
  watermark,
}: {
  page: ILXMPageLayout;
  watermark: ScoreWatermark;
}) => {
  const mark = getScoreWatermarkLayout(watermark, page);
  if (!mark) return null;
  // 在白纸和谱面之间绘制，缩略图、整页预览与打印都使用相同的 SVG 层。
  return (
    <g
      data-score-watermark={mark.kind}
      transform={`translate(${mark.centerX} ${mark.centerY}) rotate(${mark.angle})`}
      opacity={mark.opacity}
    >
      {mark.kind === "image" ? (
        <image
          href={mark.asset.url}
          x={-mark.width / 2}
          y={-mark.height / 2}
          width={mark.width}
          height={mark.height}
          preserveAspectRatio="none"
        />
      ) : (
        <text
          x={0}
          y={mark.baseline}
          fontFamily={mark.fontFamily}
          fontSize={mark.fontSize}
          fontWeight="normal"
          fill="#000"
          direction="ltr"
          textAnchor="middle"
          dominantBaseline="alphabetic"
          style={{ whiteSpace: "pre" }}
        >
          {mark.text}
        </text>
      )}
    </g>
  );
};

interface PageScoreContentProps {
  prepared: PreparedScoreImages;
  page: ILXMPageLayout;
}

// 谱面依赖已准备的场景和分页。滑块试排只更新水印层，谱头、谱行与页脚复用原图元。
const PageScoreContent = memo(function PageScoreContent({
  prepared,
  page,
}: PageScoreContentProps) {
  return (
    <>
      {page.scoreHeaderTranslation && (
        <g
          transform={`translate(${page.scoreHeaderTranslation.x} ${page.scoreHeaderTranslation.y})`}
        >
          <SceneItems items={prepared.scene.header} />
        </g>
      )}
      {page.systems.map((p) => (
        <g
          key={p.systemIndex}
          transform={`translate(${p.translateX} ${p.translateY})`}
        >
          <SceneItems
            items={
              prepared.scene.systems.find((s) => s.index === p.systemIndex)!
                .items
            }
          />
        </g>
      ))}
      <SceneItems
        items={[
          textPrimitive(
            page.footer.text,
            page.footer.x,
            page.footer.y,
            page.footer.fontSize,
            "middle",
          ),
        ]}
      />
    </>
  );
});

/** 预览与打印共用成品分页。草稿试排期间，已应用的缩略图属性稳定，可跳过整页更新。 */
export const ScorePresentationPage = memo(function ScorePresentationPage({
  prepared,
  page,
  className,
  watermark,
}: PageScoreContentProps & {
  className?: string;
  watermark?: ScoreWatermark;
}) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${page.width} ${page.height}`}
      role="img"
      aria-label={`A4 乐谱第 ${page.index + 1} 页`}
    >
      <rect width={page.width} height={page.height} fill="#fff" />
      {watermark && <PageWatermark page={page} watermark={watermark} />}
      <PageScoreContent prepared={prepared} page={page} />
    </svg>
  );
});
