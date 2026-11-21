"use client";

import { Input, Tooltip } from "antd";
import { useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import { editorShortcut, findEditorShortcuts, shortcutKeys, type EditorShortcut, type ShortcutPlatform } from "./editor-shortcuts";
import styles from "./EditorShortcutReference.module.scss";

const subscribe = () => () => {};
const browserPlatform = () => /mac|iphone|ipad|ipod/i.test(navigator.platform) ? "mac" : "pc";
const serverPlatform = () => "pc" as const;
export const useShortcutPlatform = () => useSyncExternalStore(subscribe, browserPlatform, serverPlatform);

function KeyCaps({ id, platform }: { id: EditorShortcut; platform: ShortcutPlatform }) {
  return <span className={styles.keys}>{shortcutKeys(id, platform).map((combo, index) => (
    <span key={combo} className={styles.combo}>
      {index > 0 && <span className={styles.or}>/</span>}
      {combo.split(" + ").map((key) => <kbd key={key}>{key}</kbd>)}
    </span>
  ))}</span>;
}

export function ShortcutHint({ shortcuts, note }: { shortcuts: readonly EditorShortcut[]; note?: ReactNode }) {
  const platform = useShortcutPlatform();
  return <div className={styles.hint}>
    {shortcuts.map((id) => <div className={styles.hintRow} key={id}>
      <span>{editorShortcut(id).label}</span><KeyCaps id={id} platform={platform} />
    </div>)}
    {note && <div className={styles.note}>{note}</div>}
  </div>;
}

export function ShortcutTooltip({ shortcuts, disabled, note, children }: {
  shortcuts: readonly EditorShortcut[];
  disabled?: boolean;
  note?: ReactNode;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  return <Tooltip title={<ShortcutHint shortcuts={shortcuts} note={note} />} trigger={["hover", "focus"]}
    open={open} onOpenChange={setOpen} mouseEnterDelay={0.3}>
    <span className={styles.trigger} tabIndex={disabled ? 0 : undefined} onPointerDown={() => setOpen(false)}
      onKeyDownCapture={(event) => {
        if (!open || event.key !== "Escape" || event.nativeEvent.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }}>{children}</span>
  </Tooltip>;
}

export function EditorShortcutReference() {
  const device = useShortcutPlatform();
  const [platform, setPlatform] = useState<ShortcutPlatform>();
  const [search, setSearch] = useState("");
  const searchRef = useRef<React.ComponentRef<typeof Input>>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const groups = findEditorShortcuts(search);
  const count = groups.reduce((total, group) => total + group.shortcuts.length, 0);
  const updateSearch = (value: string) => {
    setSearch(value);
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  };
  return <div className={styles.reference}>
    <div className={styles.filters}>
      <Input ref={searchRef} data-shortcut-search aria-label="搜索快捷键" allowClear placeholder="搜索操作或按键" value={search}
        onChange={(event) => updateSearch(event.target.value)} />
      <select aria-label="键位平台" value={platform ?? device} onChange={(event) => setPlatform(event.target.value === "mac" ? "mac" : "pc")}>
        <option value="mac">macOS</option>
        <option value="pc">Windows</option>
      </select>
    </div>
    <p className={styles.count} role="status">{count} 项快捷键</p>
    <div ref={resultsRef} className={styles.results} tabIndex={count ? 0 : undefined} role="region" aria-label="快捷键列表">
      {groups.map(({ title, shortcuts }) => <section className={styles.group} key={title}>
        <h3>{title}</h3>
        <ul>{shortcuts.map((id) => {
          const { label, detail } = editorShortcut(id);
          return <li className={styles.row} key={id}>
            <div><strong>{label}</strong>{detail && <p>{detail}</p>}</div>
            <KeyCaps id={id} platform={platform ?? device} />
          </li>;
        })}</ul>
      </section>)}
      {!count && <div className={styles.empty}>
        <p>未找到匹配的快捷键</p>
        <button type="button" onClick={() => { updateSearch(""); searchRef.current?.focus(); }}>清除搜索</button>
      </div>}
    </div>
  </div>;
}
