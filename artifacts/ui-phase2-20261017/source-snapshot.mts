import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const roots = [
  "apps/website/app",
  "apps/website/components",
  "apps/website/stores",
  "apps/website/tests",
  "packages/lxm-editor/src",
];
const files: string[] = [
  "package.json",
  "pnpm-lock.yaml",
  "apps/website/package.json",
  "apps/website/next.config.ts",
];
async function visit(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(relative);
    else if (/\.(ts|tsx|scss|css)$/.test(entry.name)) files.push(relative);
  }
}
for (const root of roots) await visit(root);
const hashes: Record<string, string> = {};
for (const file of files.sort())
  hashes[file] = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
await writeFile(
  "artifacts/ui-phase2-20261017/source-manifest.json",
  JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      gitBaseline:
        "读取 .git/config 返回 EPERM，未核实提交及暂存状态；以本清单标识已验收工作区文件。",
      hashes,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Recorded ${files.length} source/dependency hashes`);
