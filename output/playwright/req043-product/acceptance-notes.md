# REQ043 真实 Next 浏览器验收

在仓库根目录运行，先启动本分支的网站服务：

```sh
node apps/website/tests/req043.next.browser.mjs
```

需要安装 Playwright 和 Chrome。`LXM_PLAYWRIGHT_MODULE` 可指定外部 Playwright 模块的绝对路径，`REQ_NEXT_URL` 可指定验收地址，默认 `http://127.0.0.1:3031/editor`。脚本不依赖个人电脑的固定模块路径。

初轮主流程 19 组完整通过，空位持久化修复后增加 2 组专项并增量运行。本次提交前追加了完整 21 组回归，再补 TAB 延音横线约束，最终完整运行 22 组，以当前 `result.json` 为准。增量重跑可设置：

```sh
REQ043_CHECK_FILTER='旧显式二分偏好|TAB 三十二分/十六分空拍' node apps/website/tests/req043.next.browser.mjs
```

空位用例先设置简谱显式二分偏好，再应用模板、下载并重载，恢复旧偏好后点击 tick480 的真实空位补 7，确认仍为十六分，其他事件不变。TAB 分别覆盖三十二分与十六分空拍，面对同 tick 简谱四分，确认保存文件含 `preserveInputRhythm: true`、重载后的会话 overrides 为空，再真实键入品位 7，保持空拍时值及其余内容。

谱例均通过生产 `replaceDocument` 加载器；未替换产品代码、adapter 或原型。模板应用、确认、取消、简谱／TAB 选择与补音均使用真实 UI。

简谱单点直接点击字形，多拍通过真实 Shift 点击；TAB 使用真实排版给出的鼠标坐标。导出检查下载实际文件、重新加载并补音，同时核对四段歌词与和弦。

失败会记录并令脚本返回非零。每次应用（含 noop）、取消及 Escape 均检查入口回焦。专属目录只保留当前证据，防止旧失败截图被误认为最终结果。

布局检查等待两帧完成 portal 测量和聚焦，覆盖 1440×1000 与 1400×720：724px 面板、三行模板、操作区无裁切，页面与卡片无溢出，谱面预览可独立横向滚动。

未注入 adapter 失败重试：当前无稳定的公开失败接口，也未添加生产测试后门。`result.json` 是最近一次运行的权威结果。
