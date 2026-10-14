import type { ILXMPageLayout } from "@liuxianmao/lxm-editor";
import type { PreparedScoreImages } from "./image-export-controller";
import { SceneItems } from "./ScoreMusicLayer";
import { textPrimitive } from "./score-scene";

/** 预览与打印消费成品同一分页投影，页面中不挂编辑事件或提示层。 */
export const ScorePresentationPage = ({
  prepared,
  page,
  className,
}: {
  prepared: PreparedScoreImages;
  page: ILXMPageLayout;
  className?: string;
}) => (
  <svg
    className={className}
    viewBox={`0 0 ${page.width} ${page.height}`}
    role="img"
    aria-label={`A4 乐谱第 ${page.index + 1} 页`}
  >
    <rect width={page.width} height={page.height} fill="#fff" />
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
            prepared.scene.systems.find((s) => s.index === p.systemIndex)!.items
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
  </svg>
);
