import { useEffect, useSyncExternalStore } from "react";
import {
  normalizeMusicText,
  validateChordDiagram,
  type ILXMChordDiagram,
} from "@liuxianmao/lxm-editor";
import type { ChordDraft } from "./ChordEditor";

export const CHORD_PREFERENCES_KEY = "lxm.chord-preferences.v1";
export const CHORD_IMPORT_LIMIT = 1024 * 1024;
export interface ChordQuickReference {
  identityId: string;
  defaultVoicingId: string;
}
export interface CustomChordVoicing {
  id: string;
  voicingId: string;
  name: string;
  diagram: ILXMChordDiagram;
  tuning: { pitch: string; midi: number }[];
}
export interface ChordPreferencesV1 {
  format: "lxm-chord-preferences";
  version: 1;
  revision: string;
  quickItems: ChordQuickReference[];
  customVoicings: CustomChordVoicing[];
}
export type ChordPreferencesValue = Pick<
  ChordPreferencesV1,
  "quickItems" | "customVoicings"
>;
export interface ChordPreferencesSnapshot {
  preferences: ChordPreferencesV1;
  persistence: "browser" | "memory";
  status: "ready" | "unsupported" | "quarantined" | "error";
  issues: string[];
  rawBackup: string | null;
}
export type ChordPreferencesSaveResult =
  | { ok: true; persistence: "browser" | "memory" }
  | { ok: false; error: string; conflict?: boolean };
export interface ChordPreferencesStorage {
  persistence?: "browser" | "memory";
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  subscribe?(listener: () => void): () => void;
}
export interface ChordImportPreview {
  ok: boolean;
  value: ChordPreferencesV1 | null;
  issues: string[];
  expectedRevision: string;
  before: { quick: number; custom: number };
  after: { quick: number; custom: number };
  unresolvedReferences: ChordQuickReference[];
}
const clone = <T>(value: T): T => structuredClone(value);
const freeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const n = Math.floor(Math.random() * 16);
    return (char === "x" ? n : (n & 3) | 8).toString(16);
  });
export const createDefaultChordPreferences = (): ChordPreferencesV1 => ({
  format: "lxm-chord-preferences",
  version: 1,
  revision: "initial",
  quickItems: [
    "pc:0/major",
    "pc:7/major",
    "pc:9/m",
    "pc:5/major",
    "pc:2/m",
    "pc:4/m",
  ].map((identityId) => ({ identityId, defaultVoicingId: identityId === "pc:5/major" ? "e-closed-01" : "open-01" })),
  customVoicings: [],
});
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const stableId = (value: unknown) =>
  typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/i.test(value);
const userId = (value: unknown) =>
  typeof value === "string" &&
  /^user:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const identityId = (value: unknown) =>
  typeof value === "string" &&
  (/^pc:(?:[0-9]|1[01])\/(?:major|m|7|maj7|m7|dim|dim7|m7b5|aug|sus2|sus4|add9|6|m6|9|m9)$/.test(
    value,
  ) ||
    userId(value));
const validTuning = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length === 6 &&
  value.every(
    (s) =>
      object(s) &&
      exact(s, ["pitch", "midi"]) &&
      typeof s.pitch === "string" &&
      /^[A-G](?:#|b)?-?\d$/.test(s.pitch) &&
      Number.isInteger(s.midi) &&
      Number(s.midi) >= 0 &&
      Number(s.midi) <= 127,
  );
const validDiagram = (value: unknown): value is ILXMChordDiagram => {
  if (
    !object(value) ||
    !exact(value, ["startFret", "fretCount", "strings", "barres"]) ||
    !Array.isArray(value.strings) ||
    !Array.isArray(value.barres)
  )
    return false;
  if (
    !value.strings.every(
      (s) => object(s) && exact(s, ["string", "fret", "finger"]),
    ) ||
    !value.barres.every(
      (b) =>
        object(b) && exact(b, ["fret", "minString", "maxString", "finger"]),
    )
  )
    return false;
  try {
    return validateChordDiagram(value as unknown as ILXMChordDiagram) === null;
  } catch {
    return false;
  }
};
const customIssue = (value: unknown): string | null => {
  if (
    !object(value) ||
    !exact(value, ["id", "voicingId", "name", "diagram", "tuning"])
  )
    return "收藏字段无效或含未知字段";
  if (!userId(value.id) || !stableId(value.voicingId)) return "收藏身份无效";
  if (
    typeof value.name !== "string" ||
    normalizeMusicText(value.name, 32) !== value.name
  )
    return "收藏名称须为非空单行文字，最多 32 字符";
  if (!validDiagram(value.diagram)) return "收藏指法图无效";
  if (!validTuning(value.tuning)) return "收藏调弦无效";
  return null;
};
const parse = (
  raw: string,
  salvage: boolean,
): {
  value: ChordPreferencesV1 | null;
  issues: string[];
  unsupported?: boolean;
} => {
  let data: unknown;
  try {
    if (new TextEncoder().encode(raw).length > CHORD_IMPORT_LIMIT)
      throw new Error();
    data = JSON.parse(raw);
  } catch {
    return { value: null, issues: ["配置不是有效 JSON 或超过 1 MiB"] };
  }
  if (!object(data) || data.format !== "lxm-chord-preferences")
    return { value: null, issues: ["配置格式无效"] };
  if (Number.isInteger(data.version) && data.version !== 1)
    return {
      value: null,
      issues: ["配置版本暂不支持，原记录已保留"],
      unsupported: true,
    };
  if (
    data.version !== 1 ||
    !exact(data, [
      "format",
      "version",
      "revision",
      "quickItems",
      "customVoicings",
    ]) ||
    typeof data.revision !== "string" ||
    !data.revision ||
    !Array.isArray(data.quickItems) ||
    !Array.isArray(data.customVoicings)
  )
    return { value: null, issues: ["配置字段无效或含未知字段"] };
  if (data.quickItems.length > 6 || data.customVoicings.length > 200)
    return { value: null, issues: ["我的常用最多 6 项，我的指法最多 200 项"] };
  const issues: string[] = [],
    customVoicings: CustomChordVoicing[] = [],
    quickItems: ChordQuickReference[] = [];
  const customIds = new Set<string>(),
    quickIds = new Set<string>();
  for (const [i, custom] of data.customVoicings.entries()) {
    const issue = customIssue(custom);
    if (issue || customIds.has(custom.id)) {
      issues.push(`收藏 ${i + 1}：${issue ?? "身份重复"}`);
      continue;
    }
    customIds.add(custom.id);
    customVoicings.push(custom as CustomChordVoicing);
  }
  for (const [i, ref] of data.quickItems.entries()) {
    if (
      !object(ref) ||
      !exact(ref, ["identityId", "defaultVoicingId"]) ||
      !identityId(ref.identityId) ||
      !stableId(ref.defaultVoicingId) ||
      quickIds.has(String(ref.identityId))
    ) {
      issues.push(`常用 ${i + 1}：引用无效或身份重复`);
      continue;
    }
    const reference = ref as unknown as ChordQuickReference;
    if (
      reference.identityId.startsWith("user:") &&
      !customVoicings.some(
        (c) =>
          c.id === reference.identityId &&
          c.voicingId === reference.defaultVoicingId,
      )
    )
      issues.push(`常用 ${i + 1}：收藏引用缺失`);
    quickIds.add(reference.identityId);
    quickItems.push(reference);
  }
  return {
    value:
      issues.length && !salvage
        ? null
        : {
            format: "lxm-chord-preferences",
            version: 1,
            revision: data.revision,
            quickItems,
            customVoicings,
          },
    issues,
  };
};
export const createMemoryChordPreferencesStorage =
  (): ChordPreferencesStorage => {
    const values = new Map<string, string>();
    return {
      persistence: "memory",
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    };
  };
const browserStorage: ChordPreferencesStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  subscribe: (listener) => {
    const handler = (event: StorageEvent) => {
      if (event.key === CHORD_PREFERENCES_KEY || event.key === null) listener();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  },
};
export const createChordPreferencesStore = (
  storage: ChordPreferencesStorage = browserStorage,
) => {
  const initial: ChordPreferencesSnapshot = freeze({
    preferences: createDefaultChordPreferences(),
    persistence: "memory",
    status: "ready",
    issues: [],
    rawBackup: null,
  });
  let snapshot = initial,
    loaded = false,
    persistedRaw: string | null = null,
    subscription: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: ChordPreferencesSnapshot) => {
    snapshot = freeze(next);
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* Other subscribers still receive the state. */
      }
    }
  };
  const read = () => {
    try {
      const raw = storage.getItem(CHORD_PREFERENCES_KEY);
      persistedRaw = raw;
      if (raw === null) {
        publish({ ...initial, persistence: storage.persistence ?? "browser" });
        return;
      }
      const result = parse(raw, true);
      publish({
        preferences: result.value ?? createDefaultChordPreferences(),
        persistence: storage.persistence ?? "browser",
        status: result.unsupported
          ? "unsupported"
          : result.issues.length
            ? "quarantined"
            : "ready",
        issues: result.issues,
        rawBackup: result.issues.length ? raw : null,
      });
    } catch {
      publish({
        ...snapshot,
        persistence: "memory",
        status: "error",
        issues: ["浏览器配置不可用；本次会话可用，未保存到浏览器"],
      });
    }
  };
  const load = () => {
    if (loaded) return;
    loaded = true;
    read();
    try {
      subscription = storage.subscribe?.(read);
    } catch {
      publish({
        ...snapshot,
        issues: [...snapshot.issues, "无法订阅其他标签的配置更新"],
      });
    }
  };
  const save = (
    value: ChordPreferencesValue,
    expectedRevision: string,
    options: { discardQuarantine?: boolean } = {},
  ): ChordPreferencesSaveResult => {
    load();
    if (snapshot.preferences.revision !== expectedRevision)
      return {
        ok: false,
        error: "其他标签已更新，请加载外部配置或核对后保留本地输入",
        conflict: true,
      };
    const unsupported = snapshot.status === "unsupported";
    if (snapshot.rawBackup && !unsupported && !options.discardQuarantine)
      return { ok: false, error: "请先导出原始记录并显式处理隔离项" };
    let candidate: ChordPreferencesV1, serialized: string;
    try {
      candidate = {
        ...clone(value),
        format: "lxm-chord-preferences",
        version: 1,
        revision: uuid(),
      };
      serialized = JSON.stringify(candidate);
    } catch {
      return { ok: false, error: "配置无法序列化，请检查输入" };
    }
    const checked = parse(serialized, false);
    if (!checked.value) return { ok: false, error: checked.issues.join("；") };
    if (unsupported) {
      publish({
        ...snapshot,
        preferences: candidate,
        persistence: "memory",
        issues: [
          "配置版本暂不支持，原记录已保留；本次会话可用，未保存到浏览器",
        ],
      });
      return { ok: true, persistence: "memory" };
    }
    let persistence: "browser" | "memory" = storage.persistence ?? "browser";
    try {
      const current = storage.getItem(CHORD_PREFERENCES_KEY);
      if (current !== persistedRaw) {
        read();
        return {
          ok: false,
          error: "其他标签已更新，请核对配置后重试",
          conflict: true,
        };
      }
      storage.setItem(CHORD_PREFERENCES_KEY, serialized);
      persistedRaw = serialized;
      if (storage.getItem(CHORD_PREFERENCES_KEY) !== serialized) {
        read();
        return {
          ok: false,
          error: "保存时其他标签已更新，请重新核对",
          conflict: true,
        };
      }
    } catch {
      persistence = "memory";
    }
    publish({
      preferences: candidate,
      persistence,
      status: persistence === "memory" ? "error" : "ready",
      issues: persistence === "memory" ? ["本次会话可用，未保存到浏览器"] : [],
      rawBackup: null,
    });
    return { ok: true, persistence };
  };
  const parseImport = (raw: string): ChordImportPreview => {
    const result = parse(raw, false),
      before = snapshot.preferences;
    const validRecords = result.value ?? parse(raw, true).value;
    return {
      ok: !!result.value,
      value: result.value,
      issues: result.issues,
      expectedRevision: before.revision,
      before: {
        quick: before.quickItems.length,
        custom: before.customVoicings.length,
      },
      after: {
        quick: validRecords?.quickItems.length ?? 0,
        custom: validRecords?.customVoicings.length ?? 0,
      },
      unresolvedReferences:
        validRecords?.quickItems.filter(
          (r) => !r.identityId.startsWith("user:"),
        ) ?? [],
    };
  };
  return {
    load,
    save,
    parseImport,
    replaceImport: (
      preview: ChordImportPreview,
      options?: { discardQuarantine?: boolean },
    ): ChordPreferencesSaveResult =>
      preview.ok && preview.value
        ? save(preview.value, preview.expectedRevision, options)
        : { ok: false, error: preview.issues.join("；") || "导入预览无效" },
    export: () => JSON.stringify(snapshot.preferences, null, 2),
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      subscription?.();
      listeners.clear();
    },
  };
};
export const chordPreferencesStore = createChordPreferencesStore();
export const useChordPreferences = () => {
  const state = useSyncExternalStore(
    chordPreferencesStore.subscribe,
    chordPreferencesStore.getSnapshot,
    chordPreferencesStore.getServerSnapshot,
  );
  useEffect(() => {
    chordPreferencesStore.load();
  }, []);
  return state;
};
export const saveCustomChordVoicing = (
  seed: ChordDraft,
  tuning: readonly { pitch: string; midi: number }[],
): ChordPreferencesSaveResult => {
  chordPreferencesStore.load();
  if (!seed.chord.diagram) return { ok: false, error: "请先创建合法指法图" };
  const preferences = chordPreferencesStore.getSnapshot().preferences;
  const custom: CustomChordVoicing = {
    id: `user:${uuid()}`,
    voicingId: uuid(),
    name: seed.chord.name,
    diagram: clone(seed.chord.diagram),
    tuning: tuning.map(({ pitch, midi }) => ({ pitch, midi })),
  };
  return chordPreferencesStore.save(
    {
      quickItems: preferences.quickItems,
      customVoicings: [...preferences.customVoicings, custom],
    },
    preferences.revision,
  );
};
