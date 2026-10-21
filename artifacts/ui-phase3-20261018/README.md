# UI 阶段 3 验收证据

日期：2026-10-18（Asia/Shanghai）。正式结论见 [阶段 3 验收](../../docs/design/04_实施验收/20261018_UI阶段3歌词简谱与和弦属性表单实施验收.md)。本目录脚本通过公开 UI 操作本地编辑器，不注入内部 store。

- `vitest-report.json`：本轮全量测试，79 文件、718 项。
- `build.log`、`type-check.log`、`lint.log`：本轮生产构建、类型与 lint。
- `s3-a-browser-report.json`：4 组提交/草稿专项。
- `browser-smoke-report.json`：21 组表单/布局/输出检查。
- `zoom-smoke-report.json`：4 组 Chrome 原生 200% 缩放检查。
- `source-manifest.json`：已验收源码/依赖的 SHA-256 与 Git HEAD。
- 5 份 `.lxm.json` 固定谱例均由 `fixtures.test.ts` 经正式 loader 验证。
- `presentation.png` 为真实导出 PNG；页面截图在正式验收截图目录。

复跑自动化和构建：

```sh
pnpm install --frozen-lockfile
pnpm --dir apps/website type-check
pnpm --dir apps/website lint
pnpm exec vitest run --reporter=json --outputFile=artifacts/ui-phase3-20261018/vitest-report.json
pnpm --dir apps/website build
pnpm --dir apps/website start --port 3110 --hostname 127.0.0.1
```

另开终端设置 `EDITOR_URL=http://127.0.0.1:3110/`，`PLAYWRIGHT_MODULE` 指向可用的 Playwright 绝对模块目录；`CHROME_EXECUTABLE` 指向本机 Chrome 可执行文件，再运行：

```sh
node artifacts/ui-phase3-20261018/run-browser.mts
# 也可逐项运行：
node artifacts/ui-phase3-20261018/s3-a-smoke.mts
node artifacts/ui-phase3-20261018/browser-smoke.mts
node artifacts/ui-phase3-20261018/zoom-smoke.mts
node artifacts/ui-phase3-20261018/source-snapshot.mts
```

需要支持 `.mts` 类型擦除的 Node（本轮 v24）。缩放脚本使用临时独立 Chrome profile，在 `chrome://settings/appearance` 选择 200%，结束时清理 profile。禁止用 CSS zoom、截图放大或 deviceScaleFactor 替代原生页面缩放。

历史失败截图/正文不是当前证据，完成验收后已清理。系统中文 IME 继续由人工复核；本目录只声称合成 composition 检查。
