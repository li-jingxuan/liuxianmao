# UI 阶段 2 收尾验收资料

日期：2026-10-17（Asia/Shanghai）。本目录保存固定输入、可复跑脚本及实际报告；正式结论见 `docs/design/04_实施验收/20261017_UI阶段2工具菜单与紧凑收纳实施验收.md`，截图在 `docs/design/04_实施验收/验收截图/20261017_阶段2收尾/`。

所有命令在仓库根目录执行。使用 Node 24、当前 pnpm 依赖和可调用的 Playwright/Chrome；无需新增项目依赖。

## 复跑

```sh
# 四份固定谱例由正式 loadDocument 校验；只在浏览器通过文件导入加载。
node artifacts/ui-phase2-20261017/run-fixtures.mts

# 当前挂载目录实际能写文件，但 access(W_OK) 返回 EPERM；把构建产物隔离到临时目录。
node artifacts/ui-phase2-20261017/isolated-build.mts

# 单独终端启动生产预览；只监听本机，默认3103，可用 EDITOR_PORT 覆盖。
node artifacts/ui-phase2-20261017/serve.mts

# PLAYWRIGHT_MODULE 可以省略（若已能解析 playwright），或设为该包的绝对目录。
# CHROME_EXECUTABLE 指向本机 Chrome；EDITOR_URL 默认 http://127.0.0.1:3103/。
node artifacts/ui-phase2-20261017/browser-smoke.mts
node artifacts/ui-phase2-20261017/zoom-smoke.mts

pnpm exec vitest run --reporter=json --outputFile=artifacts/ui-phase2-20261017/vitest-report.json
pnpm --dir apps/website type-check
pnpm --dir apps/website lint
node artifacts/ui-phase2-20261017/source-snapshot.mts
```

生产预览需要在浏览器脚本运行期间保持启动。原生缩放脚本在独立临时 Chrome 配置中通过 `chrome://settings/appearance` 设置 200%，结束删除自己的配置，不改用户浏览器设置。临时构建目录由 `build-report.json` 记录，复跑时会重新生成；无需将绝对临时路径当成可移植链接。

## 资料边界

- `browser-smoke-report.json`：浏览器路径、实测容器/浮层尺寸、异常及浏览器版本。音乐输入、导航、文件导入/导出和图片下载均通过真实 UI；没有注入 React/store。容器断点专项只设置容器样式来精确触发 899/900/1199/1200px，并读取实际宽度。
- `zoom-smoke-report.json`：原生 200% 页面缩放的实际视口、菜单边界和取消/焦点结果。不是设备像素比或 CSS zoom 模拟。
- `build-report.json` / `build.log`：当前源码临时镜像的生产构建结果。源码和依赖使用符号链接，生成配置与产物隔离；没有修改 Next.js 配置或依赖。
- `regressions-before-fix.json`：菜单溢出及弹层 Tab 逃逸的修复前复现数据；修复后的原用例在浏览器报告中。
- `source-manifest.json`：当前源码、测试及依赖文件的 SHA-256。Git 配置访问受环境限制，不能据此推断提交、分支或暂存状态。
- `fixture.lxm.json`：三小节双弦 TAB、独立简谱、歌词、H 连接及目标简谱记号，用于复制层、遗漏与追加影响。
- `tuplet-fixture.lxm.json`：完整三连音加尾部休止，可删除并恢复；`tuplet-overflow-fixture.lxm.json` 将尾部换成需保护的音符，验证容量不足时零修改。
- `five-tuplet-fixture.lxm.json`：完整五连音，验证 5:4 与 5:3 的真实内容和候选提交边界。
- 真实操作系统中文 IME 候选窗仍需人工验收。合成 composition 仅验证事件隔离；这些脚本不代表多浏览器及全部 40 张画面验收。
