# Woodpecker CI

仓库根目录 `.woodpecker.yaml` 仅处理 `openchamber/pindou` 分支的手动任务与 push 事件。

流水线先执行 API 的 Ruff 和全部 pytest，再执行 Web 的 ESLint、Vitest、TypeScript 检查及 Next.js 生产构建。Web 使用部署中的 `/app/pindou` 路径和 webpack 构建方式，并验证 standalone 入口已生成。测试任务不发布镜像、不部署应用，也不连接现有 NAS 数据库或付费 AI 服务。

PostgreSQL 服务属于每次任务的临时容器，用于后端 PostgreSQL 并发测试；服务账号只供这套隔离测试使用。普通 API 测试仍按测试 fixture 使用独立 SQLite、临时文件目录和模拟服务。

NAS 当前无法稳定传输 GitHub Git pack，但 `api.github.com` 可达，因此 checkout 通过 GitHub Git Data API 下载当前 `CI_COMMIT_SHA` 的完整文件树，并逐个验证 Git blob SHA-1、路径及执行权限。此方式不生成 `.git`，拒绝不完整树、符号链接和子模块；项目后续需要这些内容时须调整 checkout。HTTPS 证书校验保持启用。

仓库需配置 Woodpecker Secret `github_api_checkout`，为拥有该仓库读取权限的 GitHub token，仅对本仓库 manual/push 事件提供；本次配置复用已授权 Woodpecker 访问仓库的 OAuth token。token 不得写入 YAML、源码或日志。Node/Python 使用部署 Dockerfile 已采用的镜像源。

在 Woodpecker 仓库页面选择 `openchamber/pindou` 分支手动运行。自动 push 触发还要求 GitHub Webhook 能在无 NAS 登录会话的情况下直达 Woodpecker；FN Connect 返回网页或 HTTP 200 不代表投递成功。
