# REQ-013 六线猫编辑器开发者 Skill

对外分发 `lxm-editor` 一份 Agent Skill，覆盖 `@liuxianmao/lxm-editor` 与 `@liuxianmao/lxm-editor-react` 1.0.0。发布源为 `skills/lxm-editor/`，分发时保留完整目录。外部项目安装一次，即可按任务使用 Core 或 React 接入材料。[安装与调用](../../../../skills/README.md) · [飞书需求](https://pcnhehlhivqu.feishu.cn/wiki/UEivw1G7Liuaqnk20d1cqCoxnHb?sheet=D9eELE&range=A15:J15)

## 验收路径

- **分发包**。解压并检查 `lxm-editor/SKILL.md` 的 `name` 为 `lxm-editor`，确认其中的 API、示例及章节链接都能在本地解析。[Skill 入口](../../../../skills/lxm-editor/SKILL.md)
- **Core**。在独立 Node.js 项目安装 Core 候选包，运行合成谱示例。编辑、历史、回读和播放计划的断言通过后，应输出修订 2、一行谱面、一个声音事件、共两秒。[Core 示例](../../../../skills/lxm-editor/examples/core/edit-score.mjs)
- **React**。复制 React 19 示例，安装两个候选包，执行 `npm run build`。在浏览器中按示例步骤建谱、保存、尝试无效输入并刷新，确认恢复到已保存的 5 小节，第二个会话可独立编辑。[React 示例与验收步骤](../../../../skills/lxm-editor/examples/react/README.md)
