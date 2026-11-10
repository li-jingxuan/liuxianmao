import { describe, expect, it, vi } from "vitest";
import {
  copyChordPreset,
  STANDARD_GUITAR_TUNING,
} from "@liuxianmao/lxm-editor";
import {
  CHORD_IMPORT_LIMIT,
  CHORD_PREFERENCES_KEY,
  createChordPreferencesStore,
  createDefaultChordPreferences,
  type ChordPreferencesStorage,
  type ChordQuickReference,
  type CustomChordVoicing,
} from "../components/EditorShell/chord-preferences";
type ImportInput = { version: number; lastKey?: string; quickItems: ChordQuickReference[]; customVoicings: unknown[] };

const custom = (n = 1): CustomChordVoicing => ({
  id: `user:00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  voicingId: `shape-${n}`,
  name: "自由和弦",
  diagram: copyChordPreset("C")!.diagram!,
  tuning: STANDARD_GUITAR_TUNING.map(({ pitch, midi }) => ({ pitch, midi })),
});
function setup(raw: string | null = null) {
  let stored = raw,
    event = () => {};
  const adapter: ChordPreferencesStorage = {
    getItem: vi.fn(() => stored),
    setItem: vi.fn((_key, value) => {
      stored = value;
    }),
    subscribe: vi.fn((listener) => {
      event = listener;
      return () => {};
    }),
  };
  const store = createChordPreferencesStore(adapter);
  return {
    store,
    adapter,
    read: () => stored,
    external: (value: string | null) => {
      stored = value;
      event();
    },
    silentExternal: (value: string) => {
      stored = value;
    },
  };
}
describe("和弦偏好事务", () => {
  it("导入模块及取得 SSR 快照不读 storage，客户端加载只执行一次", () => {
    const { store, adapter } = setup();
    expect(
      store.getSnapshot().preferences.quickItems.map((r) => r.identityId),
    ).toEqual([
      "pc:0/major",
      "pc:7/major",
      "pc:9/m",
      "pc:5/major",
      "pc:2/m",
      "pc:4/m",
    ]);
    expect(store.getServerSnapshot()).toBe(store.getServerSnapshot());
    expect(adapter.getItem).not.toHaveBeenCalled();
    store.load();
    store.load();
    expect(adapter.getItem).toHaveBeenCalledTimes(1);
    expect(adapter.subscribe).toHaveBeenCalledTimes(1);
  });
  it("保存订阅共用独立且不可变快照，成功时生成本机 revision", () => {
    const { store, adapter } = setup();
    store.load();
    const listener = vi.fn();
    store.subscribe(listener);
    const value = { quickItems: [], customVoicings: [custom()] };
    expect(store.save(value, "initial")).toEqual({
      ok: true,
      persistence: "browser",
    });
    value.customVoicings[0]!.diagram.strings[0]!.fret = 9;
    expect(
      store.getSnapshot().preferences.customVoicings[0]!.diagram.strings[0]!
        .fret,
    ).toBe(0);
    expect(
      Object.isFrozen(
        store.getSnapshot().preferences.customVoicings[0]!.diagram.strings,
      ),
    ).toBe(true);
    expect(store.getSnapshot().preferences.revision).not.toBe("initial");
    expect(listener).toHaveBeenCalledOnce();
    expect(adapter.setItem).toHaveBeenCalledWith(
      CHORD_PREFERENCES_KEY,
      expect.any(String),
    );
  });
  it("严格导入只预览，保留系统失效引用，确认替换忽略输入 revision", () => {
    const { store, adapter } = setup();
    store.load();
    const input = {
      ...createDefaultChordPreferences(),
      revision: "untrusted-file-revision",
      quickItems: [
        { identityId: "pc:0/major", defaultVoicingId: "removed-shape" },
      ],
      customVoicings: [custom()],
    };
    const preview = store.parseImport(JSON.stringify(input));
    expect(preview.ok).toBe(true);
    expect(preview.unresolvedReferences).toEqual(input.quickItems);
    expect(preview.before).toEqual({ quick: 6, custom: 0 });
    expect(preview.after).toEqual({ quick: 1, custom: 1 });
    expect(adapter.setItem).not.toHaveBeenCalled();
    expect(store.replaceImport(preview)).toEqual({
      ok: true,
      persistence: "browser",
    });
    expect(store.getSnapshot().preferences.revision).not.toBe(input.revision);
    expect(store.getSnapshot().preferences.quickItems).toEqual(
      input.quickItems,
    );
    expect(store.parseImport(store.export()).ok).toBe(true);
  });
  it.each([
    [
      "未知字段",
      (v: ImportInput) => {
        v.lastKey = "C";
      },
    ],
    [
      "重复身份",
      (v: ImportInput) => {
        v.quickItems = [v.quickItems[0]!, v.quickItems[0]!];
      },
    ],
    [
      "缺失收藏",
      (v: ImportInput) => {
        v.quickItems = [
          { identityId: custom().id, defaultVoicingId: "shape-1" },
        ];
      },
    ],
    [
      "不匹配的收藏指法",
      (v: ImportInput) => {
        v.customVoicings = [custom()];
        v.quickItems = [{ identityId: custom().id, defaultVoicingId: "other" }];
      },
    ],
    [
      "坏图",
      (v: ImportInput) => {
        const c = custom();
        c.diagram.strings[0]!.fret = -1;
        v.customVoicings = [c];
      },
    ],
    [
      "图内未知字段",
      (v: ImportInput) => {
        v.customVoicings = [
          { ...custom(), diagram: { ...custom().diagram, other: true } },
        ];
      },
    ],
    [
      "同名不同 id 合法但重复 id 不合法",
      (v: ImportInput) => {
        v.customVoicings = [custom(), custom()];
      },
    ],
    [
      "调弦字段错误",
      (v: ImportInput) => {
        v.customVoicings = [
          { ...custom(), tuning: [{ pitch: "E4", midi: 64 }] },
        ];
      },
    ],
    [
      "收藏空名",
      (v: ImportInput) => {
        v.customVoicings = [{ ...custom(), name: "" }];
      },
    ],
    [
      "版本不支持",
      (v: ImportInput) => {
        v.version = 2;
      },
    ],
  ])("%s 禁止整个导入，不产生写入", (_name, mutate) => {
    const { store, adapter } = setup();
    store.load();
    const input = createDefaultChordPreferences();
    mutate(input);
    const preview = store.parseImport(JSON.stringify(input));
    expect(preview.ok).toBe(false);
    expect(preview.issues.length).toBeGreaterThan(0);
    expect(store.replaceImport(preview).ok).toBe(false);
    expect(adapter.setItem).not.toHaveBeenCalled();
  });
  it("容量按 6/200 与 UTF-8 字节限制验证，绝不截断", () => {
    const { store } = setup();
    store.load();
    const input = createDefaultChordPreferences();
    input.quickItems.push({
      identityId: "pc:11/major",
      defaultVoicingId: "shape",
    });
    expect(store.parseImport(JSON.stringify(input)).ok).toBe(false);
    input.quickItems = [];
    input.customVoicings = Array.from({ length: 200 }, (_, i) => custom(i + 1));
    expect(store.parseImport(JSON.stringify(input)).ok).toBe(true);
    input.customVoicings.push(custom(201));
    expect(store.parseImport(JSON.stringify(input)).ok).toBe(false);
    expect(store.parseImport(" ".repeat(CHORD_IMPORT_LIMIT + 1)).ok).toBe(
      false,
    );
    expect(store.parseImport("中".repeat(CHORD_IMPORT_LIMIT / 2)).ok).toBe(
      false,
    );
  });
  it("有效同名收藏保留独立身份，并能导出再导入", () => {
    const { store } = setup();
    store.load();
    expect(
      store.save(
        { quickItems: [], customVoicings: [custom(1), custom(2)] },
        "initial",
      ).ok,
    ).toBe(true);
    expect(store.parseImport(store.export()).after.custom).toBe(2);
  });
  it("读到坏收藏隔离并保留原始记录，显式处理前拒绝覆盖", () => {
    const value = {
      ...createDefaultChordPreferences(),
      customVoicings: [custom(1), { ...custom(2), name: "" }],
    };
    const raw = JSON.stringify(value),
      { store, adapter } = setup(raw);
    store.load();
    const state = store.getSnapshot();
    expect(state.status).toBe("quarantined");
    expect(state.rawBackup).toBe(raw);
    expect(state.preferences.customVoicings).toHaveLength(1);
    expect(store.save(state.preferences, state.preferences.revision).ok).toBe(
      false,
    );
    expect(adapter.setItem).not.toHaveBeenCalled();
    expect(
      store.save(state.preferences, state.preferences.revision, {
        discardQuarantine: true,
      }).ok,
    ).toBe(true);
  });
  it("未知版本可在本次会话使用默认配置，原始存储不会被覆盖", () => {
    const raw = JSON.stringify({
      format: "lxm-chord-preferences",
      version: 27,
      future: ["keep"],
    });
    const { store, adapter, read } = setup(raw);
    store.load();
    expect(store.getSnapshot().status).toBe("unsupported");
    expect(
      store.save({ quickItems: [], customVoicings: [custom()] }, "initial"),
    ).toEqual({ ok: true, persistence: "memory" });
    expect(read()).toBe(raw);
    expect(adapter.setItem).not.toHaveBeenCalled();
    expect(store.getSnapshot().rawBackup).toBe(raw);
    expect(store.getSnapshot().preferences.customVoicings).toHaveLength(1);
  });
  it("跨标签事件同步共享快照，保留旧 revision 的配置草稿不能覆盖外部值", () => {
    const { store, external, adapter } = setup();
    store.load();
    const preview = store.parseImport(
      JSON.stringify(createDefaultChordPreferences()),
    );
    external(
      JSON.stringify({
        ...createDefaultChordPreferences(),
        revision: "external",
        quickItems: [],
      }),
    );
    expect(store.getSnapshot().preferences.revision).toBe("external");
    expect(
      store.save(createDefaultChordPreferences(), "initial"),
    ).toMatchObject({ ok: false, conflict: true });
    expect(store.replaceImport(preview)).toMatchObject({
      ok: false,
      conflict: true,
    });
    expect(adapter.setItem).not.toHaveBeenCalled();
    expect(store.save(createDefaultChordPreferences(), "external").ok).toBe(
      true,
    );
  });
  it("保存前重读发现尚未送达事件的写入，也拒绝静默覆盖", () => {
    const { store, silentExternal, adapter } = setup();
    store.load();
    silentExternal(
      JSON.stringify({
        ...createDefaultChordPreferences(),
        revision: "unseen",
      }),
    );
    expect(
      store.save(createDefaultChordPreferences(), "initial"),
    ).toMatchObject({ ok: false, conflict: true });
    expect(adapter.setItem).not.toHaveBeenCalled();
    expect(store.getSnapshot().preferences.revision).toBe("unseen");
  });
  it("读写/订阅失败均可降级为可导出的会话配置，不能声称已保存", () => {
    const store = createChordPreferencesStore({
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
      subscribe: () => {
        throw new Error("blocked");
      },
    });
    store.load();
    expect(store.getSnapshot().persistence).toBe("memory");
    expect(
      store.save({ quickItems: [], customVoicings: [custom()] }, "initial"),
    ).toEqual({ ok: true, persistence: "memory" });
    expect(store.getSnapshot().issues.join()).toContain("未保存到浏览器");
    expect(JSON.parse(store.export()).customVoicings).toHaveLength(1);
  });
});
