import { Button, Modal } from "antd";
import { useRef, useState, type ComponentProps } from "react";
import { ChordLibraryModal } from "./ChordLibraryModal";
import type { ChordDraft } from "./ChordEditor";
import { EditorModalGuard } from "../session/EditorModalGuard";

/** 收藏选用先确认，确认后回到自定义；此处不会完成父级和弦草稿。 */
export const ChordLibraryReturn = (props: ComponentProps<typeof ChordLibraryModal>) => {
  const [replacement, setReplacement] = useState<ChordDraft | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  return <>
    <ChordLibraryModal {...props} onConfirm={next => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setReplacement(next);
    }} />
    <Modal title="替换当前自定义指法？" open={!!replacement} keyboard={false}
      focusable={{ focusTriggerAfterClose: false }}
      afterClose={() => {
        if (opener.current?.isConnected && opener.current.getClientRects().length)
          opener.current.focus({ preventScroll: true });
      }}
      zIndex={1200} mask={{ closable: false }} onCancel={() => setReplacement(null)}
      footer={<>
        <Button autoFocus onClick={() => setReplacement(null)}>继续浏览</Button>
        <Button type="primary" onClick={() => {
          if (replacement) props.onConfirm(replacement);
          setReplacement(null);
        }}>确认替换</Button>
      </>}
      modalRender={node => <EditorModalGuard dismissable onDismiss={() => setReplacement(null)}>{node}</EditorModalGuard>}
    >选用的指法会替换当前编辑。返回自定义后，仍需点击“完成编辑”。</Modal>
  </>;
};
