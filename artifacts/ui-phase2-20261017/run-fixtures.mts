import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
const require = createRequire(import.meta.url);
const vitestRequire = createRequire(require.resolve("vitest/package.json"));
const cli = path.join(
  path.dirname(vitestRequire.resolve("vite-node/package.json")),
  "vite-node.mjs",
);
const child = spawn(
  process.execPath,
  [cli, "artifacts/ui-phase2-20261017/create-fixtures.mts"],
  { stdio: "inherit" },
);
child.on("exit", (code) => (process.exitCode = code ?? 1));
