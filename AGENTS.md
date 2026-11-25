## 需求与实现要求
- v1.0 新需求、交互稿、交付方案与验收记录从 [v1.0 工作区](docs/v1/README.md)建立。同一专题使用飞书 REQ／BUG 编号串联，涉及已有功能时查阅 [v1.0 设计基线](docs/v1/design-baseline/README.md)。历次评审与交付记录见 [MVP 归档](docs/archive/mvp/README.md)。
- 我给你 bug或者req需求编号时，默认使用 lark-cli 读取飞书文档：https://pcnhehlhivqu.feishu.cn/wiki/UEivw1G7Liuaqnk20d1cqCoxnHb?from=from_copylink&sheet=tcgLfi
- 不确认的及时与我对口径
- 设计稿调用：ui-ux、fronted-design skills，设计稿、交互稿先与我确认再实施；设计稿基于 docs/v1/design-baseline/** 基线进行
- 交互稿、原型和前端实现统一以 1440px 为最小视口宽度。小于 1440px 的窄屏不在设计和适配范围内，无需为其准备布局方案或验收用例。
- 每次完成功能实现或 Bug 修复后，都要为本次新增或修改的关键代码补充详细中文注释。说明业务意图、实现原因，以及涉及的边界条件、异常处理和兼容逻辑；行为变化时同步更新相关旧注释。交付前检查注释与实际行为一致。

## 读取飞书bugfix和需求
- 使用 `lark-cli` 和 `lark-sheets` skill，按 BUG/REQ 编号定位实际行，并按表头确认「状态」和「备注」列。
- 按进度更新「状态」。有指定底色的状态，必须同时更新文字和该状态单元格的背景色。

  | 时机 | 状态文字 | 状态单元格背景色 |
  | --- | --- | --- |
  | 等待我确认口径或原型 | 待确认口径/原型 | 浅黄色 `#FFF2CC` |
  | 口径和原型已确认 | 实现中 | |
  | 修复或实现完成 | 待验收 | |
  | 我确认验收完成 | 已完成 | 浅绿色 `#E2F0D9` |

- 用 `+cells-set` 更新状态文字，再用 `+cells-set-style --background-color` 设置指定底色，刷色范围仅限目标行的「状态」单元格。写入后用 `+cells-get --include value,style` 回读每个目标格，确认状态文字和指定底色都正确后再汇报完成。
- 修复 Bug 或完成需求后，在对应行的「备注」补充验收路径。有合并提交时，在验收完成后补充分支名和提交号。

## lark-cli 凭证
- 在本项目中运行 `lark-cli` 时，每次都显式传入 `--profile nice007`，例如 `lark-cli --profile nice007 whoami`。

## 飞牛 NAS 连接
- 通过飞牛 skill、已配置的 SSH 密钥或本地连接配置访问。
- 需要临时凭证时，通过 OpenChamber 的私密凭证卡输入。

## 任务进行注意事项
- 【重要】优先把任务分配给子智能体，自己做统筹，有需要确认口径的提前与我确认，不要等。
- 需求和 Bug 修复默认在任务开始时的当前分支实现、验证和交付。仅在我明确指定其他分支或同意另开分支时调整。
- 为当前任务自动创建的临时分支或 worktree，在功能完成并验证、相关提交已合入交付分支后自动清理。确认 worktree 没有待保留的改动后，先移除临时 worktree，再删除临时分支。遇到未提交改动、未合入的提交或仍在使用的分支和 worktree 时，保留并说明原因。
- 当前工作区有其他任务的未提交改动时，先检查是否与本次改动重叠。可独立修改时继续在当前分支处理，并保留其他任务的改动。若必须隔离才能避免覆盖，先与我确认处理方式，并确认最终交付分支。
- 实现新需求或者新需求/bugfix与现有功能冲突时，要与我对口径，不要把已经确认的功能和能力给删掉了

## 域名和服务
- 服务器在阿里云上面，统一使用 alibabacloud-workbench-cli Skill 操作
- 域名：解析 www.liuxianmao.com、liuxianmao.com -> www.liuxianmao.com
- aliyun 轻量服务器实例ID：b3a7d9e4749c43799c40501ab2221c6e
