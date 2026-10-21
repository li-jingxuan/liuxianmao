import { spawn } from "node:child_process";

// 三份脚本使用独立 Chrome 实例，报告与截图分开保存。
const scripts = ["s3-a-smoke", "browser-smoke", "zoom-smoke"];
const results = await Promise.all(
  scripts.map(
    (name) =>
      new Promise<number>((resolve) => {
        const child = spawn(
          process.execPath,
          [`artifacts/ui-phase3-20261018/${name}.mts`],
          { stdio: "inherit", env: process.env },
        );
        child.on("error", (error) => {
          process.stderr.write(`${name}: ${error.message}\n`);
          resolve(1);
        });
        child.on("exit", (code) => resolve(code ?? 1));
      }),
  ),
);
process.exitCode = results.some((code) => code !== 0) ? 1 : 0;
