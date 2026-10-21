import { execFileSync } from "node:child_process";
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
  "artifacts/ui-phase3-20261018/source-manifest.json",
  JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      gitBaseline: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      worktree:
        "detached HEAD 加未提交改动；本清单标识已验收源码，不代表已提交。",
      hashes,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Recorded ${files.length} source/dependency hashes`);
