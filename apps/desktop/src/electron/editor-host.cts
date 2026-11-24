import { randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { basename, extname } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import type { EditorHostFile, EditorHostResult } from "@liuxianmao/lxm-editor-react" with { "resolution-mode": "import" };
import {
  canonicalTarget, FileProblem, FileReplacement, fileErrorMessage, fileSnapshot,
  OUTPUT_CHUNK_BYTES, OUTPUT_MAX_BYTES, readScore, requireCurrentVersion,
  SCORE_MAX_BYTES, suggestedFilename, withExtension,
} from "./files.cjs";

type ScoreTarget = { path: string; version: BigIntStats };
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
  private working = false;
  private disposed = false;
  private output: OutputTransfer | null = null;

  constructor(private readonly window: BrowserWindow) {}

  openScore() {
    return this.run("无法读取曲谱文件，请检查文件后重试。", async () => {
      const choice = await dialog.showOpenDialog(this.window, {
        title: "打开曲谱",
        properties: ["openFile"],
        filters: [{ name: "六线猫曲谱", extensions: ["lxm"] }],
      });
      if (choice.canceled || choice.filePaths.length !== 1 || this.disposed) return cancelled;
      const path = await canonicalTarget(choice.filePaths[0]);
      const { bytes, version } = await readScore(path);
      // 每次打开都生成独立的基线。即使用户取消本次预览，旧会话的 ID 和文件版本也保持有效。
      return ok({ ...this.bindScore(path, version), bytes });
    });
  }

  saveScore(value: unknown) {
    return this.run("无法保存曲谱，请检查磁盘后重试，或选择其他位置另存。", async () => {
      const { fileId, suggestedName, text, confirmUpgrade } = record(value);
      if (typeof text !== "string" || (confirmUpgrade !== undefined && typeof confirmUpgrade !== "boolean")) {
        throw new FileProblem("无效的曲谱保存请求。");
      }
      if (text.length > SCORE_MAX_BYTES || Buffer.byteLength(text, "utf8") > SCORE_MAX_BYTES) {
        throw new FileProblem("曲谱文件超过 10 MiB。");
      }

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
        await requireCurrentVersion(path, expected);
      } else {
        const selection = await this.chooseTarget("保存曲谱", name, ".lxm", "六线猫曲谱");
        if (!selection) return cancelled;
        ({ path, expected } = selection);
      }

      if (confirmUpgrade && expected) {
        const choice = await dialog.showMessageBox(this.window, {
          title: "升级曲谱格式",
          type: "warning",
          message: "保存将用当前格式替换旧曲谱。",
          detail: "如需保留旧文件，请取消并另存为新文件。",
          buttons: ["升级并覆盖", "取消"],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });
        if (choice.response !== 0) return cancelled;
      }
      if (this.disposed) return cancelled;

      const replacement = await FileReplacement.create(path, expected);
      try {
        await replacement.append(Buffer.from(text, "utf8"));
        return ok(this.bindScore(path, await replacement.commit(), id));
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
    const path = await canonicalTarget(extendedPath);
    const expected = await fileSnapshot(path);
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
