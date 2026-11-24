# REQ-011 六线猫 v1.0 GEO 实现与验收

**状态：待验收。** 琴友从首页能了解可以写什么谱、怎样保留原谱和分享成品，并直接进入 Web 编辑器。开发者从「开发者接入」能查到适用的包、React 版本与随包文档。首页在初始 HTML 中提供这些说明，联网问答可以引用同一份可见正文。[首页实现](../../../../apps/website/app/page.tsx) · [飞书 v1.0 需求表](https://pcnhehlhivqu.feishu.cn/wiki/UEivw1G7Liuaqnk20d1cqCoxnHb?sheet=D9eELE&range=A13:J13)

## 首页内容与核对依据

下表也是联网问答抽查使用的四道固定题。每题按右栏核对事实，保留平台回答的原文。

| 问题原文 | 应能从页面核对的事实 |
| --- | --- |
| 六线猫是什么？可以编辑什么？ | 六线猫是浏览器里的吉他曲谱编辑器，同一份谱可写六线谱（TAB）、简谱、歌词和和弦指法。首页「打开编辑器」进入 `/editor`。 |
| 吉他谱怎么发给学生，又能留着继续改？ | 在「导出」里保存 `.lxm` 原谱（UTF-8 JSON），下次从首页或编辑器导入。发给学生可生成 A4 PNG，纸谱或 PDF 走「导出 → 打印 → 打开打印窗口」，在浏览器中选择打印机或另存为 PDF。[曲谱文件与成品](../../design-baseline/score-files.md) |
| 怎么把六线猫嵌入 React？能自己做编辑界面吗？ | React 19 和 React DOM 19 项目用 `@liuxianmao/lxm-editor-react` 的 `LxmEditor` 嵌入写谱工作区。自建界面用 `@liuxianmao/lxm-editor` 加载和编辑曲谱，生成谱面布局和播放计划。两个包的 README 提供同版本候选包安装步骤。[React 接入指南](../../../../packages/lxm-editor-react/README.md) · [Core README](../../../../packages/lxm-editor/README.md) · [Core 公共 API](../../../../packages/lxm-editor/docs/api-v1.md) |
| 在线怎么写带和弦的吉他六线谱？ | 首页《风吹过山谷》用 C、G 两个和弦演示 TAB、简谱与歌词、和弦指法三个谱层。可打开编辑器试写，也可新建或导入 `.lxm` 后修改。[首页谱例](../../../../apps/website/app/HomeScorePreview.tsx) |

当前首页的开发者入口指向页内接入说明。两包以 `1.0.0` 候选制品提供 README，Core 包另附 `docs/api-v1.md`。正式放行后再补可匿名访问的对应版本文档、安装命令和已发布平台的下载链接。新增对外分发的截图或谱例随制品核对授权。[发版规则](../REQ-089-GitHub开源与README/README.md#github-与-npm-发版)

## 本地复验路径

1. 在仓库根目录构建并启动生产站点。使用实际部署子路径，例如以 `NEXT_PUBLIC_BASE_PATH=/app/liuxianmao` 构建。关闭 JavaScript 打开首页，在正文核对上表事实。点「开发者接入」应定位到两个包的说明，检查「打开编辑器」链接包含配置的子路径。
2. 开启 JavaScript，从首页「打开编辑器」进入示例谱，在「歌曲」修改曲名并点「应用曲谱信息」。选择「导出 → 六线猫专用谱(.lxm)」下载。另开新会话，从首页导入刚下载的文件，在预览中核对新曲名，点「打开曲谱」后再到「歌曲」核对一次。[REQ-011 浏览器回归](../../../../apps/website/tests/req011.next.browser.mjs)
3. 用「导出 → 图片(.png)」生成并下载当前页，检查 PNG 为 A4 纵向、2480 × 3508 像素。用「导出 → 打印」打开 A4 预览，再打开浏览器打印窗口，确认能输出 PDF。[文件与成品浏览器回归](../../../../apps/website/tests/req048.next.browser.mjs)

在可运行 Playwright 和 Chromium 的环境中，对已启动的本地生产站点运行以下命令。`REQ_NEXT_ORIGIN` 包含实际子路径，示例端口为 3031。第一条验证无脚本正文和完整的曲谱往返，第二条检查文件、PNG 与打印流程。

```sh
export REQ_NEXT_ORIGIN=http://127.0.0.1:3031/app/liuxianmao
node apps/website/tests/req011.next.browser.mjs
node apps/website/tests/req048.next.browser.mjs
```

## 复查记录

2026-11-24 在 `v1.0` 工作区的本地 Next.js standalone 生产构建中复查，首页与 `/editor` 已预渲染。

| 检查 | 实测结果 |
| --- | --- |
| 首页和 `.lxm` 往返（REQ-011） | Chromium 关闭 JavaScript 后仍可读到产品、导出、开发者说明，页内锚点可用。开启脚本后，从首页进入 `/app/liuxianmao/editor`，修改曲名、导出，再在新会话中导入，预览和编辑器均显示修改后的曲名。 |
| 成品输出（REQ-048） | 浏览器回归通过。下载的 PNG 为 2480 × 3508 像素，打印预览触发打印调用，Chromium 按打印样式生成了 PDF。 |
| 文件与成品单测 | 曲谱文件、文件流程、成品快照与图片导出共 4 个测试文件、61 项通过。 |

另用本机 Google Chrome 158 的无头模式复测，导航在 30 秒内超时，该浏览器的完整流程仍待复核。

同日匿名查询公共 npm 注册表，两个包均返回 HTTP 404，首页沿用候选包说明。正式站点的外网访问、发布版本文档链接和三轮问答样本待实测。

## 联网问答抽查

上线前建立基线，上线后第 7 天、第 30 天各复测一次。在 ChatGPT 搜索和同一个可用的中文联网问答服务，逐字提问上表四题。每条记录写下轮次、日期、地区、平台、问题原文、实际回答或未返回、答对或遗漏的事实、引用的完整 URL 和待修正文案。未给引用也照实记录。验收依据为可访问的公开来源和实测记录，引用次数与排名仅用于观察。

发布时从外网匿名打开正式首页、编辑器和已放行的版本文档，记录最终 URL、响应状态和对应版本。若搜索爬虫受阻，核对现有 `robots.txt`、反向代理与 CDN 对具体页面的规则。ChatGPT 搜索抓取使用 `OAI-SearchBot`，训练抓取使用 `GPTBot`。站点元信息、canonical、sitemap 和站长平台由 v1.1 REQ-001 跟进。[OpenAI 爬虫说明](https://developers.openai.com/api/docs/bots) · [搜索与内容发现](../../首发筹备/01-搜索与内容发现.md)
