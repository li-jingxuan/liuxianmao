import { randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { realpath } from "node:fs/promises";
import { basename, extname } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import type { EditorHostFile, EditorHostResult } from "@liuxianmao/lxm-editor-react" with { "resolution-mode": "import" };
import {
  canonicalTarget, FileProblem, FileReplacement, fileErrorMessage, fileSnapshot,
  OUTPUT_CHUNK_BYTES, OUTPUT_MAX_BYTES, readScore, requireCurrentVersion,
  SCORE_MAX_BYTES, suggestedFilename, withExtension,
} from "./files.cjs";
import { LIBRARY_READ_ERROR, LIBRARY_WRITE_ERROR, LibraryIndex, sameLibraryPath, scoreSummary } from "./library-index.cjs";
import type { LibraryOutcome, ScoreCandidate } from "./library-types.cjs";

type ScoreTarget = { path: string; version: BigIntStats };
type CandidateMode = { kind: "open" | "import" } | { kind: "indexed" | "relocate"; entryId: string };
type PreviewTarget = ScoreTarget & { id: string; mode: CandidateMode };
type Registration = Parameters<LibraryIndex["register"]>[0];
type PendingRegistration = { id: string; target: ScoreTarget; registration: Registration };
type OutputTransfer = { id: string; size: number; written: number; replacement: FileReplacement };

const cancelled = { status: "cancelled" } as const;
const ok = <T,>(value: T): EditorHostResult<T> => ({ status: "ok", value });
const fail = (message: string) => ({ status: "error", message }) as const;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new FileProblem("无效的桌面宿主请求。");
  }
  return value as Record<string, unknown>;
}

export class WindowEditorHost {
  private readonly targets = new Map<string, ScoreTarget>();
  private readonly pendingRegistrations = new Map<string, PendingRegistration>();
  private preview: PreviewTarget | null = null;
  private working = false;
  private disposed = false;
  private output: OutputTransfer | null = null;

  constructor(private readonly window: BrowserWindow, private readonly library: LibraryIndex) {}

  openScore() {
    return this.chooseScore({ kind: "open" });
  }

  importScore() {
    return this.chooseScore({ kind: "import" });
  }

  relocateScore(id: unknown) {
    return this.run("无法读取新位置的曲谱，请重新选择文件。", async () => {
      const entry = await this.library.entry(id);
      return this.selectScore({ kind: "relocate", entryId: entry.id });
    });
  }

  openLibraryScore(id: unknown) {
    return this.run("无法读取曲谱文件，请检查原件后重试。", async () => {
      const entry = await this.library.entry(id);
      await this.requireRegisteredPath(entry.path);
      const { bytes, version } = await readScore(entry.path);
      return this.prepareScore(entry.path, version, bytes, { kind: "indexed", entryId: entry.id }, true);
    });
  }

  private chooseScore(mode: CandidateMode) {
    return this.run("无法读取曲谱文件，请检查文件后重试。", async () => {
      return this.selectScore(mode);
    });
  }

  private async selectScore(mode: CandidateMode) {
    const title = mode.kind === "import" ? "选择要导入的曲谱" : mode.kind === "relocate" ? "定位本地文件" : "打开曲谱";
    const choice = await dialog.showOpenDialog(this.window, {
      title, properties: ["openFile"], filters: [{ name: "六线猫曲谱", extensions: ["lxm"] }],
    });
    if (choice.canceled || choice.filePaths.length !== 1 || this.disposed) return cancelled;
    const selected = await canonicalTarget(choice.filePaths[0]);
    const { bytes, version } = await readScore(selected);
    // 只解析已读且确认为普通文件的原件；用实际拼写去重，再检查解析期间文件是否被替换。
    const path = await realpath(selected);
    await requireCurrentVersion(selected, version);
    await requireCurrentVersion(path, version);
    // 预览原件本身不依赖索引。导入、打开、重定位的实际登记在确认阶段进行。
    const entries = await this.library.list().catch(() => []);
    const existing = entries.find((entry) => sameLibraryPath(entry.path, path));
    if (mode.kind === "relocate" && existing && existing.id !== mode.entryId) {
      throw new FileProblem("这份文件已由另一条谱库记录登记，请重新选择。");
    }
    return this.prepareScore(path, version, bytes, mode, !!existing);
  }

  private prepareScore(path: string, version: BigIntStats, bytes: ArrayBuffer, mode: CandidateMode, registered: boolean) {
    if (this.disposed) return cancelled;
    // 预览只获发一次性令牌，确认前不能用于保存。选择文件、打开旧谱取消时不改变原会话授权。
    const id = randomUUID();
    this.preview = { id, path, version, mode };
    return ok<ScoreCandidate>({ id, name: basename(path), path, bytes, registered });
  }

  acceptScore(id: unknown, value: unknown) {
    return this.run("无法确认曲谱，请重新选择后重试。", async () => {
      const target = this.preview;
      if (!target || target.id !== id) throw new FileProblem("曲谱预览已失效，请重新选择。");
      const { path, version, mode } = target;
      const summary = scoreSummary(value);
      await this.requireRegisteredPath(path);
      await requireCurrentVersion(path, version);
      if (this.disposed || this.preview !== target) return cancelled;
      const registration: Registration = { path, summary, fileTime: Number(version.mtimeMs) };
      if (mode.kind !== "import") registration.openedAt = Date.now();
      if (mode.kind === "relocate") registration.relocateId = mode.entryId;
      if (mode.kind === "indexed") registration.openedId = mode.entryId;

      const file = { id: target.id, name: basename(path) };
      let outcome: LibraryOutcome<EditorHostFile> = { file };
      if (mode.kind === "import" || mode.kind === "relocate") {
        // 导入和重定位只有索引持久化后才完成。重定位失败时保留旧路径和显示名。
        await this.library.register(registration);
      } else {
        outcome = await this.registerFile(file, target, registration, "原件已打开");
      }
      this.preview = null;
      if (mode.kind !== "import") this.bindScore(path, version, target.id);
      return ok(outcome);
    });
  }

  discardScore(id: unknown) {
    if (this.preview?.id === id) this.preview = null;
    return ok(undefined);
  }

  listLibrary() {
    return this.run(LIBRARY_READ_ERROR, async () => ok(await this.library.list()));
  }

  renameLibraryScore(id: unknown, name: unknown) {
    return this.run(LIBRARY_WRITE_ERROR, async () => {
      await this.library.rename(id, name);
      return ok(undefined);
    });
  }

  removeLibraryScore(id: unknown) {
    return this.run(LIBRARY_WRITE_ERROR, async () => {
      await this.library.remove(id);
      return ok(undefined);
    });
  }

  retryRegistration(id: unknown) {
    return this.run(LIBRARY_WRITE_ERROR, async () => {
      if (typeof id !== "string") throw new FileProblem("无效的谱库登记标识。");
      const pending = this.pendingRegistrations.get(id);
      if (!pending) return ok(undefined);
      await this.requireRegisteredPath(pending.target.path);
      await requireCurrentVersion(pending.target.path, pending.target.version);
      await this.library.register(pending.registration);
      this.pendingRegistrations.delete(id);
      return ok(undefined);
    });
  }

  saveScore(value: unknown, details: unknown) {
    return this.run("无法保存曲谱，请检查磁盘后重试，或选择其他位置另存。", async () => {
      const { fileId, suggestedName, text, confirmUpgrade } = record(value);
      if (typeof text !== "string" || (confirmUpgrade !== undefined && typeof confirmUpgrade !== "boolean")) {
        throw new FileProblem("无效的曲谱保存请求。");
      }
      if (text.length > SCORE_MAX_BYTES || Buffer.byteLength(text, "utf8") > SCORE_MAX_BYTES) {
        throw new FileProblem("曲谱文件超过 10 MiB。");
      }
      const summary = scoreSummary(details);

      const name = suggestedFilename(suggestedName, ".lxm");
      let path: string;
      let expected: BigIntStats | null;
      let id: string | undefined;
      if (fileId !== undefined) {
        if (typeof fileId !== "string" || fileId.length !== 36) throw new FileProblem("曲谱文件标识无效。");
        const target = this.targets.get(fileId);
        if (!target) throw new FileProblem("此曲谱文件已失去窗口授权。请重新打开或选择另存。");
        ({ path, version: expected } = target);
        id = fileId;
        await this.requireRegisteredPath(path);
        await requireCurrentVersion(path, expected);
      } else {
        const selection = await this.chooseTarget("保存曲谱", name, ".lxm", "六线猫曲谱");
        if (!selection) return cancelled;
        ({ path, expected } = selection);
      }

      while (expected && (confirmUpgrade && id !== undefined || await this.isLegacyScore(path))) {
        const choice = await dialog.showMessageBox(this.window, {
          title: "升级曲谱格式",
          type: "warning",
          message: "保存将用当前格式替换旧曲谱。",
          detail: "如需保留旧文件，请取消并另存为新文件。",
          buttons: ["升级并覆盖", "取消", "另存为…"],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });
        if (choice.response === 0) break;
        if (choice.response !== 2) return cancelled;
        const selection = await this.chooseTarget("另存曲谱", name, ".lxm", "六线猫曲谱");
        if (!selection) return cancelled;
        ({ path, expected } = selection);
        id = undefined;
      }
      if (this.disposed) return cancelled;

      await this.requireRegisteredPath(path);
      const replacement = await FileReplacement.create(path, expected);
      try {
        await replacement.append(Buffer.from(text, "utf8"));
        const version = await replacement.commit();
        // 文件落盘成功后立刻换保存基线。索引写入失败仅返回可重试的登记警告，避免二次覆盖原件。
        const savedAt = Date.now();
        const file = this.bindScore(path, version, id);
        const registration = { path, summary, fileTime: savedAt, savedAt, openedAt: id === undefined ? savedAt : undefined };
        return ok(await this.registerFile(file, { path, version }, registration, "原件已保存"));
      } finally {
        await replacement.discard();
      }
    });
  }

  beginOutput(value: unknown) {
    return this.run("无法选择导出位置，请检查路径后重试。", async () => {
      const { suggestedName, size } = record(value);
      if (typeof suggestedName !== "string" || typeof size !== "number" ||
          !Number.isSafeInteger(size) || size <= 0 || size > OUTPUT_MAX_BYTES) {
        throw new FileProblem("导出文件为空或超过支持的大小。");
      }
      const extension = extname(suggestedName).toLowerCase();
      if (extension !== ".png" && extension !== ".zip") throw new FileProblem("仅支持导出 PNG 或 ZIP 文件。");
      const selection = await this.chooseTarget(
        "导出曲谱", suggestedFilename(suggestedName, extension), extension,
        extension === ".png" ? "PNG 图片" : "ZIP 压缩包",
      );
      if (!selection || this.disposed) return cancelled;
      const replacement = await FileReplacement.create(selection.path, selection.expected);
      if (this.disposed) {
        await replacement.discard();
        return cancelled;
      }
      const id = randomUUID();
      this.output = { id, size, written: 0, replacement };
      return ok(id);
    });
  }

  outputChunk(id: unknown, bytes: unknown) {
    return this.run("无法写入导出文件，请检查磁盘后重试。", async () => {
      const transfer = this.requireOutput(id);
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0 || bytes.byteLength > OUTPUT_CHUNK_BYTES ||
          transfer.written + bytes.byteLength > transfer.size) throw new FileProblem("导出文件的数据块无效。");
      await transfer.replacement.append(bytes);
      transfer.written += bytes.byteLength;
      return ok(undefined);
    }, true);
  }

  finishOutput(id: unknown) {
    return this.run("无法写入导出文件，请检查磁盘后重试。", async () => {
      const transfer = this.requireOutput(id);
      try {
        if (transfer.written !== transfer.size) throw new FileProblem("导出文件的数据不完整，请重试。");
        await transfer.replacement.commit();
        return ok(undefined);
      } finally {
        this.output = null;
        await transfer.replacement.discard();
      }
    }, true);
  }

  abortOutput(id: unknown) {
    return this.run("无法取消导出文件。", async () => {
      if (this.output?.id === id) await this.discardOutput();
      return ok(undefined);
    }, true);
  }

  print() {
    return this.run("无法打开系统打印对话框，请检查打印设置后重试。", () => new Promise<EditorHostResult>((resolve) => {
      // 编辑器负责准备并清理预览。原生打印仅发送当前窗口、已就绪的预览，并等待系统回执。
      this.window.webContents.print({
        silent: false,
        printBackground: true,
        pageSize: "A4",
        margins: { marginType: "none" },
      }, (success, reason) => {
        if (success) resolve(ok(undefined));
        else if (/cancel/i.test(reason)) resolve(cancelled);
        else resolve(fail("系统打印失败，请检查打印机或系统打印设置后重试。"));
      });
    }));
  }

  dispose() {
    this.disposed = true;
    this.targets.clear();
    this.preview = null;
    this.pendingRegistrations.clear();
    if (!this.working) void this.discardOutput();
  }

  private async chooseTarget(title: string, name: string, extension: string, filterName: string) {
    const choice = await dialog.showSaveDialog(this.window, {
      title,
      defaultPath: name,
      filters: [{ name: filterName, extensions: [extension.slice(1)] }],
      properties: ["createDirectory"],
    });
    if (choice.canceled || !choice.filePath || this.disposed) return null;
    const extendedPath = withExtension(choice.filePath, extension);
    let path = await canonicalTarget(extendedPath);
    const expected = await fileSnapshot(path);
    if (expected) {
      path = await realpath(path);
      await requireCurrentVersion(path, expected);
    }
    if (expected && extendedPath !== choice.filePath) {
      // 系统只确认自身选中的名称。自动追加后缀产生的同名文件必须另行取得用户同意。
      const confirmation = await dialog.showMessageBox(this.window, {
        type: "warning",
        message: `替换已有的“${basename(path)}”？`,
        buttons: ["替换", "取消"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (confirmation.response !== 0) return null;
    }
    return { path, expected };
  }

  private bindScore(path: string, version: BigIntStats, id: string = randomUUID()): EditorHostFile {
    if (!this.disposed) this.targets.set(id, { path, version });
    return { id, name: basename(path) };
  }

  private async requireRegisteredPath(path: string) {
    // 持久化授权指向原先解析过的目录，避免原目录换成符号链接后把稳定 ID 导向未选择的路径。
    if (!sameLibraryPath(await canonicalTarget(path), path)) {
      throw new FileProblem("原件所在目录已改变，请在谱库重新定位曲谱。");
    }
  }

  private async isLegacyScore(path: string) {
    // 另存也可能选中已有旧谱。原生替换确认仍保留，格式覆盖需要独立确认。
    try {
      const { bytes } = await readScore(path);
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      return typeof value === "object" && value !== null && "schemaVersion" in value &&
        [4, 5, 6, 7].includes(value.schemaVersion as number);
    } catch {
      return false;
    }
  }

  private async registerFile(file: EditorHostFile, target: ScoreTarget, registration: Registration, action: string): Promise<LibraryOutcome<EditorHostFile>> {
    const previous = [...this.pendingRegistrations.values()].find((item) => sameLibraryPath(item.target.path, target.path));
    try {
      await this.library.register(registration);
      if (previous) this.pendingRegistrations.delete(previous.id);
      return { file, resolvedWarning: previous?.id };
    } catch (error) {
      const id = previous?.id ?? randomUUID();
      if (!this.disposed) this.pendingRegistrations.set(id, { id, target, registration });
      const message = fileErrorMessage(error, LIBRARY_WRITE_ERROR);
      return { file, warning: { id, message: `${action}「${file.name}」，但谱库登记失败。${message}` } };
    }
  }

  private requireOutput(id: unknown) {
    if (!this.output || this.output.id !== id) throw new FileProblem("导出任务已结束，请重新导出。");
    return this.output;
  }

  private async discardOutput() {
    const pending = this.output;
    this.output = null;
    await pending?.replacement.discard();
  }

  private async run<T>(fallback: string, operation: () => Promise<EditorHostResult<T>>, continuingOutput = false) {
    // 单窗口同一时刻只处理一个原生操作。包括写入阶段，确保同一目标的多次保存不会交叉。
    if (this.disposed) return cancelled;
    if (this.working || (!continuingOutput && this.output)) return fail("另一个文件或打印操作还未完成，请稍后重试。");
    this.working = true;
    try {
      return await operation();
    } catch (error) {
      return fail(fileErrorMessage(error, fallback));
    } finally {
      this.working = false;
      if (this.disposed) await this.discardOutput();
    }
  }
}
