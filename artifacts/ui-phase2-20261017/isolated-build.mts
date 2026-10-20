import {
  mkdtemp,
  readdir,
  symlink,
  copyFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "apps/website");
const target = await mkdtemp(path.join(tmpdir(), "lxm-ui-phase2-build-"));
// 只隔离构建产物；源码与依赖指向当前工作区，TS 自动生成文件单独复制。
for (const entry of await readdir(source, { withFileTypes: true })) {
  if ([".next", "tsconfig.tsbuildinfo"].includes(entry.name)) continue;
  const from = path.join(source, entry.name),
    to = path.join(target, entry.name);
  if (["tsconfig.json", "next-env.d.ts"].includes(entry.name))
    await copyFile(from, to);
  else await symlink(from, to, entry.isDirectory() ? "dir" : "file");
}
const require = createRequire(path.join(source, "package.json"));
const next = require.resolve("next/dist/bin/next");
const logs: string[] = [];
const build = spawn(process.execPath, [next, "build", target, "--webpack"], {
  cwd: source,
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
for (const stream of [build.stdout, build.stderr])
  stream.on("data", (chunk: Buffer) => {
    const value = chunk.toString();
    logs.push(value);
    process.stdout.write(value);
  });
const exitCode = await new Promise<number>((resolve) =>
  build.on("exit", (code) => resolve(code ?? 1)),
);
const report = {
  testedAt: new Date().toISOString(),
  source,
  target,
  exitCode,
  reason:
    "项目挂载目录 access(W_OK) 返回 EPERM，但实际写入成功；隔离产物避免修改产品配置或依赖。",
};
await writeFile(
  path.join(root, "artifacts/ui-phase2-20261017/build-report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
await writeFile(
  path.join(root, "artifacts/ui-phase2-20261017/build.log"),
  logs.join(""),
);
console.log(`Build directory: ${target}`);
process.exitCode = exitCode;
