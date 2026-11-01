"use client";

import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

type ConverterKey = { draft: string; appliedKey: string };
type FnosKeyContextValue = {
  converterKey: ConverterKey | null;
  setConverterKey: Dispatch<SetStateAction<ConverterKey | null>>;
};

const FnosKeyContext = createContext<FnosKeyContextValue | null>(null);

/** 根布局在客户端导航期间保持挂载；刷新后所有密钥状态自然丢失。 */
export function FnosKeyProvider({ children }: { children: ReactNode }) {
  const [converterKey, setConverterKey] = useState<ConverterKey | null>(null);
  return (
    <FnosKeyContext.Provider value={{ converterKey, setConverterKey }}>
      {children}
    </FnosKeyContext.Provider>
  );
}

export function useFnosKey(initialKey = "") {
  const context = useContext(FnosKeyContext);
  if (!context) throw new Error("飞牛密钥交互需要 FnosKeyProvider");
  // null 表示尚未在当前运行时编辑；空字符串是有效的显式清空状态。
  const key = context.converterKey ?? { draft: initialKey, appliedKey: initialKey };
  return {
    ...key,
    setDraft: (draft: string) => context.setConverterKey({ draft, appliedKey: draft.trim() }),
    clear: () => context.setConverterKey({ draft: "", appliedKey: "" }),
    remember: () => context.setConverterKey(key),
    // 原子更新先于客户端导航，返回首页时直接读取新状态，不依赖 effect 交接。
    selectIssuedKey: (issuedKey: string) => context.setConverterKey({ draft: issuedKey, appliedKey: issuedKey }),
  };
}
