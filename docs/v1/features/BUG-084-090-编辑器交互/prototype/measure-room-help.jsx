import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Tooltip from 'antd/es/tooltip';
import QuestionCircleOutlined from '@ant-design/icons/es/icons/QuestionCircleOutlined';

function RoomHelp({ dialog }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    // 在原生 dialog 处理取消之前收起说明，保留表单草稿和当前焦点。
    function dismiss(event) {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
    }
    window.addEventListener('keydown', dismiss, true);
    return () => window.removeEventListener('keydown', dismiss, true);
  }, [open]);

  return (
    <Tooltip
      title="每遍先弹共享段，再弹勾选该遍的房子。总遍数含首遍。最后从结尾区后的共同出口继续。"
      trigger={['hover', 'focus']}
      placement="top"
      open={open}
      onOpenChange={setOpen}
      getPopupContainer={() => dialog}
    >
      <button type="button" aria-label="反复房子说明" style={{
        display: 'inline-grid', placeItems: 'center', width: 22, height: 22,
        padding: 0, border: 0, background: 'transparent', color: '#667085', fontSize: 15,
      }}>
        <QuestionCircleOutlined aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

// 表单会在切换草稿时重建。销毁旧根会同时清理 Tooltip 的 portal 和监听器。
let root;
export function mount(node) {
  unmount();
  root = createRoot(node);
  root.render(<RoomHelp dialog={node.closest('dialog')} />);
}
export function unmount() {
  root?.unmount();
  root = undefined;
}
