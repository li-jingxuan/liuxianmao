import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import type { LibraryEntry, ScoreSummary } from "./library-types.cjs";
import { FileProblem, FileReplacement, fileSnapshot, requireCurrentVersion } from "./files.cjs";

const INDEX_VERSION = 1;
const INDEX_LIMIT = 16 * 1024 * 1024;
export const LIBRARY_READ_ERROR = "无法读取本机谱库索引，请检查应用数据目录后重试。";
export const LIBRARY_WRITE_ERROR = "无法写入本机谱库索引，请检查应用数据目录后重试。";

type Registration = {
  path: string;
  summary: ScoreSummary;
  fileTime: number;
  openedAt?: number;
  savedAt?: number;
  relocateId?: string;
  openedId?: string;
};

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

function date(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 8.64e15;
}

function validSummary(value: unknown): value is ScoreSummary {
  return object(value) && text(value.title, 256) && text(value.arranger, 128) && text(value.tonality, 48) &&
    text(value.meter, 20) && /^\d+\/\d+$/.test(value.meter) && typeof value.measures === "number" &&
    Number.isSafeInteger(value.measures) && value.measures >= 1;
}

export function scoreSummary(value: unknown): ScoreSummary {
  if (!validSummary(value)) throw new FileProblem("曲谱摘要无效，请重新打开文件。");
  const { title, arranger, tonality, meter, measures } = value;
  return { title, arranger, tonality, meter, measures };
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
}

function validEntry(value: unknown): value is LibraryEntry {
  if (!object(value)) return false;
  return validId(value.id) && text(value.path, 32767) && isAbsolute(value.path) &&
    !value.path.includes("\0") && extname(value.path).toLowerCase() === ".lxm" &&
    value.name === basename(value.path) && text(value.displayName, 128) &&
    date(value.savedAt) && date(value.openedAt) && validSummary(value);
}

function pathKey(path: string) {
  // 父目录和现存文件的规范拼写由系统解析。Windows 同一路径还可能以大小写不同的方式返回。
  return process.platform === "win32" ? path.toLowerCase() : path;
}

export function sameLibraryPath(left: string, right: string) {
  return pathKey(left) === pathKey(right);
}

function requireEntry(entries: LibraryEntry[], id: unknown) {
  if (!validId(id)) throw new FileProblem("无效的谱库条目标识。");
  const entry = entries.find((item) => item.id === id);
  if (!entry) throw new FileProblem("这份曲谱已从谱库移除，请刷新列表后重试。");
  return entry;
}

export class LibraryIndex {
  constructor(private readonly path: string) {}

  async list() {
    return (await this.read()).entries;
  }

  async entry(id: unknown) {
    return requireEntry(await this.list(), id);
  }

  async register(registration: Registration) {
    await this.mutate((entries) => {
      const { path, summary, fileTime, openedAt, savedAt, relocateId, openedId } = registration;
      const samePath = entries.find((entry) => sameLibraryPath(entry.path, path));
      const previous = relocateId || openedId ? requireEntry(entries, relocateId ?? openedId) : samePath;
      if (relocateId && samePath && samePath.id !== relocateId) {
        throw new FileProblem("这份文件已由另一条谱库记录登记，请重新选择。");
      }
      if (openedId && previous && !sameLibraryPath(previous.path, path)) {
        throw new FileProblem("此条目的文件位置已更新，请重新打开。");
      }
      // 同一路径保留条目身份和用户显示名。浏览原件不会改变「最近保存」的先后顺序。
      const next = {
        ...summary, id: previous?.id ?? randomUUID(), displayName: previous?.displayName ?? "",
        path, name: basename(path), savedAt: savedAt ?? previous?.savedAt ?? fileTime,
        openedAt: openedAt ?? previous?.openedAt ?? 0,
      };
      if (previous) entries[entries.indexOf(previous)] = next;
      else entries.push(next);
    });
  }

  rename(id: unknown, name: unknown) {
    if (typeof name !== "string" || !name.trim() || name.length > 128) throw new FileProblem("请输入有效的显示名。");
    return this.mutate((entries) => { requireEntry(entries, id).displayName = name.trim(); });
  }

  remove(id: unknown) {
    // 移除只处理应用数据目录中的索引，原件即使离线也能解除登记。
    return this.mutate((entries) => { entries.splice(entries.indexOf(requireEntry(entries, id)), 1); });
  }

  private async read() {
    // 应用升级或首次启动没有索引是正常空库。未知版本、损坏内容和权限错误必须保留，避免空库覆盖旧记录。
    const version = await fileSnapshot(this.path);
    if (!version) return { entries: [] as LibraryEntry[], version };
    if (version.size > INDEX_LIMIT) throw new FileProblem("本机谱库索引超过支持的大小。");
    const raw: unknown = JSON.parse(await readFile(this.path, "utf8"));
    await requireCurrentVersion(this.path, version);
    if (!object(raw) || raw.version !== INDEX_VERSION || !Array.isArray(raw.entries) || !raw.entries.every(validEntry)) {
      throw new FileProblem("本机谱库索引损坏或版本不兼容，请检查应用数据目录后重试。");
    }
    const entries = raw.entries as LibraryEntry[];
    if (new Set(entries.map(({ id }) => id)).size !== entries.length ||
        new Set(entries.map(({ path }) => pathKey(path))).size !== entries.length) {
      throw new FileProblem("本机谱库索引含重复记录，请检查后重试。");
    }
    return { entries, version };
  }

  private async mutate(update: (entries: LibraryEntry[]) => void) {
    const { entries, version } = await this.read();
    update(entries);
    const bytes = Buffer.from(JSON.stringify({ version: INDEX_VERSION, entries }), "utf8");
    if (bytes.byteLength > INDEX_LIMIT) throw new FileProblem("本机谱库索引超过支持的大小。");
    // 从最新快照构建下一版，写入失败时保留原索引。原件与索引独立提交，调用方决定是否可继续打开或编辑。
    const replacement = await FileReplacement.create(this.path, version);
    try {
      await replacement.append(bytes);
      await replacement.commit();
    } finally {
      await replacement.discard();
    }
  }
}
