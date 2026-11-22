const EDGE = 8;
const GAP = 6;

export function fitContextOverlay(left: number, top: number, width: number, height: number) {
  return {
    left: Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE)),
    top: Math.max(EDGE, Math.min(top, window.innerHeight - height - EDGE)),
  };
}

/** 用菜单外沿留出间距，纵向对齐当前行。右边放不下时翻到左边，长浮窗在视口内向上让位。 */
export function contextPanelPosition(anchor: HTMLElement, width: number, height: number) {
  const row = anchor.getBoundingClientRect();
  const menu = anchor.closest("[data-score-context-menu]")?.getBoundingClientRect() ?? row;
  const right = menu.right + GAP;
  const left = right + width <= window.innerWidth - EDGE ? right : menu.left - GAP - width;
  return fitContextOverlay(left, row.top, width, height);
}
