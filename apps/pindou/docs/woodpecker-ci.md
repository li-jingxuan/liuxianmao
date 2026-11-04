# Woodpecker CI

仓库根目录 `.woodpecker.yaml` 仅处理 `openchamber/pindou` 分支的手动任务与 push 事件。

手动运行时，在 Woodpecker 的新建流水线表单选择该分支，并在自定义变量中填写 `BUILD_TARGET`：

- `api`：仅运行 API 的 Ruff、全部 pytest 和临时 PostgreSQL 集成测试。
- `web`：仅运行 Web 的 ESLint、Vitest、TypeScript 检查及 Next.js 生产构建，不启动 PostgreSQL。
- `all`：运行前后端；未填写或值为空时也使用此行为。

变量值区分大小写，仅接受上述三种值；其他非空值会使参数校验失败。选择目标后，应新建流水线；重试旧任务会沿用旧任务的变量。Web 使用部署中的 `/app/pindou` 路径和 webpack 构建方式，并验证 standalone 入口已生成。测试任务不发布镜像、不部署应用，也不连接现有 NAS 数据库或付费 AI 服务。

push 事件按文件路径自动选择任务，不使用手动的 `BUILD_TARGET` 覆盖：API 源码及 `deploy/api.Dockerfile` 变化运行 API，Web 源码及 `deploy/web.Dockerfile` 变化运行 Web；根流水线、应用 `.dockerignore`、Compose 和飞牛部署配置变化运行两边。空变更列表按两边都运行处理，避免在缺失变更信息时跳过检查。

PostgreSQL 直接使用现成的官方 `postgres:17-alpine` 镜像，**不构建数据库镜像，也不重建 NAS 上的数据库**。只有选中 API 检查时才创建这次任务专用的临时 PostgreSQL 容器，用于后端并发测试，任务结束后清理；服务账号只供这套隔离测试使用。普通 API 测试仍按测试 fixture 使用独立 SQLite、临时文件目录和模拟服务。

后端使用官方独立包 `volcengine-ark-runtime` 提供既有 `volcenginesdkarkruntime` 导入，避免总 SDK 拉入无关云产品依赖；API 测试仍包含原有 Ark 异常和图片服务适配测试。

NAS 当前无法稳定传输 GitHub Git pack，但 `api.github.com` 可达，因此 checkout 通过 GitHub Git Data API 下载当前 `CI_COMMIT_SHA` 的完整文件树，并逐个验证 Git blob SHA-1、路径及执行权限。此方式不生成 `.git`，拒绝不完整树、符号链接和子模块；项目后续需要这些内容时须调整 checkout。HTTPS 证书校验保持启用。

仓库需配置 Woodpecker Secret `github_api_checkout`，为拥有该仓库读取权限的 GitHub token，仅对本仓库 manual/push 事件提供；本次配置复用已授权 Woodpecker 访问仓库的 OAuth token。token 不得写入 YAML、源码或日志。Node/Python 使用部署 Dockerfile 已采用的镜像源。

在 Woodpecker 仓库页面选择 `openchamber/pindou` 分支手动运行。自动 push 触发还要求 GitHub Webhook 能在无 NAS 登录会话的情况下直达 Woodpecker；FN Connect 返回网页或 HTTP 200 不代表投递成功。
