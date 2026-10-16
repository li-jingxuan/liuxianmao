import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
const source = path.resolve("apps/website");
const require = createRequire(path.join(source, "package.json"));
const { target } = JSON.parse(
  await readFile("artifacts/ui-phase2-20261017/build-report.json", "utf8"),
);
const child = spawn(
  process.execPath,
  [
    require.resolve("next/dist/bin/next"),
    "start",
    target,
    "-H",
    "127.0.0.1",
    "-p",
    process.env.EDITOR_PORT ?? "3103",
  ],
  {
    cwd: source,
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  },
);
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code) => (process.exitCode = code ?? 0));
