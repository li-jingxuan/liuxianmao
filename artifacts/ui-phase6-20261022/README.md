# UI 阶段 6 最终验收工作区（2026-10-22）

本目录保存阶段 5 完成后的阶段 6 最终 Chrome 基线、响应式/200% 截图、100 小节多页输出和跨浏览器矩阵。最终入口：[matrix.json](matrix.json)。

## 运行

开发服务器默认 `http://127.0.0.1:3110/`；fixture 来自 `artifacts/ui-phase5-20261022/`。

```bash
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
node --experimental-strip-types artifacts/ui-phase6-20261022/browser-regression.mts

PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
node --experimental-strip-types artifacts/ui-phase6-20261022/responsive-output-smoke.mts

PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
node --experimental-strip-types artifacts/ui-phase6-20261022/zoom-regression.mts

PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
node --experimental-strip-types artifacts/ui-phase5-20261022/phase5-smoke.mts
```

`zoom-regression.mts` 使用临时 Chrome profile，通过 `chrome://settings/appearance` 设置 200% 页面缩放，不修改系统或用户正式配置。

## 文件

| 文件                                                            | 内容                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------- |
| `browser-regression.mts` / `browser-regression-report.json`     | 阶段 3–5 综合回归 21 组，含图片导出单页下载                   |
| `responsive-output-smoke.mts` / `responsive-output-report.json` | 五组视口、图片 Modal 键盘焦点、100 小节 4 页 ZIP              |
| `zoom-regression.mts` / `zoom-regression-report.json`           | 原生 200%、Select/Modal、S02 草稿闸门、图片操作可达与焦点恢复 |
| `regression-shots/`                                             | 综合回归截图                                                  |
| `long-score.zip` / `presentation.png`                           | 长谱多页 ZIP 与单页 PNG 成品证据                              |
| `matrix.json`                                                   | 环境、视口、分组、修复项和人工/阻塞项总表                     |

阶段 6 截图归档在 `docs/design/04_实施验收/验收截图/20261022_阶段6响应式与多浏览器/`。左下角 “N” 圆标是 Next.js 开发指示器，不属于产品界面。

## 结论边界

- Chrome 自动化全部通过；`pageerror` 与功能性 console error 为 0，favicon 404 单独忽略。
- Edge、Firefox 未安装，状态为 `blocked`。
- Safari 未启用 WebDriver 远程自动化，真实中文 IME 需要系统候选窗，二者状态为 `manual`。
- 阻塞与人工项不记为通过，阶段 6 的自动化与环境边界结论以 `matrix.json` 为准。
