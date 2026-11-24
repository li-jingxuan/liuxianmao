import { createContext, useContext, useMemo, type ReactNode } from "react";
import { chordCatalogResource, createChordCatalogResource } from "../EditorShell/chords/chord-catalog-resource";
import { loadBundledChordCatalog } from "./bundled-assets";
import type { LxmEditorResources } from "../editor-integration";

const Resources = createContext<{ paths?: LxmEditorResources; chords: typeof chordCatalogResource }>({
  chords: chordCatalogResource,
});

/** 延续按需加载和缓存，同一工作区的和弦入口与试听共享一份解析结果。 */
export function EditorResourceProvider({ paths, children }: { paths?: LxmEditorResources; children: ReactNode }) {
  const { basePath, chordCatalogDirectory } = paths ?? {};
  const chords = useMemo(() => basePath !== undefined || chordCatalogDirectory
    ? createChordCatalogResource({ basePath, directory: chordCatalogDirectory })
    : loadBundledChordCatalog
      ? createChordCatalogResource({ loadBundled: loadBundledChordCatalog })
      : chordCatalogResource, [basePath, chordCatalogDirectory]);
  return <Resources.Provider value={{ paths, chords }}>{children}</Resources.Provider>;
}

export const useEditorResources = () => useContext(Resources);
