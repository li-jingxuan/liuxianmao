# Woodpecker CI

仓库根目录 `.woodpecker.yaml` 仅处理 `openchamber/pindou` 分支的手动任务与 push 事件。

流水线先执行 API 的 Ruff 和全部 pytest，再执行 Web 的 ESLint、Vitest、TypeScript 检查及 Next.js 生产构建。Web 使用部署中的 `/app/pindou` 路径和 webpack 构建方式，并验证 standalone 入口已生成。测试任务不发布镜像、不部署应用，也不连接现有 NAS 数据库或付费 AI 服务。

PostgreSQL 服务属于每次任务的临时容器，用于后端 PostgreSQL 并发测试；服务账号只供这套隔离测试使用。普通 API 测试仍按测试 fixture 使用独立 SQLite、临时文件目录和模拟服务。

NAS 当前无法稳定连接 DNS 返回的 GitHub 地址，仓库需配置 Woodpecker Secret `github_curlopt_resolve`，格式为 Git 的 `http.curloptResolve` 值，例如 `github.com:443:<已核实可达的 GitHub 地址>`。克隆步骤保留 HTTPS 证书校验；GitHub 地址变化时须重新验证并更新该部署配置。克隆插件使用官方 Quay 镜像，Node/Python 使用部署 Dockerfile 已采用的镜像源。

在 Woodpecker 仓库页面选择 `openchamber/pindou` 分支手动运行。自动 push 触发还要求 GitHub Webhook 能在无 NAS 登录会话的情况下直达 Woodpecker；FN Connect 返回网页或 HTTP 200 不代表投递成功。
