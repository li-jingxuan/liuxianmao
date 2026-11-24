"use client";

import { Modal } from "antd";
import { useEffect, useRef, useState } from "react";
import { ChordDiagramEditorModal, type ChordDiagramEditorModalProps } from "./ChordDiagramEditorModal";
import { ChordLibraryReturn } from "./ChordLibraryReturn";
import type { ChordDraft } from "./ChordEditor";
import type { ChordEditorLibraryProps } from "./ChordPresetControls";
import { EditorModalGuard } from "../session/EditorModalGuard";
import type { EditorModalCloseSource } from "../session/editor-modal-controller";
import styles from "../session/EditorModalHost.module.scss";

/** 自定义编辑器始终挂载；收藏库只在其上层打开，不进行宿主 handoff。 */
export const ChordCustomSurface = ({
  document: score, presetsEnabled, requestCloseRef, ...editorProps
}: ChordDiagramEditorModalProps & Pick<ChordEditorLibraryProps, "document"> & { presetsEnabled: boolean }) => {
  const [library, setLibrary] = useState<ChordDraft | null>(null);
  const closeEditor = useRef<((source?: EditorModalCloseSource) => void) | null>(null);
  const replaceEditor = useRef<((draft: ChordDraft) => void) | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const closeLibrary = () => setLibrary(null);
  useEffect(() => {
    if (!requestCloseRef) return;
    requestCloseRef.current = source => {
      if (library) closeLibrary();
      else closeEditor.current?.(source);
    };
    return () => { requestCloseRef.current = null; };
  });
  return <>
    <div inert={library ? true : undefined} aria-hidden={library ? true : undefined}>
      <ChordDiagramEditorModal {...editorProps} requestCloseRef={closeEditor} replaceDraftRef={replaceEditor}
        onOpenLibrary={() => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setLibrary(editorProps.seed);
        }} />
    </div>
    <Modal open={!!library} title={<div className={styles.heading}><h2>和弦库</h2><p>选择和弦与指法，带回当前编辑位置。</p></div>}
      className={styles.chordModal} width={1080} centered zIndex={1100}
      mask={{ closable: false }} keyboard={false} focusable={{ focusTriggerAfterClose: false }}
      styles={{ container: { padding: 0, maxWidth: "calc(100vw - 48px)", maxHeight: "calc(100dvh - 48px)", display: "flex", flexDirection: "column" }, header: { padding: "20px 24px", marginBottom: 0, borderBottom: "1px solid #dce3eb", flexShrink: 0 }, body: { overflow: "hidden", minHeight: 0 } }}
      onCancel={closeLibrary} footer={null} destroyOnHidden
      afterOpenChange={open => {
        if (open) overlay.current?.querySelector<HTMLInputElement>('input[aria-label="搜索我的指法"]')?.focus({ preventScroll: true });
      }}
      afterClose={() => {
        if (opener.current?.isConnected && !opener.current.closest("[inert]")) opener.current.focus({ preventScroll: true });
      }}
      modalRender={node => <EditorModalGuard ref={overlay} dismissable onDismiss={closeLibrary}>{node}</EditorModalGuard>}
    >
      {library && <ChordLibraryReturn draft={library} document={score} tuning={editorProps.tuning} presetsEnabled={presetsEnabled}
        initialTab="mine" cancelLabel="返回自定义" confirmLabel="选用此指法" onCancel={closeLibrary}
        onConfirm={next => { replaceEditor.current?.(next); closeLibrary(); }} />}
    </Modal>
  </>;
};
