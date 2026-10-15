# 阶段1浏览器验收证据

对应 [实施验收](../../docs/design/04_实施验收/20261016_UI阶段1工作台与歌曲设置实施验收.md)，运行对象为本地生产预览，使用隔离Chrome，不操作用户正在使用的浏览器配置。

- `browser-smoke.mts` / `browser-smoke-report.json`：12条主回归，含设置、布局、草稿保护、简谱A/B、输出入口与打印媒体。
- `tools-smoke.mts` / `tools-smoke-report.json`：视图历史、粘贴预览、稳定技巧参数及局部标记历史。
- `zoom-smoke.mts` / `zoom-smoke-report.json`：独立Chrome原生设置中选择200%页面缩放，验证末尾动作未遮挡、Select popup可见和草稿保持。截图直接捕获完整浏览器surface，避免按CSS视口裁切。

复跑前启动生产预览：

```sh
pnpm --dir apps/website build
pnpm --dir apps/website start --hostname 127.0.0.1 --port 3100
```

脚本可使用本地安装的Playwright，或用`PLAYWRIGHT_MODULE`指定模块绝对路径；`CHROME_EXECUTABLE`指定Chrome可执行文件，`EDITOR_URL`可覆盖预览地址。例如：

```sh
PLAYWRIGHT_MODULE=/path/to/playwright CHROME_EXECUTABLE='/path/to/Chrome' node artifacts/ui-phase1-20261016/browser-smoke.mts
PLAYWRIGHT_MODULE=/path/to/playwright CHROME_EXECUTABLE='/path/to/Chrome' node artifacts/ui-phase1-20261016/tools-smoke.mts
PLAYWRIGHT_MODULE=/path/to/playwright CHROME_EXECUTABLE='/path/to/Chrome' node artifacts/ui-phase1-20261016/zoom-smoke.mts
```

`zoom-smoke.mts`创建并清理临时配置目录；不使用设备像素模拟、CSS zoom或图片放大代替页面缩放。自动化composition事件不代表真实系统中文IME验收。
