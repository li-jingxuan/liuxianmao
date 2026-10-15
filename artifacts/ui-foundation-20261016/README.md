# UI 基础协调层浏览器证据

对应 [基础协调层实施验收](../../docs/design/04_实施验收/20261016_UI基础协调层实施验收.md)。图片为实际应用烟测截图，原始视觉设计稿位于 `docs/design/01_设计稿/`。

`browser-smoke.mts` 使用 Node.js 24 和 Playwright，默认访问 `http://127.0.0.1:3100/`。先在项目根目录完成构建并启动生产预览：

```bash
pnpm --dir apps/website build
pnpm --dir apps/website start --hostname 127.0.0.1 --port 3100
```

在另一终端执行：

```bash
node artifacts/ui-foundation-20261016/browser-smoke.mts
```

可通过 `PLAYWRIGHT_MODULE` 指定本机 Playwright 模块路径，通过 `CHROME_EXECUTABLE` 指定 Chrome 可执行文件，通过 `EDITOR_URL` 指定其他预览地址。脚本使用独立浏览器，不读取日常浏览器配置；会写入同目录的结果 JSON 与四张 PNG。失败时另写 `smoke-failure.png`。

组合输入检查使用合成浏览器事件，真实中文输入法仍需独立验收。这里的响应式结果只证明输入与登记保持，不代表完整设计稿布局验收通过。
