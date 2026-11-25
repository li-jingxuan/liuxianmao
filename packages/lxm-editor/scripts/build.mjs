import { rmSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const configPath = fileURLToPath(new URL("../tsconfig.build.json", import.meta.url));
const formatHost = {
  getCanonicalFileName: (file) => file,
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  getNewLine: () => ts.sys.newLine,
};
const report = (diagnostic) => process.stderr.write(ts.formatDiagnostic(diagnostic, formatHost));

/**
 * 仓库内测试和脚本直接加载 TypeScript 源码，继续沿用原来的无后缀引用。
 * Node ESM 和 TypeScript NodeNext 都要求相对导入指向完整运行时路径，
 * 因此只在写入产物时补齐路径。交给 TypeScript 解析目录入口和类型引用，
 * 不按文本猜测路径，也不改动 Zod 等依赖的包名或普通业务字符串。
 */
const esmWriter = (options) => {
  const cache = ts.createModuleResolutionCache(ts.sys.getCurrentDirectory(), (file) => file, options);

  return (file, text, writeByteOrderMark, _onError, sources) => {
    const source = sources?.[0];
    if (!source || (!file.endsWith(".js") && !file.endsWith(".d.ts"))) {
      ts.sys.writeFile(file, text, writeByteOrderMark);
      return;
    }

    const emitted = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
    const edits = [];
    const visit = (node) => {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        specifier = node.moduleSpecifier;
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
        specifier = node.argument.literal;
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        specifier = node.arguments[0];
      }

      if (specifier && ts.isStringLiteralLike(specifier) && /^\.{1,2}(?:\/|$)/.test(specifier.text)) {
        const { resolvedModule } = ts.resolveModuleName(specifier.text, source.fileName, options, ts.sys, cache);
        if (!resolvedModule || resolvedModule.extension !== ts.Extension.Ts) {
          throw new Error(`Core 构建无法生成 ESM 路径 ${source.fileName} → ${specifier.text}`);
        }
        const path = relative(dirname(source.fileName), resolvedModule.resolvedFileName)
          .split(sep).join("/").replace(/\.ts$/, ".js");
        const esmPath = path.startsWith("../") ? path : `./${path}`;
        edits.push([specifier.getStart(emitted), specifier.end, JSON.stringify(esmPath)]);
      }
      ts.forEachChild(node, visit);
    };
    visit(emitted);
    // 从后往前替换，保留编译器生成的类型声明、格式和中文注释。
    for (const [start, end, value] of edits.reverse()) {
      text = text.slice(0, start) + value + text.slice(end);
    }
    ts.sys.writeFile(file, text, writeByteOrderMark);
  };
};

const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: report,
});
if (!config || config.errors.length) {
  config?.errors.forEach(report);
  process.exit(1);
}

if (process.argv.includes("--watch")) {
  const host = ts.createWatchCompilerHost(configPath, {}, ts.sys, ts.createEmitAndSemanticDiagnosticsBuilderProgram, report, report);
  host.afterProgramCreate = (builder) => {
    const result = builder.emit(undefined, esmWriter(builder.getCompilerOptions()));
    result.diagnostics.forEach(report);
    if (!result.emitSkipped) process.stdout.write("Core ESM 构建完成，继续监听源文件。\n");
  };
  ts.createWatchProgram(host);
} else {
  // 发布构建清掉旧产物。开发监听保留初次构建产物，避免并行启动的宿主读到缺失的入口。
  rmSync(config.options.outDir, { recursive: true, force: true });
  const program = ts.createProgram(config.fileNames, config.options);
  const result = program.emit(undefined, esmWriter(config.options));
  result.diagnostics.forEach(report);
  if (result.emitSkipped) process.exitCode = 1;
}
