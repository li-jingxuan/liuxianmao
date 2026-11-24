import { spawn } from "node:child_process";
import { once } from "node:events";
import electron from "electron";
import { createServer } from "vite";

const server = await createServer();
await server.listen();
const child = spawn(electron, ["."], {
  env: { ...process.env, LXM_DESKTOP_DEV: "1" },
  stdio: "inherit",
});

// 开发窗口退出时回收 Vite。终端中断也先请求关闭 Electron 子进程。
process.once("SIGINT", () => child.kill("SIGINT"));
process.once("SIGTERM", () => child.kill("SIGTERM"));
try {
  const [code] = await once(child, "exit");
  process.exitCode = code ?? 1;
} finally {
  await server.close();
}
