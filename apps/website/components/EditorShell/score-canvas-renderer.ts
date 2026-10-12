import {
  A4_IMAGE_WIDTH,
  A4_IMAGE_HEIGHT,
  type ILXMPageLayout,
} from "@liuxianmao/lxm-editor";
import {
  textPrimitive,
  type ScorePrimitive,
  type ScoreScene,
} from "./score-scene";

/** 保存/恢复图元样式，防止 dash、描边或字体污染后一项。 */
const drawPrimitive = (ctx: CanvasRenderingContext2D, p: ScorePrimitive) => {
  ctx.save();
  ctx.fillStyle = p.fill ?? "#1d2025";
  ctx.strokeStyle = p.stroke ?? "#000";
  ctx.lineWidth = p.strokeWidth ?? 1;
  ctx.lineCap = p.lineCap ?? "butt";
  ctx.lineJoin = "round";
  ctx.setLineDash(p.dash ? p.dash.trim().split(/[ ,]+/).map(Number) : []);
  if (p.kind === "text") {
    ctx.font = `${p.fontWeight} ${p.fontSize}px ${p.fontFamily}`;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign =
      p.textAnchor === "middle"
        ? "center"
        : p.textAnchor === "end"
          ? "right"
          : "left";
    if (p.stroke) ctx.strokeText(p.text, p.x, p.y);
    if (p.fill !== "none") ctx.fillText(p.text, p.x, p.y);
  } else {
    const path = new Path2D(p.kind === "path" ? p.d : undefined);
    switch (p.kind) {
      case "line":
        path.moveTo(p.x1, p.y1);
        path.lineTo(p.x2, p.y2);
        break;
      case "circle":
        path.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
        break;
      case "rect":
        if (p.rx) path.roundRect(p.x, p.y, p.width, p.height, p.rx);
        else path.rect(p.x, p.y, p.width, p.height);
        break;
      case "polygon":
        p.points.forEach(([x, y], i) =>
          i ? path.lineTo(x, y) : path.moveTo(x, y),
        );
        path.closePath();
        break;
    }
    if (p.fill && p.fill !== "none") ctx.fill(path);
    if (p.stroke) ctx.stroke(path);
  }
  ctx.restore();
};
/** 按 A4 固定像素逐页绘制，预览缩放和设备 DPR 不参与输出。 */
export const renderPageCanvas = (
  scene: ScoreScene,
  page: ILXMPageLayout,
): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = A4_IMAGE_WIDTH;
  canvas.height = A4_IMAGE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器无法创建图片画布");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(canvas.width / page.width, canvas.height / page.height);
  const draw = (items: ScorePrimitive[], x: number, y: number) => {
    ctx.save();
    ctx.translate(x, y);
    items.forEach((p) => drawPrimitive(ctx, p));
    ctx.restore();
  };
  if (page.scoreHeaderTranslation)
    draw(
      scene.header,
      page.scoreHeaderTranslation.x,
      page.scoreHeaderTranslation.y,
    );
  for (const placement of page.systems) {
    const s = scene.systems.find((s) => s.index === placement.systemIndex);
    if (!s) throw new Error("页面谱行不存在");
    draw(s.items, placement.translateX, placement.translateY);
  }
  drawPrimitive(
    ctx,
    textPrimitive(
      page.footer.text,
      page.footer.x,
      page.footer.y,
      page.footer.fontSize,
      "middle",
    ),
  );
  return canvas;
};
