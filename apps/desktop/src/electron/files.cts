import { randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { access, lstat, open, realpath, rename, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

export const SCORE_MAX_BYTES = 10 * 1024 * 1024;
// 编辑器的 200 MiB 上限按 PNG 总大小计算，另留空间给 ZIP 条目与目录。
export const OUTPUT_MAX_BYTES = 201 * 1024 * 1024;
export const OUTPUT_CHUNK_BYTES = 4 * 1024 * 1024;

export class FileProblem extends Error {}

const changedMessage = "目标文件已被外部修改、移走或替换。请重新打开文件，或选择新位置另存。";

function systemCode(error: unknown) {
  return (error as NodeJS.ErrnoException | null)?.code;
}

export function fileErrorMessage(error: unknown, fallback: string) {
  if (error instanceof FileProblem) return error.message;
  switch (systemCode(error)) {
    case "EACCES":
    case "EPERM":
    case "EROFS":
      return "没有权限访问文件，或文件正在被其他程序使用。请检查权限或选择其他位置。";
    case "EBUSY":
      return "文件正在被其他程序使用。请关闭占用程序后重试，或选择其他位置。";
    case "EDQUOT":
    case "ENOSPC":
      return "磁盘可用空间不足。请清理空间后重试，或选择其他位置。";
    case "ENAMETOOLONG":
      return "文件名或路径过长，请选择更短的位置。";
    case "ENOENT":
      return "文件或所在文件夹已不存在。请重新选择。";
    default:
      return fallback;
  }
}

export async function canonicalTarget(path: string) {
  // 统一对同一目录的别名，并保留用户选中的文件名，由 lstat 拒绝文件本身的链接。
  return join(await realpath(dirname(path)), basename(path));
}

export function suggestedFilename(name: unknown, extension: string) {
  if (typeof name !== "string" || name.length > 1024) {
    throw new FileProblem("文件名称无效。");
  }

  // renderer 的建议值只作为文件名使用，始终由原生对话框决定实际目录。
  const clean = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  const stem = clean.toLowerCase().endsWith(extension) ? clean.slice(0, -extension.length) : clean;
  return `${Array.from(stem).slice(0, 60).join("").replace(/[. ]+$/u, "").trim() || "未命名"}${extension}`;
}

export function withExtension(path: string, extension: string) {
  return extname(path).toLowerCase() === extension ? path : `${path}${extension}`;
}

export async function fileSnapshot(path: string) {
  try {
    const stat = await lstat(path, { bigint: true });
    if (!stat.isFile()) throw new FileProblem("请选择普通文件。文件夹和符号链接无法作为目标。");
    return stat;
  } catch (error) {
    if (systemCode(error) === "ENOENT") return null;
    throw error;
  }
}

function sameContents(before: BigIntStats, after: BigIntStats) {
  return before.dev === after.dev && before.ino === after.ino &&
    before.size === after.size && before.mtimeNs === after.mtimeNs;
}

function sameVersion(before: BigIntStats | null, after: BigIntStats | null) {
  if (before === null || after === null) return before === after;
  return sameContents(before, after) && before.ctimeNs === after.ctimeNs;
}

export async function requireCurrentVersion(path: string, expected: BigIntStats | null) {
  const current = await fileSnapshot(path);
  if (!sameVersion(expected, current)) throw new FileProblem(changedMessage);
}

export async function readScore(path: string) {
  if (extname(path).toLowerCase() !== ".lxm") throw new FileProblem("请选择 .lxm 曲谱文件。");
  const expected = await fileSnapshot(path);
  if (!expected) throw new FileProblem("曲谱已不存在，请重新选择。");
  if (expected.size > SCORE_MAX_BYTES) throw new FileProblem("曲谱文件超过 10 MiB。");

  // 对话框关闭后文件仍可能变化。打开同一版本，在固定缓冲区中读取，并在读取后复核路径和句柄。
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    if (!sameVersion(expected, await file.stat({ bigint: true }))) throw new FileProblem(changedMessage);
    const bytes = new ArrayBuffer(Number(expected.size));
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) throw new FileProblem(changedMessage);
      offset += bytesRead;
    }
    if (!sameVersion(expected, await file.stat({ bigint: true }))) throw new FileProblem(changedMessage);
    await requireCurrentVersion(path, expected);
    return { bytes, version: expected };
  } finally {
    await file.close();
  }
}

export class FileReplacement {
  private committed = false;
  private handle: FileHandle | null;

  private constructor(
    private readonly path: string,
    private readonly expected: BigIntStats | null,
    private readonly temporary: string,
    handle: FileHandle,
  ) {
    this.handle = handle;
  }

  static async create(path: string, expected: BigIntStats | null) {
    const temporary = join(dirname(path), `.lxm-${randomUUID()}.tmp`);
    // 同目录和排他创建确保最后只需一次原子替换，磁盘空间不足或写入中断时原目标仍可读。
    const handle = await open(temporary, "wx", 0o600);
    return new FileReplacement(path, expected, temporary, handle);
  }

  async append(bytes: ArrayBuffer | Uint8Array) {
    if (!this.handle) throw new FileProblem("此文件写入任务已结束。");
    await this.handle.writeFile(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
  }

  async commit() {
    if (!this.handle) throw new FileProblem("此文件写入任务已结束。");
    if (this.expected && process.platform !== "win32") {
      await this.handle.chmod(Number(this.expected.mode & 0o777n));
    }
    await this.handle.sync();
    const written = await this.handle.stat({ bigint: true });
    await this.closeHandle();
    // POSIX 允许有目录权限的用户替换只读文件。这里尊重原文件的写权限，再复核版本。
    if (this.expected) {
      await access(this.path, constants.W_OK).catch((error: unknown) => {
        if (systemCode(error) === "ENOENT") throw new FileProblem(changedMessage);
        throw error;
      });
    }
    // 原生重命名前再次检查目标版本。复核到 rename 之间无法跨平台锁住外部写入者。
    await requireCurrentVersion(this.path, this.expected);
    await rename(this.temporary, this.path);
    this.committed = true;

    // rename 可能改变 ctime。仅当目标仍是刚写入的文件时才记录最新版本，避免把外部替换当成本次结果。
    const current = await fileSnapshot(this.path).catch(() => null);
    return current && sameContents(written, current) ? current : written;
  }

  private async closeHandle() {
    const handle = this.handle;
    this.handle = null;
    await handle?.close();
  }

  async discard() {
    await this.closeHandle().catch(() => undefined);
    if (!this.committed) await unlink(this.temporary).catch(() => undefined);
  }
}
