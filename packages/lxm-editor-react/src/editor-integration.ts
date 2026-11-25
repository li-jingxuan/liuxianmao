import type { ILXMDocument, ILXMRhythm, ILXMScoreCommand, ILXMTabCellSelection } from "@liuxianmao/lxm-editor";
import type { ReactNode, Ref } from "react";

export interface LxmEditorResources {
  /** 使用宿主音频与和弦目录，按此前缀寻址。根路径可传空字符串。 */
  basePath?: string;
  /** 包含 manifest.json 及版本 JSON 的目录，相对于渲染页面解析。 */
  chordCatalogDirectory?: string;
  /** 包含 manifest.json、ogg/ 和可选 m4a/ 的采样目录。 */
  audioDirectory?: string;
  /** 指向宿主自己的工具 SVG 目录。缺省时使用样式内联的 Web 同款 SVG。 */
  musicIconBaseUrl?: string;
  /** 覆盖顶栏内置品牌图片。 */
  brandIconUrl?: string;
}

export interface LxmEditorNavigationLinkProps {
  href: string;
  className?: string;
  "aria-label"?: string;
  tabIndex?: number;
  children: ReactNode;
  ref?: Ref<HTMLAnchorElement>;
  /** 同页导航才调用。传给 Next Link 的 onNavigate 可直接满足这个约定。 */
  onNavigate(event: { preventDefault(): void }): void;
}

export interface LxmEditorNavigation {
  homeHref?: string;
  learningHref?: string;
  renderLink?: (props: LxmEditorNavigationLinkProps) => ReactNode;
  /** 菜单和确认继续后使用的路由入口，普通链接可由 renderLink 自行完成跳转。 */
  onNavigate?: (href: string) => void;
  /** 用户在离开确认中选择放弃时调用。站点可在此重置自己的初始曲谱。 */
  onDiscard?: () => void;
}

export interface LxmEditorToolbarState {
  readonly document: ILXMDocument | null;
  readonly selection: ILXMTabCellSelection | null;
  readonly rhythm: ILXMRhythm | null;
  readonly readOnly: boolean;
  readonly blocked: boolean;
  readonly sidebarCollapsed: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** 使用内置工具的草稿、弹层和乐谱影响确认规则。 */
  execute(command: ILXMScoreCommand): Promise<boolean>;
  undo(): boolean;
  redo(): boolean;
  toggleSidebar(): void;
}

export type LxmEditorToolbar = (state: LxmEditorToolbarState) => ReactNode;
